import type { WebContents } from 'electron'
import { jsonSchema, stepCountIs, streamText, tool, type LanguageModelUsage } from 'ai'
import { buildSillyTavernLikePrompt } from '../../shared/st-prompt-builder'
import { LOREBOOK_EDIT_TOOL_GROUP, LOREBOOK_EDIT_TOOL_NAMES, loreBookToolFieldHints } from '../../shared/lorebook-tooling'
import type {
  ChatBlock,
  ChatBlockTokenUsage,
  ChatContentPart,
  ChatGenerationEvent,
  ChatGenerationPreview,
  ChatGenerationPreviewMessage,
  ChatGenerationRequest,
  ChatGenerationStartResult,
  JsonRecord,
  LlmGenerationParameters,
  LlmInstance,
  LlmProvider,
  ProviderModelCacheItem
} from '../../shared/types'
import {
  getLoreBookDraftEntriesJson,
  listLoreBookDraftEntries,
  testLoreBookDraftTrigger,
  upsertLoreBookDraftEntry,
  type LoreBookEntryUpsertInput
} from './lorebook-drafts'
import {
  createAssistantGenerationBlock,
  getChat,
  getLlmInstance,
  getLlmProvider,
  listCharacters,
  listChatBlocksForChat,
  listLoreBooks,
  listWorldEntries,
  prepareAssistantBlockForRegeneration,
  updateAssistantGenerationBlock,
  updateLlmProviderModelsCache
} from './store'

type ModelMessage = ChatGenerationPreviewMessage

interface ActiveGeneration {
  abortController: AbortController
  blockId: number
  chatId: number
}

const activeGenerations = new Map<number, ActiveGeneration>()

