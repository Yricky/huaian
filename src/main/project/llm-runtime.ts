import type { WebContents } from 'electron'
import { randomUUID } from 'crypto'
import { jsonSchema, stepCountIs, streamText, tool, type LanguageModelUsage } from 'ai'
import type {
  AppChatContentPart,
  AppChatMessage,
  AppLlmGenerationEvent,
  AppLlmGenerationRequest,
  AppLlmGenerationStartResult,
  AppToolCallRequest,
  AppToolCallResponse,
  AppToolDefinition,
  CloneableValue,
  JsonRecord,
  JsonRecordValue,
  LlmGenerationParameters,
  LlmInstance,
  LlmProvider
} from '../../shared/types'
import { asRecord } from '../../shared/value-utils'
import {
  createLanguageModel,
  providerOptionsKey,
  resolveLlmProviderForInstance
} from './llm-provider'

type StreamTextMessage = { role: 'system' | 'user' | 'assistant'; content: string }

interface ActiveGeneration {
  abortController: AbortController
  appId: string
  appSessionId: number
  chatSessionId: number
}

interface ToolResult {
  ok: boolean
  output?: CloneableValue
  error?: string
}

interface TokenUsage {
  inputTokens?: number | null
  inputTokenDetails?: {
    noCacheTokens?: number | null
    cacheReadTokens?: number | null
    cacheWriteTokens?: number | null
  }
  outputTokens?: number | null
  outputTokenDetails?: {
    textTokens?: number | null
    reasoningTokens?: number | null
  }
  totalTokens?: number | null
  raw?: JsonRecord
}

const TOOL_ERROR_FLAG = '__huaianToolError'
const activeGenerations = new Map<string, ActiveGeneration>()
const pendingAppToolCalls = new Map<string, {
  reject: (error: Error) => void
  resolve: (value: ToolResult) => void
  timeout: ReturnType<typeof setTimeout>
}>()

function generationKey(appId: string, appSessionId: number, chatSessionId: number): string {
  return `${appId}\u0000${appSessionId}\u0000${chatSessionId}`
}

function generationKeyForRequest(request: Pick<AppLlmGenerationRequest, 'appId' | 'appSessionId' | 'chatSessionId'>): string {
  return generationKey(request.appId, request.appSessionId, request.chatSessionId)
}

function usageNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeUsage(usage: LanguageModelUsage | null | undefined): TokenUsage | null {
  if (!usage) return null
  const normalized: TokenUsage = {
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
  return normalized
}

function sendEvent(webContents: WebContents, event: AppLlmGenerationEvent): void {
  if (!webContents.isDestroyed()) {
    webContents.send('haAppChat:generationEvent', event)
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function resolveAppToolCall(response: AppToolCallResponse): void {
  const pending = pendingAppToolCalls.get(response.requestId)
  if (!pending) return
  pendingAppToolCalls.delete(response.requestId)
  clearTimeout(pending.timeout)
  if (response.ok) pending.resolve({ ok: true, output: response.output })
  else pending.resolve({ ok: false, error: response.error || '应用工具调用失败。' })
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

function invokeAppTool(
  webContents: WebContents,
  request: Omit<AppToolCallRequest, 'requestId'> & { requestId?: string }
): Promise<ToolResult> {
  const requestId = request.requestId ?? randomUUID()
  const toolRequest: AppToolCallRequest = {
    requestId,
    appId: request.appId,
    appSessionId: request.appSessionId,
    chatSessionId: request.chatSessionId,
    toolName: request.toolName,
    input: request.input
  }

  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      pendingAppToolCalls.delete(requestId)
      resolve({ ok: false, error: `应用工具调用超时：${request.toolName}` })
    }, 120_000)
    pendingAppToolCalls.set(requestId, {
      resolve,
      reject: error => resolve({ ok: false, error: error.message }),
      timeout
    })
    webContents.send('haAppChat:toolCallRequest', toolRequest)
  })
}

