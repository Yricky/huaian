import {
  messageHasContent,
  normalizeChatBlockTargetRole,
  textFromContentParts,
  type ChatContentPart,
  type ChatGenerationPreviewMessage,
  type JsonRecord,
  type LLMContentPart,
  type MixedChatBlock,
  type OriginalChatBlock,
  type ProcessingChat,
  type PluginManifest,
  type PluginToolCallManifest
} from '@st-forge/plugin-api'
import type {
  ChatSession,
  ChatToolDefinition,
  DbChatBlock,
  LlmToolDefinition,
  PluginDescriptor,
  PluginToolCallRequest,
  ProjectSnapshot
} from '../../shared/types'
import { asRecord, cloneJson } from '../../shared/value-utils'
import { chatBlockTargetRole } from '../../shared/chat-blocks'
import { invokePluginWorker } from './pluginWorkerHost'

export interface PluginChatProcessingBundle {
  messages: ChatGenerationPreviewMessage[]
  processingChat: ProcessingChat
  toolDefinitions: LlmToolDefinition[]
}

let toolRequestUnsubscribe: (() => void) | null = null

function activePlugins(project: ProjectSnapshot, chat?: ChatSession): PluginDescriptor[] {
  const projectEnabled = new Set(project.config.plugins.enabledPluginIds)
  const chatEnabled = new Set(chat?.runtimeConfig.enabledPluginIds ?? project.config.plugins.enabledPluginIds)
  const byId = new Map(project.plugins.map(plugin => [plugin.manifest.id, plugin]))
  const result: PluginDescriptor[] = []
  for (const plugin of project.plugins) {
    if (!projectEnabled.has(plugin.manifest.id) || !chatEnabled.has(plugin.manifest.id)) continue
    const dependencies = plugin.manifest.dependencies ?? []
    if (dependencies.every(id => projectEnabled.has(id) && chatEnabled.has(id) && byId.has(id))) result.push(plugin)
  }
  return result
}

function pluginRuntimeSignature(project: ProjectSnapshot): string {
  return JSON.stringify({
    path: project.path,
    enabledPluginIds: project.config.plugins.enabledPluginIds,
    plugins: project.plugins.map(plugin => ({
      id: plugin.manifest.id,
      versionCode: plugin.manifest.versionCode
    }))
  })
}

function pluginRuntimeDescriptor(project: ProjectSnapshot, plugins = activePlugins(project)): JsonRecord {
  return {
    signature: pluginRuntimeSignature(project),
    allPlugins: project.plugins,
    activePlugins: plugins
  }
}

function pluginChatSession(chat: ChatSession): ProcessingChat['chatSession'] {
  return {
    id: chat.id,
    title: chat.title,
    pluginData: cloneJson(chat.runtimeConfig.pluginData),
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt
  }
}

export function originalFromDbChatBlock(block: DbChatBlock): OriginalChatBlock {
  return {
    id: block.id,
    enabled: block.enabled,
    contentParts: cloneJson(block.contentParts),
    metadata: cloneJson(block.metadata)
  }
}

export function mixedBlockFromDbChatBlock(block: DbChatBlock): MixedChatBlock {
  return {
    role: chatBlockTargetRole(block),
    original: originalFromDbChatBlock(block),
    pluginData: {}
  }
}

export function processingChatFromDbBlocks(chat: ChatSession, blocks: DbChatBlock[]): ProcessingChat {
  return {
    chatSession: pluginChatSession(chat),
    pluginData: {},
    chatBlocks: blocks.map(mixedBlockFromDbChatBlock)
  }
}

export function ensurePluginRuntime(project: ProjectSnapshot): Promise<void> {
  const runtime = pluginRuntimeDescriptor(project)
  return invokePluginWorker('ensurePluginRuntime', runtime, String(runtime.signature)).then(() => undefined)
}