const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>
const LEGACY_LOREBOOK_EDIT_TOOL_NAMES = [
  'list_lorebook_entries',
  'test_lorebook_trigger',
  'upsert_lorebook_entry'
] as const

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function headersFromConfig(config: JsonRecord): Record<string, string> {
  const headers = asRecord(config.headers)
  return Object.fromEntries(
    Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
}

function configString(config: JsonRecord, key: string, fallback = ''): string {
  return asString(config[key], fallback).trim()
}

function ensureBaseURL(value: string, fallback: string): string {
  return (value.trim() || fallback).replace(/\/+$/, '')
}

function blockText(block: ChatBlock): string {
  return block.contentParts
    .map(part => {
      if (part.type === 'text') return part.text
      if (part.type !== 'tool_call' || part.sendAsContext !== true) return ''
      return [
        `[Tool call: ${part.toolName}]`,
        `input: ${JSON.stringify(part.input)}`,
        part.status === 'success' ? `output: ${JSON.stringify(part.output ?? null)}` : '',
        part.status === 'error' ? `error: ${part.error ?? ''}` : ''
      ].filter(Boolean).join('\n')
    })
    .join('')
}

function blockReasoningText(block: ChatBlock): string {
  return block.contentParts.filter(part => part.type === 'reasoning').map(part => part.text).join('')
}

function shouldSendReasoning(block: ChatBlock): boolean {
  return block.metadata.sendReasoning === true
}

function usageNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeUsage(usage: LanguageModelUsage | null | undefined): ChatBlockTokenUsage | null {
  if (!usage) return null
  const normalized: ChatBlockTokenUsage = {
    inputTokens: usageNumber(usage.inputTokens),
    inputTokenDetails: {
      noCacheTokens: usageNumber(usage.inputTokenDetails?.noCacheTokens),
      cacheReadTokens: usageNumber(usage.inputTokenDetails?.cacheReadTokens),
      cacheWriteTokens: usageNumber(usage.inputTokenDetails?.cacheWriteTokens)
    },
    outputTokens: usageNumber(usage.outputTokens),
    outputTokenDetails: {
      textTokens: usageNumber(usage.outputTokenDetails?.textTokens),
      reasoningTokens: usageNumber(usage.outputTokenDetails?.reasoningTokens)
    },
    totalTokens: usageNumber(usage.totalTokens)
  }
  const raw = asRecord(usage.raw)
  if (Object.keys(raw).length > 0) normalized.raw = raw

  const hasTokenCount = [
    normalized.inputTokens,
    normalized.inputTokenDetails?.noCacheTokens,
    normalized.inputTokenDetails?.cacheReadTokens,
    normalized.inputTokenDetails?.cacheWriteTokens,
    normalized.outputTokens,
    normalized.outputTokenDetails?.textTokens,
    normalized.outputTokenDetails?.reasoningTokens,
    normalized.totalTokens
  ].some(value => typeof value === 'number')

  return hasTokenCount || normalized.raw ? normalized : null
}

function sendEvent(webContents: WebContents, event: ChatGenerationEvent): void {
  if (!webContents.isDestroyed()) {
    webContents.send('chat:generationEvent', event)
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function isMissingPackageError(error: unknown): boolean {
  return error instanceof Error && /Cannot find package|Cannot find module|ERR_MODULE_NOT_FOUND/.test(error.message)
}

async function importProvider(packageName: string): Promise<any> {
  try {
    return await dynamicImport(packageName)
  } catch (error) {
    if (isMissingPackageError(error)) {
      throw new Error(`缺少 AI SDK provider 包：${packageName}。请运行 pnpm add ${packageName} 后重试。`)
    }
    throw error
  }
}

function withApiKeyHeader(headers: Record<string, string>, apiKey: string): Record<string, string> {
  if (!apiKey) return headers
  if (headers.Authorization || headers.authorization) return headers
  return { ...headers, Authorization: `Bearer ${apiKey}` }
}

async function createLanguageModel(instance: LlmInstance, provider: LlmProvider): Promise<any> {
  const config = instance.providerSnapshot.config
  const headers = headersFromConfig(config)
  const apiKey = provider.apiKey.trim()

  if (!apiKey && instance.providerSnapshot.type !== 'ollama') {
    throw new Error('当前 LLM 实例绑定的提供商没有 API Key。')
  }

  switch (instance.providerSnapshot.type) {
    case 'openai': {
      const { createOpenAI } = await importProvider('@ai-sdk/openai')
      const openai = createOpenAI({
        apiKey,
        baseURL: configString(config, 'baseURL') || undefined,
        organization: configString(config, 'organization') || undefined,
        project: configString(config, 'project') || undefined,
        headers
      })
      return openai(instance.modelId)
    }
    case 'openai-compatible':
    case 'custom': {
      const { createOpenAICompatible } = await importProvider('@ai-sdk/openai-compatible')
      const baseURL = ensureBaseURL(configString(config, 'baseURL'), '')
      if (!baseURL) throw new Error('OpenAI-compatible 提供商需要 baseURL。')
      const compatible = createOpenAICompatible({
        name: instance.providerSnapshot.providerName || 'custom',
        baseURL,
        apiKey: apiKey || undefined,
        headers: withApiKeyHeader(headers, apiKey)
      })
      return compatible.chatModel(instance.modelId)
    }
    case 'anthropic': {
      const { createAnthropic } = await importProvider('@ai-sdk/anthropic')
      const anthropic = createAnthropic({
        apiKey,
        baseURL: configString(config, 'baseURL') || undefined,
        headers
      })
      return anthropic(instance.modelId)
    }
    case 'google': {
      const { createGoogleGenerativeAI } = await importProvider('@ai-sdk/google')
      const google = createGoogleGenerativeAI({
        apiKey,
        baseURL: configString(config, 'baseURL') || undefined,
        headers
      })
      return google(instance.modelId)
    }
    case 'ollama': {
      const { createOllama } = await importProvider('ollama-ai-provider-v2')
      const rawBaseURL = ensureBaseURL(configString(config, 'baseURL'), 'http://127.0.0.1:11434')
      const baseURL = rawBaseURL.endsWith('/api') ? rawBaseURL : `${rawBaseURL}/api`
      const ollama = createOllama({ baseURL, headers })
      return ollama(instance.modelId)
    }
    default:
      throw new Error('不支持的 LLM 提供商类型。')
  }
}

function providerOptionsKey(instance: LlmInstance): string {
  if (instance.providerSnapshot.type === 'openai-compatible') return 'openai-compatible'
  return instance.providerSnapshot.type
}

function generationSettings(instance: LlmInstance, abortSignal: AbortSignal): JsonRecord {
  const parameters = instance.parameters
  const settings: JsonRecord = { ...instance.extra }

  const setNumber = (key: keyof LlmGenerationParameters) => {
    const value = parameters[key]
    if (typeof value === 'number' && Number.isFinite(value)) settings[key] = value
  }

  setNumber('temperature')
  setNumber('topP')
  setNumber('maxOutputTokens')
  setNumber('frequencyPenalty')
  setNumber('presencePenalty')
  setNumber('topK')
  setNumber('seed')

  if (parameters.stopSequences?.length) {
    settings.stopSequences = parameters.stopSequences.filter(Boolean)
  }
  if (parameters.responseFormat === 'json') {
    settings.responseFormat = { type: 'json' }
  } else if (parameters.responseFormat === 'text') {
    settings.responseFormat = { type: 'text' }
  }

  const providerOptions = asRecord(settings.providerOptions)
  const providerKey = providerOptionsKey(instance)
  const providerOption = asRecord(providerOptions[providerKey])
  if (typeof parameters.repetitionPenalty === 'number' && Number.isFinite(parameters.repetitionPenalty)) {
    providerOption.repetitionPenalty = parameters.repetitionPenalty
  }
  if (parameters.reasoningEffort) {
    providerOption.reasoningEffort = parameters.reasoningEffort
    providerOption.effort = parameters.reasoningEffort
  }
  if (Object.keys(providerOption).length) {
    settings.providerOptions = { ...providerOptions, [providerKey]: providerOption }
  }

  settings.abortSignal = abortSignal
  settings.maxRetries = 0
  return settings
}

function redactSensitiveValue(key: string, value: unknown): unknown {
  if (/api[-_ ]?key|authorization|bearer|password|secret|token/i.test(key)) {
    return value ? '[redacted]' : value
  }
  return redactSensitiveFields(value)
}

function redactSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => redactSensitiveFields(item))
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, fieldValue]) => [
      key,
      redactSensitiveValue(key, fieldValue)
    ])
  )
}

