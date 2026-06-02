import ejs from 'ejs'
import {
  type ChatContentPart,
  type JsonRecord,
  type LLMContentPart,
  type MixedChatBlock,
  type ProcessingChat,
  type PluginRuntimeContext
} from '@st-forge/plugin-api'
import { asRecord, textFromContentParts } from '@st-forge/plugin-api'

const DEFAULT_USER_NAME = 'User'
const VARIABLE_SCOPE_KEY = 'variables'

type VariableScopeName = 'global' | 'local' | 'cache'

interface VariableScopes {
  global: JsonRecord
  local: JsonRecord
  cache: JsonRecord
}

const lodashCompat = {
  get: getByPath
}

function pathSegments(path: unknown): string[] {
  if (Array.isArray(path)) return path.map(segment => String(segment)).filter(Boolean)
  if (typeof path === 'number') return [String(path)]
  if (typeof path !== 'string') return []
  return path
    .replace(/\[(?:"([^"]*)"|'([^']*)'|([^\]]+))\]/g, (_match, doubleQuoted, singleQuoted, raw) => (
      `.${doubleQuoted ?? singleQuoted ?? raw ?? ''}`
    ))
    .split('.')
    .map(segment => segment.trim())
    .filter(Boolean)
}

function getByPath(source: unknown, path: unknown, fallback?: unknown): unknown {
  const segments = pathSegments(path)
  let current = source
  for (const segment of segments) {
    if (current === null || current === undefined) return fallback
    if (typeof current !== 'object' && typeof current !== 'function') return fallback
    current = (current as Record<string, unknown>)[segment]
  }
  return current === undefined ? fallback : current
}

function variableScopeOption(options: unknown, fallback: VariableScopeName): VariableScopeName {
  if (options === 'global' || options === 'local' || options === 'cache') return options
  const scope = asRecord(options).scope
  return scope === 'global' || scope === 'local' || scope === 'cache' ? scope : fallback
}

function variableDefaultOption(options: unknown): unknown {
  if (options === undefined) return undefined
  if (typeof options === 'string' && ['global', 'local', 'cache'].includes(options)) return undefined
  if (options !== null && typeof options === 'object') {
    const record = asRecord(options)
    if (Object.prototype.hasOwnProperty.call(record, 'defaults')) return record.defaults
    if (Object.prototype.hasOwnProperty.call(record, 'default')) return record.default
    return undefined
  }
  return options
}

function readVariable(scopes: VariableScopes, key: unknown, options?: unknown): unknown {
  const scope = variableScopeOption(options, 'cache')
  return getByPath(scopes[scope], key, variableDefaultOption(options))
}

function scopedVariableOptions(options: unknown, scope: VariableScopeName): JsonRecord {
  const record = asRecord(options)
  const defaults = variableDefaultOption(options)
  return defaults === undefined
    ? { ...record, scope }
    : { ...record, defaults, scope }
}

function variableScopes(config: JsonRecord, pluginData: JsonRecord): VariableScopes {
  const global = asRecord(config.globalVariables)
  const local = asRecord(pluginData[VARIABLE_SCOPE_KEY])
  return {
    global,
    local,
    cache: {
      ...global,
      ...local
    }
  }
}

function templateContext(scopes: VariableScopes, env: JsonRecord): JsonRecord {
  return {
    ...scopes.cache,
    ...env,
    _: lodashCompat,
    variables: scopes.cache,
    userName: DEFAULT_USER_NAME,
    getvar: (key: unknown, options?: unknown) => readVariable(scopes, key, options),
    getGlobalVar: (key: unknown, options?: unknown) => readVariable(scopes, key, scopedVariableOptions(options, 'global')),
    getLocalVar: (key: unknown, options?: unknown) => readVariable(scopes, key, scopedVariableOptions(options, 'local'))
  }
}

function logRenderError(error: unknown, where: string, content: string): void {
  console.error('[ST-Prompt-Template Compat] EJS render failed', {
    where,
    error,
    content
  })
}

async function renderPromptTemplateText(content: string, scopes: VariableScopes, env: JsonRecord, where: string): Promise<string> {
  if (!content.includes('<%')) return content
  try {
    return await ejs.render(content, templateContext(scopes, env), {
      async: true,
      outputFunctionName: 'print'
    })
  } catch (error) {
    logRenderError(error, where, content)
    return content
  }
}

async function renderContentParts(parts: ChatContentPart[], scopes: VariableScopes, env: JsonRecord, blockId: number): Promise<ChatContentPart[]> {
  return Promise.all(parts.map(async (part, partIndex) => {
    if (part.type !== 'text' && part.type !== 'reasoning') return part
    return {
      ...part,
      text: await renderPromptTemplateText(part.text, scopes, env, `block #${blockId} ${part.type} part #${partIndex}`)
    }
  }))
}

async function renderLlmContent(
  block: MixedChatBlock,
  scopes: VariableScopes,
  env: JsonRecord,
  blockId: number
): Promise<string | LLMContentPart[] | undefined> {
  if (block.llm && !Object.prototype.hasOwnProperty.call(block.llm, 'content')) return undefined
  const content = block.llm?.content
  if (typeof content === 'string') {
    return renderPromptTemplateText(content, scopes, env, `block #${blockId} llm`)
  }
  if (Array.isArray(content)) {
    return Promise.all(content.map(async (part, partIndex) => ({
      ...part,
      text: await renderPromptTemplateText(part.text, scopes, env, `block #${blockId} llm part #${partIndex}`)
    })))
  }
  if (!block.original) return undefined
  const renderedParts = await renderContentParts(block.original.contentParts, scopes, env, blockId)
  return textFromContentParts(renderedParts).trim()
}

async function renderBlock(block: MixedChatBlock, scopes: VariableScopes, chatId: number): Promise<MixedChatBlock> {
  const blockId = block.original?.id ?? 0
  const env = {
    chatId,
    blockId,
    role: block.role
  }
  const next: MixedChatBlock = {
    ...block,
    pluginData: asRecord(block.pluginData)
  }

  if (block.user && !Object.prototype.hasOwnProperty.call(block.user, 'contentParts')) {
    next.user = {}
  } else {
    const sourceParts = block.user?.contentParts ?? block.original?.contentParts
    if (sourceParts) next.user = { contentParts: await renderContentParts(sourceParts, scopes, env, blockId) }
  }

  if (block.llm && !Object.prototype.hasOwnProperty.call(block.llm, 'content')) {
    next.llm = {}
  } else {
    const content = await renderLlmContent(block, scopes, env, blockId)
    if (content !== undefined) next.llm = { content }
  }

  return next
}

export default function chatBlockProcessor(context: PluginRuntimeContext) {
  return {
    async process(chat: ProcessingChat): Promise<ProcessingChat> {
      const config = asRecord(await context.haExtApi.storage.readJson('config.json', {
        enabled: true,
        renderMessages: true,
        globalVariables: {}
      }))
      if (config.enabled === false || config.renderMessages === false) return chat
      const scopes = variableScopes(config, asRecord(chat.chatSession.pluginData[context.plugin.id]))
      return {
        ...chat,
        chatBlocks: await Promise.all(chat.chatBlocks.map(block => renderBlock(block, scopes, chat.chatSession.id)))
      }
    }
  }
}
