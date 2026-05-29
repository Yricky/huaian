import type { WebContents } from 'electron'
import { streamText } from 'ai'
import type {
  ChatBlock,
  ChatGenerationEvent,
  ChatGenerationRequest,
  ChatGenerationStartResult,
  JsonRecord,
  LlmGenerationParameters,
  LlmInstance,
  LlmProvider,
  ProviderModelCacheItem
} from '../../shared/types'
import {
  createAssistantGenerationBlock,
  getChat,
  getChatBlock,
  getLlmInstance,
  getLlmProvider,
  listChatBlocksForChat,
  prepareAssistantBlockForRegeneration,
  updateAssistantGenerationBlock,
  updateLlmProviderModelsCache
} from './store'

type ModelMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ActiveGeneration {
  abortController: AbortController
  blockId: number
  chatId: number
}

const activeGenerations = new Map<number, ActiveGeneration>()

const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>

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
  return block.contentParts.map(part => part.text).join('')
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

function blockRole(block: ChatBlock): 'system' | 'user' | 'assistant' {
  return block.kind === 'injection' ? block.targetRole : block.kind as 'system' | 'user' | 'assistant'
}

function requestMessages(blocks: ChatBlock[]): ModelMessage[] {
  return blocks
    .filter(block => block.enabled)
    .map(block => ({ block, content: blockText(block).trim() }))
    .filter(({ content }) => content.length > 0)
    .map(({ block, content }) => ({
      role: blockRole(block),
      content
    }))
}

function contextBlocksForGeneration(chatId: number, regenerateBlockId?: number | null): ChatBlock[] {
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
  instance: LlmInstance,
  provider: LlmProvider,
  blocks: ChatBlock[],
  generationBlock: ChatBlock,
  abortController: AbortController
): Promise<void> {
  let content = ''
  let lastPersistAt = 0
  const persist = (force = false) => {
    const now = Date.now()
    if (!force && now - lastPersistAt < 500) return
    lastPersistAt = now
    updateAssistantGenerationBlock(generationBlock.id, content, 'generating', false)
  }

  try {
    const model = await createLanguageModel(instance, provider)
    const result = streamText({
      ...generationSettings(instance, abortController.signal),
      model,
      messages: requestMessages(blocks)
    } as any)

    for await (const text of result.textStream) {
      content += text
      persist()
      sendEvent(webContents, {
        type: 'delta',
        chatId: generationBlock.chatId,
        blockId: generationBlock.id,
        text,
        content
      })
    }

    const block = updateAssistantGenerationBlock(generationBlock.id, content, 'idle', content.trim().length > 0)
    sendEvent(webContents, { type: 'finished', chatId: generationBlock.chatId, block })
  } catch (error) {
    if (isAbortError(error) || abortController.signal.aborted) {
      const block = updateAssistantGenerationBlock(
        generationBlock.id,
        content,
        'stopped',
        content.trim().length > 0
      )
      sendEvent(webContents, { type: 'stopped', chatId: generationBlock.chatId, block })
      return
    }

    const message = errorText(error)
    const block = updateAssistantGenerationBlock(generationBlock.id, content, 'error', false, message)
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
  if (!chat.llmInstanceId) {
    throw new Error('请先为当前聊天选择 LLM 实例。')
  }

  const instance = getLlmInstance(chat.llmInstanceId)
  if (!instance.providerId) {
    throw new Error('当前 LLM 实例没有绑定提供商，无法读取 API Key。')
  }

  const provider = getLlmProvider(instance.providerId)
  const contextBlocks = contextBlocksForGeneration(chat.id, request.regenerateBlockId)
    .filter(block => block.id !== request.regenerateBlockId)
  const messages = requestMessages(contextBlocks)
  if (!messages.length) {
    throw new Error('没有可发送的内容块。')
  }

  const requestBlockIds = contextBlocks
    .filter(block => block.enabled && blockText(block).trim().length > 0)
    .map(block => block.id)

  const generationBlock = request.regenerateBlockId
    ? prepareAssistantBlockForRegeneration(request.regenerateBlockId, instance, requestBlockIds)
    : createAssistantGenerationBlock(chat.id, instance, requestBlockIds)
  const abortController = new AbortController()

  activeGenerations.set(chat.id, {
    abortController,
    blockId: generationBlock.id,
    chatId: chat.id
  })
  sendEvent(webContents, { type: 'started', chatId: chat.id, block: generationBlock })

  void runGeneration(webContents, instance, provider, contextBlocks, generationBlock, abortController)

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