function redactedRecord(value: JsonRecord): JsonRecord {
  return asRecord(redactSensitiveFields(value))
}

function redactedLlmInstance(instance: LlmInstance): LlmInstance {
  return {
    ...instance,
    providerSnapshot: {
      ...instance.providerSnapshot,
      config: redactedRecord(instance.providerSnapshot.config)
    },
    extra: redactedRecord(instance.extra)
  }
}

function previewGenerationSettings(instance: LlmInstance): JsonRecord {
  return {
    ...redactedRecord(generationSettings(instance, new AbortController().signal)),
    abortSignal: '[AbortSignal]'
  }
}

interface ActiveLoreBookToolDefinition {
  block: ChatBlock
  loreBookId: number
  loreBookName: string
  toolNames: Array<typeof LOREBOOK_EDIT_TOOL_NAMES[number]>
}

function numberFromToolDefinition(value: unknown): number | null {
  const number = Number(value)
  return Number.isInteger(number) ? number : null
}

function activeLoreBookToolDefinition(blocks: ChatBlock[]): ActiveLoreBookToolDefinition | null {
  const loreBooks = listLoreBooks()
  const loreBookById = new Map(loreBooks.map(book => [book.id, book]))
  const definitions = [...blocks]
    .filter(block => block.enabled && block.kind === 'tool_definition')
    .sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id)

  for (const block of definitions.reverse()) {
    const definition = asRecord(block.metadata.toolDefinition)
    if (asString(definition.group) !== LOREBOOK_EDIT_TOOL_GROUP) continue
    const loreBookId = numberFromToolDefinition(definition.loreBookId)
    if (loreBookId === null) continue
    const loreBook = loreBookById.get(loreBookId)
    if (!loreBook) continue
    const enabledTools = Array.isArray(definition.enabledTools)
      ? definition.enabledTools.filter((name): name is typeof LOREBOOK_EDIT_TOOL_NAMES[number] => (
          typeof name === 'string' && (LOREBOOK_EDIT_TOOL_NAMES as readonly string[]).includes(name)
        ))
      : [...LOREBOOK_EDIT_TOOL_NAMES]
    const hasLegacyFullSet = LEGACY_LOREBOOK_EDIT_TOOL_NAMES.every(name => enabledTools.includes(name))
    const toolNames = hasLegacyFullSet
      ? [...new Set([...enabledTools, 'get_lorebook_entries_json' as const])]
      : enabledTools
    return {
      block,
      loreBookId,
      loreBookName: loreBook.name,
      toolNames: toolNames.length > 0 ? toolNames : [...LOREBOOK_EDIT_TOOL_NAMES]
    }
  }

  return null
}