function hasOwn(record: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function llmContent(value: unknown): string | LLMContentPart[] | undefined {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return undefined
  return value
    .map(part => asRecord(part))
    .filter(part => part.type === 'text' || part.type === 'reasoning')
    .map(part => (
      part.type === 'reasoning'
        ? {
            type: 'reasoning' as const,
            text: typeof part.text === 'string' ? part.text : '',
            sendAsContext: part.sendAsContext === true
          }
        : {
            type: 'text' as const,
            text: typeof part.text === 'string' ? part.text : ''
          }
    ))
}

function normalizeChatContentPart(value: unknown): ChatContentPart | null {
  const part = asRecord(value)
  if (part.type === 'text') {
    return {
      type: 'text',
      text: typeof part.text === 'string' ? part.text : ''
    }
  }
  if (part.type === 'reasoning') {
    return {
      type: 'reasoning',
      text: typeof part.text === 'string' ? part.text : '',
      sendAsContext: part.sendAsContext === true
    }
  }
  if (part.type === 'tool_call') {
    return {
      type: 'tool_call',
      toolCallId: typeof part.toolCallId === 'string' ? part.toolCallId : '',
      toolName: typeof part.toolName === 'string' ? part.toolName : '',
      status: part.status === 'pending' || part.status === 'success' || part.status === 'error' ? part.status : 'pending',
      input: asRecord(part.input),
      output: part.output,
      error: typeof part.error === 'string' ? part.error : '',
      sendAsContext: part.sendAsContext === true,
      createdAt: typeof part.createdAt === 'string' ? part.createdAt : new Date(0).toISOString(),
      updatedAt: typeof part.updatedAt === 'string' ? part.updatedAt : new Date(0).toISOString(),
      extensions: asRecord(part.extensions)
    }
  }
  return null
}

function normalizeChatContentParts(value: unknown): ChatContentPart[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeChatContentPart)
    .filter((part): part is ChatContentPart => part !== null)
}

function normalizeMixedBlock(value: unknown, canonicalOriginals: Map<number, OriginalChatBlock>): MixedChatBlock {
  const record = asRecord(value)
  const rawOriginal = asRecord(record.original)
  const originalId = typeof rawOriginal.id === 'number' ? rawOriginal.id : null
  const original = originalId === null
    ? undefined
    : cloneJson((canonicalOriginals.get(originalId) ?? rawOriginal) as OriginalChatBlock)
  const rawLlm = asRecord(record.llm)
  const rawUser = asRecord(record.user)
  return {
    role: normalizeChatBlockTargetRole(record.role),
    original,
    llm: hasOwn(record, 'llm')
      ? (hasOwn(rawLlm, 'content') ? { content: llmContent(rawLlm.content) } : {})
      : undefined,
    user: hasOwn(record, 'user')
      ? (Array.isArray(rawUser.contentParts) ? { contentParts: normalizeChatContentParts(rawUser.contentParts) } : {})
      : undefined,
    pluginData: asRecord(record.pluginData)
  }
}

function validateOriginalSequence(blocks: MixedChatBlock[], expectedOriginalIds: number[]): void {
  const actualOriginalIds = blocks
    .map(block => block.original?.id)
    .filter((id): id is number => typeof id === 'number')
  if (actualOriginalIds.length !== expectedOriginalIds.length) {
    throw new Error('插件处理结果缺少或新增了带 original 的聊天块。')
  }
  for (let index = 0; index < expectedOriginalIds.length; index += 1) {
    if (actualOriginalIds[index] !== expectedOriginalIds[index]) {
      throw new Error('插件处理结果改变了 original 聊天块的相对顺序。')
    }
  }
}

function normalizeProcessingChat(
  value: unknown,
  previous: ProcessingChat,
  canonicalOriginals: Map<number, OriginalChatBlock>,
  expectedOriginalIds: number[]
): ProcessingChat {
  const record = asRecord(value)
  const chatRecord = asRecord(record.chatSession)
  const blocks = Array.isArray(record.chatBlocks)
    ? record.chatBlocks.map(block => normalizeMixedBlock(block, canonicalOriginals))
    : previous.chatBlocks
  validateOriginalSequence(blocks, expectedOriginalIds)
  return {
    chatSession: {
      ...previous.chatSession,
      pluginData: asRecord(chatRecord.pluginData ?? previous.chatSession.pluginData)
    },
    pluginData: asRecord(record.pluginData),
    chatBlocks: blocks
  }
}

function messageFromMixedBlock(block: MixedChatBlock): ChatGenerationPreviewMessage | null {
  if (block.llm) {
    if (!hasOwn(block.llm as JsonRecord, 'content')) return null
    const content = block.llm.content
    if (content === undefined) return null
    return {
      role: block.role,
      content,
      blockId: block.original?.id
    }
  }

  if (!block.original?.enabled) return null
  const content = textFromContentParts(block.original.contentParts).trim()
  if (!content) return null
  return {
    role: block.role,
    content,
    blockId: block.original.id
  }
}

