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
  assetPath: string | null
  stData: JsonRecord
  forgeData: CharacterForgeData
}

export type CharacterUpdatePayload = Pick<CharacterEntry, 'id' | 'stData' | 'forgeData'>

export interface CharacterForgeData {
  loreBookId: number | null
  exportFileName?: string
  characterBookName?: string
}

export interface LoreBook {
  id: number
  name: string
  createdAt: string
  updatedAt: string
}

export type LoreBookUpdatePayload = Pick<LoreBook, 'id' | 'name'>

export interface WorldEntry {
  id: number
  loreBookId: number
  createdAt: string
  updatedAt: string
  stData: CharacterBookEntryData
  forgeData: JsonRecord
}

export type WorldEntryUpdatePayload = Pick<WorldEntry, 'id' | 'loreBookId' | 'stData' | 'forgeData'>

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
  loreBookId: number
  worldEntryIds: number[]
}

export interface PromptTag {
  id: number
  name: string
  createdAt: string
  updatedAt: string
}

export interface PromptSnippet {
  id: number
  title: string
  content: string
  tags: PromptTag[]
  createdAt: string
  updatedAt: string
}

export type PromptSnippetUpdatePayload = Pick<PromptSnippet, 'id' | 'title' | 'content'> & {
  tagIds: number[]
}

export interface PromptTagCreatePayload {
  name: string
}

export interface PromptTagUpdatePayload {
  id: number
  name: string
}

export interface ProjectConfig {
  schemaVersion: number
}

export interface ProjectSnapshot {
  path: string
  config: ProjectConfig
  characters: CharacterEntry[]
  loreBooks: LoreBook[]
  worldEntries: WorldEntry[]
  llmProviders: LlmProvider[]
  llmInstances: LlmInstance[]
  chats: ChatSession[]
  chatBlocks: ChatBlock[]
  promptTags: PromptTag[]
  promptSnippets: PromptSnippet[]
}

export interface ExportResult {
  historyPath: string
  savedPath?: string
}

export interface ImportFailure {
  filePath: string
  message: string
}

export interface ProjectImportResult {
  snapshot: ProjectSnapshot
  importedCharacterIds: number[]
  importedLoreBookIds: number[]
  importedWorldEntryIds: number[]
  failures: ImportFailure[]
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

export interface ChatRuntimeConfig {
  characterId: number | null
  llmInstanceId: number | null
  loreBookIds: number[]
}

export interface ChatSession {
  id: number
  title: string
  runtimeConfig: ChatRuntimeConfig
  createdAt: string
  updatedAt: string
}

export interface ChatUpdatePayload {
  id: number
  title?: string
  runtimeConfig?: ChatRuntimeConfig
}

export type ChatBlockKind = 'system' | 'user' | 'assistant' | 'injection' | 'tool_definition' | 'tool_call'
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
  insertRelativeBlockId?: number | null
  insertPlacement?: 'before' | 'after' | null
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

export interface ChatGenerationPreviewMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ChatContentPart[]
}

export interface ChatGenerationPreview {
  request: ChatGenerationRequest
  chat: ChatSession
  llmInstance: LlmInstance
  provider: {
    id: number
    name: string
    type: LlmProviderType
    config: JsonRecord
    hasApiKey: boolean
  }
  streamTextOptions: JsonRecord & {
    model: {
      providerName: string
      providerType: LlmProviderType
      modelId: string
    }
    messages: ChatGenerationPreviewMessage[]
  }
  contextBlocks: Array<Pick<ChatBlock, 'id' | 'kind' | 'targetRole' | 'enabled' | 'status' | 'orderIndex' | 'title' | 'summary'> & {
    sendReasoning: boolean
    text: string
    reasoning: string
    virtual?: boolean
  }>
  requestBlockIds: number[]
}

export interface LoreBookDraftChange {
  id: number
  kind: 'created' | 'updated'
  title: string
  original: CharacterBookEntryData | null
  draft: CharacterBookEntryData
}

export interface LoreBookDraftSummary {
  toolSessionId: string
  loreBookId: number
  loreBookName: string
  createdAt: string
  updatedAt: string
  changes: LoreBookDraftChange[]
}

export interface LoreBookDraftApplyPayload {
  toolSessionId: string
  entryIds: number[]
}

export interface ChatGenerationStartResult {
  block: ChatBlock
}

export type ChatGenerationEvent =
  | { type: 'started'; chatId: number; block: ChatBlock }
  | { type: 'block'; chatId: number; block: ChatBlock }
  | { type: 'delta'; chatId: number; blockId: number; text: string; content: string; contentParts: ChatContentPart[] }
  | { type: 'finished'; chatId: number; block: ChatBlock }
  | { type: 'stopped'; chatId: number; block: ChatBlock }
  | { type: 'error'; chatId: number; block: ChatBlock; error: string }

export type SidebarView = 'characters' | 'loreBooks' | 'chat' | 'prompts' | 'settings'

export type IpcJsonPayload<T> = T | string