function loreBookToolSchemas() {
  return {
    list_lorebook_entries: jsonSchema<Record<string, never>>({
      type: 'object',
      properties: {},
      additionalProperties: false
    }),
    get_lorebook_entries_json: jsonSchema<{ ids: number[] }>({
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'number' },
          description: '要读取完整 JSON 的世界书条目 id 列表。可包含正式条目 id 或临时副本中新建条目的负数 id。'
        }
      },
      required: ['ids'],
      additionalProperties: false
    }),
    test_lorebook_trigger: jsonSchema<{ example: string }>({
      type: 'object',
      properties: {
        example: {
          type: 'string',
          description: '用于测试世界书触发的例句。系统会把它当作最新一条用户消息进行扫描。'
        }
      },
      required: ['example'],
      additionalProperties: false
    }),
    upsert_lorebook_entry: jsonSchema<LoreBookEntryUpsertInput>({
      type: 'object',
      properties: {
        id: {
          type: 'number',
          description: '要更新的世界书条目 id；不传或传入不存在的 id 时会新建条目，并返回新条目 id。'
        },
        title: { type: 'string', description: loreBookToolFieldHints.title },
        order: { type: 'number', description: loreBookToolFieldHints.order },
        position: {
          type: 'number',
          enum: [0, 1, 2, 3, 4, 5, 6, 7],
          description: `${loreBookToolFieldHints.position} 0=Before Char Defs，1=After Char Defs，2=Before Author's Note，3=After Author's Note，4=At Depth，5=Before Example Messages，6=After Example Messages，7=Outlet。`
        },
        role: {
          anyOf: [
            { type: 'number', enum: [0, 1, 2] },
            { type: 'string', enum: ['system', 'user', 'assistant'] }
          ],
          description: `${loreBookToolFieldHints.role} 0/system，1/user，2/assistant。`
        },
        depth: { type: 'number', description: loreBookToolFieldHints.depth },
        outletName: { type: 'string', description: loreBookToolFieldHints.outletName },
        probability: { type: 'number', minimum: 0, maximum: 100, description: loreBookToolFieldHints.probability },
        enabled: { type: 'boolean', description: loreBookToolFieldHints.enabled },
        constant: { type: 'boolean', description: loreBookToolFieldHints.constant },
        selective: { type: 'boolean', description: loreBookToolFieldHints.selective },
        selectiveLogic: {
          type: 'number',
          enum: [0, 1, 2, 3],
          description: `${loreBookToolFieldHints.selectiveLogic} 0=AND ANY，3=AND ALL，1=NOT ALL，2=NOT ANY。`
        },
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: loreBookToolFieldHints.keys
        },
        secondaryKeys: {
          type: 'array',
          items: { type: 'string' },
          description: loreBookToolFieldHints.secondaryKeys
        },
        content: { type: 'string', description: loreBookToolFieldHints.content }
      },
      additionalProperties: false
    })
  }
}

