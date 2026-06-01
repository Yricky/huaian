import type { WebContents } from 'electron'
import { randomUUID } from 'crypto'
import { jsonSchema, stepCountIs, streamText, tool, type LanguageModelUsage } from 'ai'
import { asRecord } from '../../shared/value-utils'
import type {
  DbChatBlock,
  ChatBlockTokenUsage,
  ChatContentPart,
  ChatGenerationEvent,
  ChatGenerationPreviewMessage,
  ChatGenerationRequest,
  ChatGenerationStartResult,
  LlmGenerationParameters,
  LlmInstance,
  LlmProvider,
  LlmToolDefinition,
  JsonRecord,
  PluginToolCallRequest,
  PluginToolCallResponse
} from '../../shared/types'
import {
  createAssistantGenerationBlock,
  getChat,
  listChatBlocksForChat,
  prepareAssistantBlockForRegeneration,
  updateAssistantGenerationBlock
} from './store'
import {
  createLanguageModel,
  providerOptionsKey,
  resolveLlmProviderForInstance
} from './llm-provider'

type ModelMessage = ChatGenerationPreviewMessage
type StreamTextMessage = Omit<ModelMessage, 'blockId'>

interface ActiveGeneration {
  abortController: AbortController
  blockId: number
  chatId: number
}

const activeGenerations = new Map<number, ActiveGeneration>()
const pendingPluginToolCalls = new Map<string, {
  reject: (error: Error) => void
  resolve: (value: unknown) => void
  timeout: ReturnType<typeof setTimeout>
}>()

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

export function resolvePluginToolCall(response: PluginToolCallResponse): void {
  const pending = pendingPluginToolCalls.get(response.requestId)
  if (!pending) return
  pendingPluginToolCalls.delete(response.requestId)
  clearTimeout(pending.timeout)
  if (response.ok) pending.resolve(response.output)
  else pending.reject(new Error(response.error || '插件工具调用失败。'))
}

function messageHasSendableContent(message: ModelMessage): boolean {
  if (typeof message.content === 'string') return message.content.trim().length > 0
  return message.content.some(part => {
    if (part.type === 'text' || part.type === 'reasoning') return part.text.trim().length > 0
    return true
  })
}

function streamTextMessage(message: ModelMessage): StreamTextMessage {
  return {
    role: message.role,
    content: message.content
  }
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

function pluginToolCallExtensions(definition: LlmToolDefinition | null): JsonRecord {
  if (!definition) return {}
  return {
    pluginTool: {
      pluginId: definition.pluginId,
      toolCallName: definition.toolCallName,
      commonArgs: definition.commonArgs
    }
  }
}

function invokePluginTool(
  webContents: WebContents,
  chatId: number,
  definition: LlmToolDefinition,
  input: unknown
): Promise<unknown> {
  const requestId = randomUUID()
  const request: PluginToolCallRequest = {
    requestId,
    chatId,
    pluginId: definition.pluginId,
    toolCallName: definition.toolCallName,
    toolName: definition.toolName,
    input: asRecord(input),
    commonArgs: asRecord(definition.commonArgs)
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingPluginToolCalls.delete(requestId)
      reject(new Error(`插件工具调用超时：${definition.toolName}`))
    }, 120_000)
    pendingPluginToolCalls.set(requestId, { resolve, reject, timeout })
    webContents.send('plugin:toolCallRequest', request)
  })
}

function pluginToolsForDefinitions(webContents: WebContents, chatId: number, definitions: LlmToolDefinition[]) {
  const tools: Record<string, ReturnType<typeof tool>> = {}
  for (const definition of definitions) {
    tools[definition.toolName] = tool({
      description: definition.description,
      inputSchema: jsonSchema(definition.inputSchema as any),
      execute: async (input: unknown) => invokePluginTool(webContents, chatId, definition, input)
    } as any)
  }
  return tools
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

function contextBlocksForGeneration(chatId: number, regenerateBlockId?: number | null): DbChatBlock[] {
  const blocks = listChatBlocksForChat(chatId)
  if (!regenerateBlockId) return blocks
  const target = blocks.find(block => block.id === regenerateBlockId)
  if (!target) throw new Error('要重新生成的助手块不存在。')
  if (target.kind !== 'assistant') throw new Error('只能重新生成助手块。')
  return blocks.filter(block => block.orderIndex < target.orderIndex)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /aborted|abort/i.test(error.message))
}