function appToolsForDefinitions(
  webContents: WebContents,
  request: AppLlmGenerationRequest
) {
  const tools: Record<string, ReturnType<typeof tool>> = {}
  for (const definition of request.tools) {
    tools[definition.name] = tool({
      description: definition.description,
      inputSchema: jsonSchema(definition.inputSchema as any),
      execute: async (input: JsonRecordValue) => {
        const result = await invokeAppTool(webContents, {
          appId: request.appId,
          appSessionId: request.appSessionId,
          chatSessionId: request.chatSessionId,
          toolName: definition.name,
          input: asRecord(input)
        })
        if (result.ok) return result.output ?? null
        return {
          [TOOL_ERROR_FLAG]: true,
          error: result.error || '应用工具调用失败。'
        }
      }
    } as any)
  }
  return tools
}

function generatedText(parts: AppChatContentPart[]): string {
  return parts.filter(part => part.type === 'text').map(part => part.text).join('')
}

function hasVisibleGenerationParts(parts: AppChatContentPart[]): boolean {
  return parts.some(part => (
    (part.type === 'text' || part.type === 'reasoning') ? part.text.trim().length > 0 : true
  ))
}

function appendTextDelta(parts: AppChatContentPart[], type: 'text' | 'reasoning', text: string): AppChatContentPart[] {
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
  parts: AppChatContentPart[],
  patch: {
    toolCallId: string
    toolName: string
    status: 'pending' | 'success' | 'error'
    input?: JsonRecordValue
    output?: CloneableValue
    error?: string
  }
): AppChatContentPart[] {
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
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    extensions: current?.extensions ?? {}
  }

  if (index >= 0) next[index] = part
  else next.push(part)
  return next
}

function toolCallContext(part: Extract<AppChatContentPart, { type: 'tool_call' }>): string {
  return [
    `Tool call: ${part.toolName}`,
    `Status: ${part.status}`,
    `Input: ${JSON.stringify(part.input)}`,
    part.status === 'error'
      ? `Error: ${part.error ?? ''}`
      : `Output: ${JSON.stringify(part.output ?? null)}`
  ].join('\n')
}

function messageText(message: AppChatMessage): string {
  return message.contentParts.map(part => {
    if (part.type === 'text') return part.text
    if (part.type === 'reasoning') return part.sendAsContext ? part.text : ''
    return toolCallContext(part)
  }).filter(Boolean).join('\n')
}

function preparedMessages(messages: AppChatMessage[]): StreamTextMessage[] {
  const prepared = messages
    .map(message => ({
      role: message.role,
      content: messageText(message).trim()
    }))
    .filter(message => message.content.length > 0)
  if (!prepared.length) throw new Error('当前 chatSession 没有可发送给 LLM 的上下文。')
  return prepared
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /aborted|abort/i.test(error.message))
}

function toolErrorFromOutput(output: unknown): string {
  const record = asRecord(output)
  return record[TOOL_ERROR_FLAG] === true ? String(record.error ?? '应用工具调用失败。') : ''
}