function loreBookEditTools(definition: ActiveLoreBookToolDefinition) {
  const schemas = loreBookToolSchemas()
  return {
    list_lorebook_entries: tool({
      description: `获取世界书「${definition.loreBookName}」临时副本中的所有条目，只返回 [id, title] 二元组。`,
      inputSchema: schemas.list_lorebook_entries,
      execute: async () => listLoreBookDraftEntries(definition.loreBookId)
    }),
    get_lorebook_entries_json: tool({
      description: `按 id 列表读取世界书「${definition.loreBookName}」临时副本中的完整条目 JSON，返回匹配到的 WorldEntry 对象列表。`,
      inputSchema: schemas.get_lorebook_entries_json,
      execute: async ({ ids }) => getLoreBookDraftEntriesJson(definition.loreBookId, ids)
    }),
    test_lorebook_trigger: tool({
      description: `用一条例句测试世界书「${definition.loreBookName}」临时副本会触发哪些条目，返回 id/title/reason/content。`,
      inputSchema: schemas.test_lorebook_trigger,
      execute: async ({ example }) => testLoreBookDraftTrigger(definition.loreBookId, example)
    }),
    upsert_lorebook_entry: tool({
      description: `更新或新建世界书「${definition.loreBookName}」临时副本中的条目。只允许编辑世界书编辑 UI 中除高级 JSON 以外的字段。`,
      inputSchema: schemas.upsert_lorebook_entry,
      execute: async (input) => upsertLoreBookDraftEntry(definition.loreBookId, input)
    })
  }
}

function generatedText(parts: ChatContentPart[]): string {
  return parts.filter(part => part.type === 'text').map(part => part.text).join('')
}

function hasVisibleGenerationParts(parts: ChatContentPart[]): boolean {
  return parts.some(part => (
    (part.type === 'text' || part.type === 'reasoning') ? part.text.trim().length > 0 : true
  ))
}

function appendTextDelta(parts: ChatContentPart[], type: 'text' | 'reasoning', text: string): ChatContentPart[] {
  const next = [...parts]
  const last = next.at(-1)
  if (last?.type === type) {
    next[next.length - 1] = { ...last, text: last.text + text }
    return next
  }
  next.push({ type, text })
  return next
}

function loreBookToolCallExtensions(definition: ActiveLoreBookToolDefinition | null): JsonRecord {
  if (!definition) return {}
  return {
    loreBookEdit: {
      sourceToolDefinitionBlockId: definition.block.id,
      loreBookId: definition.loreBookId,
      loreBookName: definition.loreBookName
    }
  }
}

function upsertToolCallPart(
  parts: ChatContentPart[],
  patch: {
    toolCallId: string
    toolName: string
    status: 'pending' | 'success' | 'error'
    input?: unknown
    output?: unknown
    error?: string
    extensions?: JsonRecord
  }
): ChatContentPart[] {
  const now = new Date().toISOString()
  const next = [...parts]
  const index = next.findIndex(part => part.type === 'tool_call' && part.toolCallId === patch.toolCallId)
  const current = index >= 0 && next[index].type === 'tool_call' ? next[index] : null
  const part = {
    type: 'tool_call' as const,
    toolCallId: patch.toolCallId,
    toolName: patch.toolName,
    status: patch.status,
    input: patch.input === undefined ? current?.input ?? {} : asRecord(patch.input),
    output: patch.output === undefined ? current?.output : patch.output,
    error: patch.error === undefined ? current?.error : patch.error,
    sendAsContext: current?.sendAsContext === true,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    extensions: patch.extensions ?? current?.extensions ?? {}
  }

  if (index >= 0) next[index] = part
  else next.push(part)
  return next
}

function contextBlocksForGeneration(chatId: number, regenerateBlockId?: number | null): ChatBlock[] {
  const blocks = listChatBlocksForChat(chatId)
  if (!regenerateBlockId) return blocks
  const target = blocks.find(block => block.id === regenerateBlockId)
  if (!target) throw new Error('要重新生成的助手块不存在。')
  if (target.kind !== 'assistant') throw new Error('只能重新生成助手块。')
  return blocks.filter(block => block.orderIndex < target.orderIndex)
}

function buildPrompt(chat: ReturnType<typeof getChat>, blocks: ChatBlock[]) {
  return buildSillyTavernLikePrompt({
    chat,
    characters: listCharacters(),
    loreBooks: listLoreBooks(),
    worldEntries: listWorldEntries(),
    blocks
  })
}

function previewContextBlocks(blocks: ChatBlock[], virtualBlocks: ChatBlock[]): ChatGenerationPreview['contextBlocks'] {
  return [...virtualBlocks, ...blocks].map(block => ({
    id: block.id,
    kind: block.kind,
    targetRole: block.targetRole,
    enabled: block.enabled,
    status: block.status,
    orderIndex: block.orderIndex,
    title: block.title,
    summary: block.summary,
    sendReasoning: shouldSendReasoning(block),
    text: blockText(block),
    reasoning: blockReasoningText(block),
    virtual: block.metadata.virtual === true
  }))
}

