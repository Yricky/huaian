import type {
  ChatBlock,
  ChatBlockKind,
  ChatContentPart,
  ChatGenerationPreviewMessage,
  JsonRecord,
  PluginManifest,
  PluginToolCallRequest as PluginHandlerToolCallRequest
} from '@st-forge/plugin-api'

export type {
  ChatBlock,
  ChatBlockKind,
  ChatBlockStatus,
  ChatBlockTargetRole,
  ChatContentPart,
  ChatGenerationPreviewMessage,
  JsonRecord,
  PluginFileEntry,
  PluginManifest,
  PluginManifestEntry,
  PluginToolCallManifest,
  PluginToolSchema,
  ReasoningContentPart,
  TextContentPart,
  ToolCallContentPart,
  ToolCallContentPartStatus
} from '@st-forge/plugin-api'

export interface PluginDescriptor {
  manifest: PluginManifest
  source: 'project'
}

export interface PluginProjectConfig {
  enabledPluginIds: string[]
}

export interface ChatCreationDefaults {
  enabledPluginIds: string[]
}

export interface ChatRuntimeConfig {
  llmInstanceId: number | null
  enabledPluginIds: string[]
  pluginData: JsonRecord
}

export interface ChatSession {
  id: number
  title: string
  runtimeConfig: ChatRuntimeConfig
  createdAt: string
  updatedAt: string
}

export interface ChatBlockCreatePayload {
  chatId: number
  kind: ChatBlockKind
  enabled?: boolean
  contentParts: ChatContentPart[]
  metadata?: JsonRecord
  insertRelativeBlockId?: number | null
  insertPlacement?: 'before' | 'after' | null
}

export interface ChatBlockUpdatePayload {
  id: number
  enabled?: boolean
  contentParts?: ChatContentPart[]
  metadata?: JsonRecord
}

export interface LlmToolDefinition {
  pluginId: string
  toolCallName: string
  toolName: string
  description: string
  inputSchema: JsonRecord
  commonArgs: JsonRecord
}

export interface ChatGenerationRequest {
  chatId: number
  regenerateBlockId?: number | null
  messages?: ChatGenerationPreviewMessage[]
  toolDefinitions?: LlmToolDefinition[]
  promptMetadata?: JsonRecord
}

export interface PluginToolCallRequest extends PluginHandlerToolCallRequest {
  requestId: string
  pluginId: string
}

export interface PluginToolCallResponse {
  requestId: string
  ok: boolean
  output?: unknown
  error?: string
}

export type IpcJsonPayload<T> = T | string

export interface ChatBlockTokenUsage {
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

export interface ProjectConfig {
  schemaVersion: number
  chatCreateDefaults: ChatCreationDefaults
  debugMode: boolean
  plugins: PluginProjectConfig
}

export interface ProjectConfigUpdatePayload {
  chatCreateDefaults?: ChatCreationDefaults
  debugMode?: boolean
  plugins?: PluginProjectConfig
}

export interface ProjectSnapshot {
  path: string
  config: ProjectConfig
  plugins: PluginDescriptor[]
  llmProviders: LlmProvider[]
  llmInstances: LlmInstance[]
  chats: ChatSession[]
  chatBlocks: ChatBlock[]
}

export interface RecentProject {
  path: string
  name: string
}

export type LlmProviderType = 'openai' | 'openai-compatible' | 'anthropic' | 'google' | 'ollama' | 'custom'

export interface ProviderModelCacheItem {
  id: string
  displayName: string
  metadata: JsonRecord
  fetchedAt: string
}

export interface LlmProvider {
  id: number
  name: string
  type: LlmProviderType
  apiKey: string
  createdAt: string
  updatedAt: string
  config: JsonRecord
  modelsCache: ProviderModelCacheItem[]
}

export type LlmProviderCreatePayload = Pick<LlmProvider, 'name' | 'type' | 'apiKey' | 'config'>
export type LlmProviderUpdatePayload = Pick<LlmProvider, 'id' | 'name' | 'type' | 'apiKey' | 'config'>

export interface LlmProviderSnapshot {
  providerName: string
  type: LlmProviderType
  config: JsonRecord
}

export interface LlmGenerationParameters {
  temperature?: number | null
  topP?: number | null
  maxOutputTokens?: number | null
  frequencyPenalty?: number | null
  presencePenalty?: number | null
  repetitionPenalty?: number | null
  topK?: number | null
  stopSequences?: string[]
  seed?: number | null
  reasoningEffort?: '' | 'low' | 'medium' | 'high' | null
  responseFormat?: '' | 'text' | 'json' | null
}

export interface LlmInstance {
  id: number
  name: string
  providerId: number | null
  modelId: string
  providerSnapshot: LlmProviderSnapshot
  parameters: LlmGenerationParameters
  extra: JsonRecord
  createdAt: string
  updatedAt: string
}

export interface LlmInstanceCreatePayload {
  name: string
  providerId: number | null
  modelId: string
  providerSnapshot: LlmProviderSnapshot
  parameters: LlmGenerationParameters
  extra: JsonRecord
}

export type LlmInstanceUpdatePayload = LlmInstanceCreatePayload & { id: number }

export interface ChatCreatePayload {
  title?: string
  runtimeConfig?: Partial<ChatRuntimeConfig>
}

export interface ChatUpdatePayload {
  id: number
  title?: string
  runtimeConfig?: ChatRuntimeConfig
}

export interface ChatGenerationStartResult {
  block: ChatBlock
}

export type ChatGenerationEvent =
  | { type: 'started'; chatId: number; block: ChatBlock }
  | { type: 'delta'; chatId: number; blockId: number; text: string; content: string; contentParts: ChatContentPart[] }
  | { type: 'finished'; chatId: number; block: ChatBlock }
  | { type: 'stopped'; chatId: number; block: ChatBlock }
  | { type: 'error'; chatId: number; block: ChatBlock; error: string }

export type SidebarView = 'chat' | 'settings' | 'plugins'