async function runGeneration(
  webContents: WebContents,
  request: AppLlmGenerationRequest,
  instance: LlmInstance,
  provider: LlmProvider,
  messages: StreamTextMessage[],
  abortController: AbortController
): Promise<void> {
  const key = generationKeyForRequest(request)
  let contentParts: AppChatContentPart[] = []
  let finishReason = ''
  let totalUsage: TokenUsage | null = null

  try {
    const model = await createLanguageModel(instance, provider)
    const settings = generationSettings(instance, abortController.signal)
    if (request.tools.length > 0) {
      settings.tools = appToolsForDefinitions(webContents, request)
      settings.activeTools = request.tools.map(definition => definition.name)
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
          input: part.input
        })
        sendEvent(webContents, {
          type: 'delta',
          appId: request.appId,
          appSessionId: request.appSessionId,
          chatSessionId: request.chatSessionId,
          assistantMessageId: request.assistantMessageId,
          text: '',
          contentParts
        })
        continue
      }
      if (part.type === 'tool-result') {
        const toolError = toolErrorFromOutput(part.output)
        contentParts = upsertToolCallPart(contentParts, {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          status: toolError ? 'error' : 'success',
          input: part.input,
          output: part.output as CloneableValue,
          error: toolError || undefined
        })
        sendEvent(webContents, {
          type: 'delta',
          appId: request.appId,
          appSessionId: request.appSessionId,
          chatSessionId: request.chatSessionId,
          assistantMessageId: request.assistantMessageId,
          text: '',
          contentParts
        })
        continue
      }
      if (part.type === 'tool-error') {
        contentParts = upsertToolCallPart(contentParts, {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          status: 'error',
          input: (part as any).input,
          output: { [TOOL_ERROR_FLAG]: true, error: errorText((part as any).error) },
          error: errorText((part as any).error)
        })
        sendEvent(webContents, {
          type: 'delta',
          appId: request.appId,
          appSessionId: request.appSessionId,
          chatSessionId: request.chatSessionId,
          assistantMessageId: request.assistantMessageId,
          text: '',
          contentParts
        })
        continue
      }
      if (part.type !== 'text-delta' && part.type !== 'reasoning-delta') continue
      const text = part.text
      contentParts = appendTextDelta(contentParts, part.type === 'reasoning-delta' ? 'reasoning' : 'text', text)
      sendEvent(webContents, {
        type: 'delta',
        appId: request.appId,
        appSessionId: request.appSessionId,
        chatSessionId: request.chatSessionId,
        assistantMessageId: request.assistantMessageId,
        text,
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

    if (finishReason || totalUsage) {
      const metadata: JsonRecord = {}
      if (finishReason) metadata.finishReason = finishReason
      if (totalUsage) metadata.usage = totalUsage
      const visible = hasVisibleGenerationParts(contentParts)
      if (!visible) contentParts = [{ type: 'text', text: '' }]
    }

    activeGenerations.delete(key)
    sendEvent(webContents, {
      type: 'finished',
      appId: request.appId,
      appSessionId: request.appSessionId,
      chatSessionId: request.chatSessionId,
      assistantMessageId: request.assistantMessageId,
      contentParts
    })
  } catch (error) {
    if (isAbortError(error) || abortController.signal.aborted) {
      activeGenerations.delete(key)
      sendEvent(webContents, {
        type: 'stopped',
        appId: request.appId,
        appSessionId: request.appSessionId,
        chatSessionId: request.chatSessionId,
        assistantMessageId: request.assistantMessageId,
        contentParts
      })
      return
    }

    const message = errorText(error)
    activeGenerations.delete(key)
    if (!contentParts.length) contentParts = [{ type: 'text', text: '' }]
    sendEvent(webContents, {
      type: 'error',
      appId: request.appId,
      appSessionId: request.appSessionId,
      chatSessionId: request.chatSessionId,
      assistantMessageId: request.assistantMessageId,
      contentParts,
      error: message
    })
  } finally {
    activeGenerations.delete(key)
  }
}

export async function startAppChatGeneration(
  request: AppLlmGenerationRequest,
  webContents: WebContents
): Promise<AppLlmGenerationStartResult> {
  const key = generationKeyForRequest(request)
  if (activeGenerations.has(key)) {
    throw new Error('当前 chatSession 已在生成回复。')
  }
  const { instance, provider } = resolveLlmProviderForInstance(request.llmInstanceId)
  const messages = preparedMessages(request.messages)
  const abortController = new AbortController()

  activeGenerations.set(key, {
    abortController,
    appId: request.appId,
    appSessionId: request.appSessionId,
    chatSessionId: request.chatSessionId
  })
  sendEvent(webContents, {
    type: 'started',
    appId: request.appId,
    appSessionId: request.appSessionId,
    chatSessionId: request.chatSessionId,
    assistantMessageId: request.assistantMessageId
  })

  void runGeneration(webContents, request, instance, provider, messages, abortController)

  return {
    appId: request.appId,
    appSessionId: request.appSessionId,
    chatSessionId: request.chatSessionId,
    assistantMessageId: request.assistantMessageId
  }
}

export function stopAppChatGeneration(appId: string, appSessionId: number, chatSessionId?: number): boolean {
  let stopped = false
  for (const [key, generation] of activeGenerations.entries()) {
    if (generation.appId !== appId || generation.appSessionId !== appSessionId) continue
    if (chatSessionId !== undefined && generation.chatSessionId !== chatSessionId) continue
    generation.abortController.abort(new Error('用户停止生成'))
    activeGenerations.delete(key)
    stopped = true
  }
  return stopped
}

export function hasActiveGeneration(appId?: string, appSessionId?: number): boolean {
  if (appId === undefined) return activeGenerations.size > 0
  for (const generation of activeGenerations.values()) {
    if (generation.appId !== appId) continue
    if (appSessionId !== undefined && generation.appSessionId !== appSessionId) continue
    return true
  }
  return false
}
