import type {
  JsonRecord,
  LlmInstance,
  LlmProvider,
  ProviderModelCacheItem
} from '../../shared/types'
import { asRecord, asString } from '../../shared/value-utils'
import {
  getLlmInstance,
  getLlmProvider,
  updateLlmProviderModelsCache
} from './store'

const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>

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

export function providerOptionsKey(instance: LlmInstance): string {
  if (instance.providerSnapshot.type === 'openai-compatible') return 'openai-compatible'
  return instance.providerSnapshot.type
}

export function resolveLlmProviderForInstance(instanceId: number | null): { instance: LlmInstance; provider: LlmProvider } {
  if (!instanceId) {
    throw new Error('请先为当前聊天选择 LLM 实例。')
  }

  const instance = getLlmInstance(instanceId)
  if (!instance.providerId) {
    throw new Error('当前 LLM 实例没有绑定提供商，无法读取 API Key。')
  }

  return {
    instance,
    provider: getLlmProvider(instance.providerId)
  }
}

export async function createLanguageModel(instance: LlmInstance, provider: LlmProvider): Promise<any> {
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