export function previewChatGeneration(request: ChatGenerationRequest): ChatGenerationPreview {
  const chat = getChat(request.chatId)
  const instanceId = chat.runtimeConfig.llmInstanceId
  if (!instanceId) {
    throw new Error('请先为当前聊天选择 LLM 实例。')
  }

  const instance = getLlmInstance(instanceId)
  if (!instance.providerId) {
    throw new Error('当前 LLM 实例没有绑定提供商，无法读取 API Key。')
  }

  const provider = getLlmProvider(instance.providerId)
  const contextBlocks = contextBlocksForGeneration(chat.id, request.regenerateBlockId)
    .filter(block => block.id !== request.regenerateBlockId)
  const prompt = buildPrompt(chat, contextBlocks)
  const loreBookTools = activeLoreBookToolDefinition(contextBlocks)
  const messages = prompt.messages
  if (!messages.length) {
    throw new Error('没有可发送的内容块。')
  }

  return {
    request: {
      chatId: request.chatId,
      regenerateBlockId: request.regenerateBlockId ?? null
    },
    chat,
    llmInstance: redactedLlmInstance(instance),
    provider: {
      id: provider.id,
      name: provider.name,
      type: provider.type,
      config: redactedRecord(provider.config),
      hasApiKey: provider.apiKey.trim().length > 0
    },
    streamTextOptions: {
      ...previewGenerationSettings(instance),
      model: {
        providerName: instance.providerSnapshot.providerName,
        providerType: instance.providerSnapshot.type,
        modelId: instance.modelId
      },
      tools: loreBookTools
        ? {
            activeTools: loreBookTools.toolNames,
            loreBookId: loreBookTools.loreBookId,
            loreBookName: loreBookTools.loreBookName,
            sourceBlockId: loreBookTools.block.id
          }
        : {},
      messages
    },
    contextBlocks: previewContextBlocks(contextBlocks, prompt.virtualBlocks),
    requestBlockIds: prompt.requestBlockIds
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /aborted|abort/i.test(error.message))
}