async function runGeneration(
  webContents: WebContents,
  chatId: number,
  instance: LlmInstance,
  provider: LlmProvider,
  messages: ModelMessage[],
  generationBlock: DbChatBlock,
  abortController: AbortController,
  toolDefinitions: LlmToolDefinition[]
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
    if (toolDefinitions.length > 0) {
      settings.tools = pluginToolsForDefinitions(webContents, chatId, toolDefinitions)
      settings.activeTools = toolDefinitions.map(definition => definition.toolName)
      if (!settings.stopWhen) settings.stopWhen = stepCountIs(8)
    }

    const result = streamText({
      ...settings,
      model,
      messages: messages.map(streamTextMessage)
    } as any)

    for await (const part of result.fullStream) {
      if (part.type === 'finish') {
        finishReason = part.finishReason
        totalUsage = normalizeUsage(part.totalUsage)
        continue
      }
      if (part.type === 'tool-call') {
        const pluginDefinition = toolDefinitions.find(definition => definition.toolName === part.toolName) ?? null
        contentParts = upsertToolCallPart(contentParts, {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          status: 'pending',
          input: part.input,
          extensions: pluginToolCallExtensions(pluginDefinition)
        })
        persist(true)
        sendEvent(webContents, {
          type: 'delta',
          chatId,
          blockId: generationBlock.id,
          text: '',
          content: generatedText(contentParts),
          contentParts
        })
        continue
      }
      if (part.type === 'tool-result') {
        const pluginDefinition = toolDefinitions.find(definition => definition.toolName === part.toolName) ?? null
        contentParts = upsertToolCallPart(contentParts, {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          status: 'success',
          input: part.input,
          output: part.output,
          extensions: pluginToolCallExtensions(pluginDefinition)
        })
        persist(true)
        sendEvent(webContents, {
          type: 'delta',
          chatId,
          blockId: generationBlock.id,
          text: '',
          content: generatedText(contentParts),
          contentParts
        })
        continue
      }
      if (part.type === 'tool-error') {
        const pluginDefinition = toolDefinitions.find(definition => definition.toolName === part.toolName) ?? null
        contentParts = upsertToolCallPart(contentParts, {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          status: 'error',
          input: (part as any).input,
          error: errorText((part as any).error),
          extensions: pluginToolCallExtensions(pluginDefinition)
        })
        persist(true)
        sendEvent(webContents, {
          type: 'delta',
          chatId,
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
        chatId,
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
    sendEvent(webContents, { type: 'finished', chatId, block })
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
      sendEvent(webContents, { type: 'stopped', chatId, block })
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
    sendEvent(webContents, { type: 'error', chatId, block, error: message })
  } finally {
    activeGenerations.delete(chatId)
  }
}

function preparedMessages(request: ChatGenerationRequest): ModelMessage[] {
  const messages = request.messages?.filter(messageHasSendableContent) ?? []
  if (!messages.length) {
    throw new Error('插件管线没有提供可发送上下文。')
  }
  return messages
}

export async function previewChatGeneration(request: ChatGenerationRequest): Promise<ChatGenerationPreviewMessage[]> {
  getChat(request.chatId)
  contextBlocksForGeneration(request.chatId, request.regenerateBlockId)
  return preparedMessages(request)
}

export async function startChatGeneration(
  request: ChatGenerationRequest,
  webContents: WebContents
): Promise<ChatGenerationStartResult> {
  const chat = getChat(request.chatId)
  if (activeGenerations.has(chat.id)) {
    throw new Error('当前聊天已有正在生成的块。')
  }
  const { instance, provider } = resolveLlmProviderForInstance(chat.runtimeConfig.llmInstanceId)
  contextBlocksForGeneration(chat.id, request.regenerateBlockId)
  const messages = preparedMessages(request)

  const generationBlock = request.regenerateBlockId
    ? prepareAssistantBlockForRegeneration(request.regenerateBlockId, instance)
    : createAssistantGenerationBlock(chat.id, instance)
  const currentGenerationBlock = generationBlock
  const abortController = new AbortController()

  activeGenerations.set(chat.id, {
    abortController,
    blockId: currentGenerationBlock.id,
    chatId: chat.id
  })
  sendEvent(webContents, { type: 'started', chatId: chat.id, block: currentGenerationBlock })

  void runGeneration(
    webContents,
    chat.id,
    instance,
    provider,
    messages,
    currentGenerationBlock,
    abortController,
    request.toolDefinitions ?? []
  )

  return { block: currentGenerationBlock }
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
