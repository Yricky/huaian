export type JsonRecord = Record<string, unknown>

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

export interface CharacterEntry {
  id: number
  createdAt: string
  updatedAt: string
  stData: JsonRecord
  forgeData: CharacterForgeData
}

export type CharacterUpdatePayload = Pick<CharacterEntry, 'id' | 'stData' | 'forgeData'>

export interface CharacterForgeData {
  worldBookId: number | null
  exportFileName?: string
  characterBookName?: string
}

export interface WorldBook {
  id: number
  name: string
  createdAt: string
  updatedAt: string
}

export type WorldBookUpdatePayload = Pick<WorldBook, 'id' | 'name'>

export interface WorldEntry {
  id: number
  worldBookId: number
  createdAt: string
  updatedAt: string
  stData: CharacterBookEntryData
  forgeData: JsonRecord
}

export type WorldEntryUpdatePayload = Pick<WorldEntry, 'id' | 'worldBookId' | 'stData' | 'forgeData'>

export interface CharacterBookEntryData {
  id?: number
  keys: string[]
  secondary_keys?: string[]
  comment?: string
  content: string
  constant?: boolean
  selective?: boolean
  insertion_order: number
  enabled: boolean
  position?: 'before_char' | 'after_char'
  case_sensitive?: boolean
  extensions: JsonRecord
}

export interface WorldEntryOrderPayload {
  worldBookId: number
  worldEntryIds: number[]
}

export interface ProjectConfig {
  schemaVersion: number
}

export interface ProjectSnapshot {
  path: string
  config: ProjectConfig
  characters: CharacterEntry[]
  worldBooks: WorldBook[]
  worldEntries: WorldEntry[]
  llmProviders: LlmProvider[]
  llmInstances: LlmInstance[]
  chats: ChatSession[]
  chatBlocks: ChatBlock[]
}

export interface ExportResult {
  historyPath: string
  savedPath?: string
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

export interface ChatSession {
  id: number
  title: string
  llmInstanceId: number | null
  createdAt: string
  updatedAt: string
}

export interface ChatUpdatePayload {
  id: number
  title?: string
  llmInstanceId?: number | null
}

export type ChatBlockKind = 'system' | 'user' | 'assistant' | 'injection'
export type ChatBlockTargetRole = 'system' | 'user' | 'assistant'
export type ChatBlockStatus = 'idle' | 'generating' | 'stopped' | 'error'

export interface TextContentPart {
  type: 'text'
  text: string
}

export interface ReasoningContentPart {
  type: 'reasoning'
  text: string
}

export type ChatContentPart = TextContentPart | ReasoningContentPart

export interface ChatBlock {
  id: number
  chatId: number
  kind: ChatBlockKind
  targetRole: ChatBlockTargetRole
  enabled: boolean
  status: ChatBlockStatus
  orderIndex: number
  title: string
  summary: string
  contentParts: ChatContentPart[]
  metadata: JsonRecord
  llmInstanceSnapshot: LlmInstance | null
  requestBlockIds: number[]
  errorText: string
  createdAt: string
  updatedAt: string
}

export interface ChatBlockCreatePayload {
  chatId: number
  kind: ChatBlockKind
  targetRole?: ChatBlockTargetRole
  enabled?: boolean
  title?: string
  summary?: string
  contentParts: ChatContentPart[]
  metadata?: JsonRecord
}

export interface ChatBlockUpdatePayload {
  id: number
  enabled?: boolean
  title?: string
  summary?: string
  contentParts?: ChatContentPart[]
  metadata?: JsonRecord
  targetRole?: ChatBlockTargetRole
}

export interface ChatGenerationRequest {
  chatId: number
  regenerateBlockId?: number | null
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

export type SidebarView = 'characters' | 'worldBooks' | 'chat' | 'settings'

export type IpcJsonPayload<T> = T | string