async function runGeneration(
  webContents: WebContents,
  instance: LlmInstance,
  provider: LlmProvider,
  messages: ModelMessage[],
  generationBlock: ChatBlock,
  abortController: AbortController,
  loreBookTools: ActiveLoreBookToolDefinition | null
): Promise<void> {
  let contentParts: ChatContentPart[] = []
  let lastPersistAt = 0
  let finishReason = ''
  let totalUsage: ChatBlockTokenUsage | null = null
  const persist = (force = false) => {
    const now = Date.now()
    if (!force && now - lastPersistAt < 500) return
    lastPersistAt = now
    updateAssistantGenerationBlock(generationBlock.id, contentParts, 'generating', false)
  }

  try {
    const model = await createLanguageModel(instance, provider)
    const settings = generationSettings(instance, abortController.signal)
    if (loreBookTools) {
      settings.tools = loreBookEditTools(loreBookTools)
      settings.activeTools = loreBookTools.toolNames
      if (!settings.stopWhen) settings.stopWhen = stepCountIs(8)
    }
    const result = streamText({
      ...settings,
      model,
      messages
    } as any)

    for await (const part of result.fullStream) {
      if (part.type === 'finish') {
        finishReason = part.finishReason
        totalUsage = normalizeUsage(part.totalUsage)
        continue
      }
      if (part.type === 'tool-call') {
        contentParts = upsertToolCallPart(contentParts, {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          status: 'pending',
          input: part.input,
          extensions: loreBookToolCallExtensions(loreBookTools)
        })
        persist(true)
        sendEvent(webContents, {
          type: 'delta',
          chatId: generationBlock.chatId,
          blockId: generationBlock.id,
          text: '',
          content: generatedText(contentParts),
          contentParts
        })
        continue
      }
      if (part.type === 'tool-result') {
        contentParts = upsertToolCallPart(contentParts, {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          status: 'success',
          input: part.input,
          output: part.output,
          extensions: loreBookToolCallExtensions(loreBookTools)
        })
        persist(true)
        sendEvent(webContents, {
          type: 'delta',
          chatId: generationBlock.chatId,
          blockId: generationBlock.id,
          text: '',
          content: generatedText(contentParts),
          contentParts
        })
        continue
      }
      if (part.type === 'tool-error') {
        const input = asRecord((part as any).input)
        contentParts = upsertToolCallPart(contentParts, {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          status: 'error',
          input,
          error: errorText((part as any).error),
          extensions: loreBookToolCallExtensions(loreBookTools)
        })
        persist(true)
        sendEvent(webContents, {
          type: 'delta',
          chatId: generationBlock.chatId,
          blockId: generationBlock.id,
          text: '',
          content: generatedText(contentParts),
          contentParts
        })
        continue
      }
      if (part.type !== 'text-delta' && part.type !== 'reasoning-delta') continue
      const text = part.text
      contentParts = appendTextDelta(contentParts, part.type === 'reasoning-delta' ? 'reasoning' : 'text', text)
      persist()
      sendEvent(webContents, {
        type: 'delta',
        chatId: generationBlock.chatId,
        blockId: generationBlock.id,
        text,
        content: generatedText(contentParts),
        contentParts
      })
    }

    if (!totalUsage) {
      try {
        totalUsage = normalizeUsage(await result.totalUsage)
      } catch {
        totalUsage = null
      }
    }
    const finishedAt = new Date().toISOString()
    const metadataPatch: JsonRecord = {
      generationFinishedAt: finishedAt,
      usageRecordedAt: finishedAt
    }
    if (finishReason) metadataPatch.finishReason = finishReason
    if (totalUsage) metadataPatch.usage = totalUsage

    const block = updateAssistantGenerationBlock(
      generationBlock.id,
      contentParts,
      'idle',
      hasVisibleGenerationParts(contentParts),
      '',
      metadataPatch
    )
    sendEvent(webContents, { type: 'finished', chatId: generationBlock.chatId, block })
  } catch (error) {
    if (isAbortError(error) || abortController.signal.aborted) {
      const block = updateAssistantGenerationBlock(
        generationBlock.id,
        contentParts,
        'stopped',
        hasVisibleGenerationParts(contentParts),
        '',
        { generationFinishedAt: new Date().toISOString() }
      )
      sendEvent(webContents, { type: 'stopped', chatId: generationBlock.chatId, block })
      return
    }

    const message = errorText(error)
    const block = updateAssistantGenerationBlock(
      generationBlock.id,
      contentParts,
      'error',
      false,
      message,
      { generationFinishedAt: new Date().toISOString() }
    )
    sendEvent(webContents, { type: 'error', chatId: generationBlock.chatId, block, error: message })
  } finally {
    activeGenerations.delete(generationBlock.chatId)
  }
}

export function startChatGeneration(
  request: ChatGenerationRequest,
  webContents: WebContents
): ChatGenerationStartResult {
  const chat = getChat(request.chatId)
  if (activeGenerations.has(chat.id)) {
    throw new Error('当前聊天已有正在生成的块。')
  }
  const instanceId = chat.runtimeConfig.llmInstanceId
  if (!instanceId) {
    throw new Error('请先为当前聊天选择 LLM 实例。')
  }

  const instance = getLlmInstance(instanceId)
  if (!instance.providerId) {
    throw new Error('当前 LLM 实例没有绑定提供商，无法读取 API Key。')
  }

  const provider = getLlmProvider(instance.providerId)
  const contextBlocks = contextBlocksForGeneration(chat.id, request.regenerateBlockId)
    .filter(block => block.id !== request.regenerateBlockId)
  const prompt = buildPrompt(chat, contextBlocks)
  const loreBookTools = activeLoreBookToolDefinition(contextBlocks)
  const messages = prompt.messages
  if (!messages.length) {
    throw new Error('没有可发送的内容块。')
  }

  const generationBlock = request.regenerateBlockId
    ? prepareAssistantBlockForRegeneration(request.regenerateBlockId, instance, prompt.requestBlockIds)
    : createAssistantGenerationBlock(chat.id, instance, prompt.requestBlockIds)
  const abortController = new AbortController()

  activeGenerations.set(chat.id, {
    abortController,
    blockId: generationBlock.id,
    chatId: chat.id
  })
  sendEvent(webContents, { type: 'started', chatId: chat.id, block: generationBlock })

  void runGeneration(webContents, instance, provider, messages, generationBlock, abortController, loreBookTools)

  return { block: generationBlock }
}