export function messagesFromProcessingChat(processingChat: ProcessingChat): ChatGenerationPreviewMessage[] {
  return processingChat.chatBlocks
    .map(messageFromMixedBlock)
    .filter((message): message is ChatGenerationPreviewMessage => message !== null)
    .filter(messageHasContent)
}

export async function preparePluginChatProcessing(
  project: ProjectSnapshot,
  chat: ChatSession,
  blocks: DbChatBlock[]
): Promise<PluginChatProcessingBundle> {
  const plugins = activePlugins(project, chat)
  const processingChat = processingChatFromDbBlocks(chat, blocks)
  const canonicalOriginals = new Map(processingChat.chatBlocks
    .map(block => block.original)
    .filter((original): original is OriginalChatBlock => Boolean(original))
    .map(original => [original.id, original]))
  const expectedOriginalIds = blocks.map(block => block.id)
  const runtime = pluginRuntimeDescriptor(project, plugins)
  const result = await invokePluginWorker('preparePluginChatProcessing', {
    runtime,
    blocks: processingChat.chatBlocks.map(block => block.original).filter(Boolean),
    chat: processingChat.chatSession,
    hostChat: chat,
    processingChat
  }, String(runtime.signature))
  const normalized = normalizeProcessingChat(result, processingChat, canonicalOriginals, expectedOriginalIds)
  return {
    messages: messagesFromProcessingChat(normalized),
    processingChat: normalized,
    toolDefinitions: toolDefinitionsForChat(plugins, chat.runtimeConfig.toolDefinitions)
  }
}

function toolCallManifestByName(plugin: PluginManifest, name: string): PluginToolCallManifest | null {
  return plugin.entry?.toolCalls?.find(toolCall => toolCall.name === name) ?? null
}

function toolDefinitionsForChat(plugins: PluginDescriptor[], configuredTools: ChatToolDefinition[]): LlmToolDefinition[] {
  const pluginById = new Map(plugins.map(plugin => [plugin.manifest.id, plugin.manifest]))
  const definitions: LlmToolDefinition[] = []
  for (const configuredTool of configuredTools) {
    const pluginId = configuredTool.pluginId
    const toolCallName = configuredTool.toolCallName
    const plugin = pluginById.get(pluginId)
    const toolCall = plugin ? toolCallManifestByName(plugin, toolCallName) : null
    if (!plugin || !toolCall) continue
    for (const schema of toolCall.tools ?? []) {
      definitions.push({
        pluginId,
        toolCallName,
        toolName: schema.name,
        description: schema.description,
        inputSchema: schema.inputSchema,
        commonArgs: asRecord(configuredTool.commonArgs)
      })
    }
  }
  return definitions
}

export function availableToolCalls(project: ProjectSnapshot, chat: ChatSession): Array<{
  plugin: PluginManifest
  toolCall: PluginToolCallManifest
}> {
  return activePlugins(project, chat).flatMap(descriptor => (
    descriptor.manifest.entry?.toolCalls?.map(toolCall => ({
      plugin: descriptor.manifest,
      toolCall
    })) ?? []
  ))
}

export async function handlePluginToolCallRequest(project: ProjectSnapshot, request: PluginToolCallRequest): Promise<void> {
  try {
    const runtime = pluginRuntimeDescriptor(project)
    const output = await invokePluginWorker('handlePluginToolCallRequest', {
      runtime,
      request
    }, String(runtime.signature))
    await window.electronAPI.resolvePluginToolCall({ requestId: request.requestId, ok: true, output })
  } catch (error) {
    await window.electronAPI.resolvePluginToolCall({
      requestId: request.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

export function startPluginToolBridge(getProject: () => ProjectSnapshot | null): void {
  if (toolRequestUnsubscribe) return
  toolRequestUnsubscribe = window.electronAPI.onPluginToolCallRequest(request => {
    const project = getProject()
    if (!project) {
      void window.electronAPI.resolvePluginToolCall({
        requestId: request.requestId,
        ok: false,
        error: '项目尚未加载。'
      })
      return
    }
    void handlePluginToolCallRequest(project, request)
  })
}