export function stopChatGeneration(chatId: number): boolean {
  const generation = activeGenerations.get(chatId)
  if (!generation) return false
  generation.abortController.abort(new Error('用户停止生成'))
  return true
}

export function hasActiveGeneration(chatId?: number): boolean {
  if (chatId !== undefined) return activeGenerations.has(chatId)
  return activeGenerations.size > 0
}

async function fetchJson(url: string, init: RequestInit): Promise<any> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`模型列表拉取失败：HTTP ${response.status}${text ? ` ${text.slice(0, 300)}` : ''}`)
  }
  return response.json()
}

function cacheItems(ids: string[], metadataById: Map<string, JsonRecord> = new Map()): ProviderModelCacheItem[] {
  const fetchedAt = new Date().toISOString()
  return [...new Set(ids)]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .map(id => ({
      id,
      displayName: id,
      metadata: metadataById.get(id) ?? {},
      fetchedAt
    }))
}

export async function fetchProviderModels(providerId: number): Promise<LlmProvider> {
  const provider = getLlmProvider(providerId)
  const config = provider.config
  const headers = headersFromConfig(config)
  let models: ProviderModelCacheItem[] = []

  if (provider.type === 'openai' || provider.type === 'openai-compatible' || provider.type === 'custom') {
    const baseURL = ensureBaseURL(
      configString(config, 'baseURL'),
      provider.type === 'openai' ? 'https://api.openai.com/v1' : ''
    )
    if (!baseURL) throw new Error('OpenAI-compatible 提供商需要 baseURL 才能拉取模型。')
    const json = await fetchJson(`${baseURL}/models`, {
      headers: withApiKeyHeader(headers, provider.apiKey)
    })
    const metadata = new Map<string, JsonRecord>()
    const ids = Array.isArray(json.data)
      ? json.data.map((item: unknown) => {
          const record = asRecord(item)
          const id = asString(record.id)
          if (id) metadata.set(id, record)
          return id
        })
      : []
    models = cacheItems(ids, metadata)
  } else if (provider.type === 'ollama') {
    const baseURL = ensureBaseURL(configString(config, 'baseURL'), 'http://127.0.0.1:11434')
    const json = await fetchJson(`${baseURL}/api/tags`, { headers })
    const metadata = new Map<string, JsonRecord>()
    const ids = Array.isArray(json.models)
      ? json.models.map((item: unknown) => {
          const record = asRecord(item)
          const id = asString(record.name)
          if (id) metadata.set(id, record)
          return id
        })
      : []
    models = cacheItems(ids, metadata)
  } else if (provider.type === 'anthropic') {
    const baseURL = ensureBaseURL(configString(config, 'baseURL'), 'https://api.anthropic.com/v1')
    const json = await fetchJson(`${baseURL}/models`, {
      headers: {
        ...headers,
        'anthropic-version': asString(config.anthropicVersion, '2023-06-01'),
        'x-api-key': provider.apiKey
      }
    })
    const ids = Array.isArray(json.data)
      ? json.data.map((item: unknown) => asString(asRecord(item).id))
      : []
    models = cacheItems(ids)
  } else if (provider.type === 'google') {
    const baseURL = ensureBaseURL(configString(config, 'baseURL'), 'https://generativelanguage.googleapis.com/v1beta')
    const url = new URL(`${baseURL}/models`)
    url.searchParams.set('key', provider.apiKey)
    const json = await fetchJson(url.toString(), { headers })
    const ids = Array.isArray(json.models)
      ? json.models.map((item: unknown) => {
          const name = asString(asRecord(item).name)
          return name.replace(/^models\//, '')
        })
      : []
    models = cacheItems(ids)
  }

  return updateLlmProviderModelsCache(providerId, models)
}
