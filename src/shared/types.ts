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

export interface ChatCreationDefaults {
  characterId: number | null
  loreBookIds: number[]
  characterRegexScriptsEnabled: boolean
}

export interface PromptTemplateSettings {
  enabled: boolean
  generateEnabled: boolean
  generateLoaderEnabled: boolean
  renderEnabled: boolean
  renderLoaderEnabled: boolean
  rawMessageEvaluationEnabled: boolean
  filterMessageEnabled: boolean
  injectLoaderEnabled: boolean
  invertEnabled: boolean
  sandbox: boolean
  withContextDisabled: boolean
  debugEnabled: boolean
  cacheEnabled: 0 | 1 | 2
  cacheSize: number
}

export interface PromptTemplateProjectConfig {
  settings: PromptTemplateSettings
  globalVariables: JsonRecord
}

export interface PromptTemplateVariables {
  global: JsonRecord
  local: JsonRecord
  message: JsonRecord
  initial: JsonRecord
  cache: JsonRecord
}

export type PromptTemplateDiagnosticLevel = 'debug' | 'info' | 'warning' | 'error'

export interface PromptTemplateDiagnostic {
  level: PromptTemplateDiagnosticLevel
  phase: 'preprocess' | 'generate' | 'inject' | 'render' | 'variables'
  message: string
  source?: string
  entryId?: number
  loreBookId?: number
  blockId?: number
  details?: JsonRecord
}

export interface PromptTemplateRenderResult {
  text: string
  diagnostics: PromptTemplateDiagnostic[]
  variables: PromptTemplateVariables
}

export interface PromptTemplateBlockRenderRequest {
  chatId: number
  blockId: number
}

export interface PromptTemplateBlockRenderResult {
  blockId: number
  contentParts: ChatContentPart[]
  diagnostics: PromptTemplateDiagnostic[]
  variables: PromptTemplateVariables
}

export interface ProjectConfig {
  schemaVersion: number
  chatCreateDefaults: ChatCreationDefaults
  promptTemplate: PromptTemplateProjectConfig
}

export interface ProjectConfigUpdatePayload {
  chatCreateDefaults?: ChatCreationDefaults
  promptTemplate?: PromptTemplateProjectConfig
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
}

export interface RecentProject {
  path: string
  name: string
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
  characterRegexScriptsEnabled: boolean
  promptTemplateVariables: JsonRecord
}

export interface ChatSession {
  id: number
  title: string
  runtimeConfig: ChatRuntimeConfig
  createdAt: string
  updatedAt: string
}

export interface ChatCreatePayload {
  title?: string
  runtimeConfig?: Partial<ChatRuntimeConfig>
}

export interface ChatUpdatePayload {
  id: number
  title?: string
  runtimeConfig?: ChatRuntimeConfig
}

export type ChatBlockKind = 'system' | 'user' | 'assistant' | 'injection' | 'tool_definition'
export type ChatBlockTargetRole = 'system' | 'user' | 'assistant'
export type ChatBlockStatus = 'idle' | 'generating' | 'stopped' | 'error'

export interface TextContentPart {
  type: 'text'
  text: string
}

export interface ReasoningContentPart {
  type: 'reasoning'
  text: string
  sendAsContext?: boolean
}

export type ToolCallContentPartStatus = 'pending' | 'success' | 'error'

export interface ToolCallContentPart {
  type: 'tool_call'
  toolCallId: string
  toolName: string
  status: ToolCallContentPartStatus
  input: JsonRecord
  output?: unknown
  error?: string
  sendAsContext?: boolean
  createdAt: string
  updatedAt: string
  extensions: JsonRecord
}

export type ChatContentPart = TextContentPart | ReasoningContentPart | ToolCallContentPart

export interface ChatBlock {
  id: number
  chatId: number
  kind: ChatBlockKind
  enabled: boolean
  status: ChatBlockStatus
  orderIndex: number
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
  messages: ChatGenerationPreviewMessage[]
  templateDiagnostics: PromptTemplateDiagnostic[]
  templateVariables: PromptTemplateVariables
  contextBlocks: Array<Pick<ChatBlock, 'id' | 'kind' | 'enabled' | 'status' | 'orderIndex'> & {
    targetRole: ChatBlockTargetRole
    title: string
    summary: string
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
  loreBookId: number
  loreBookName: string
  createdAt: string
  updatedAt: string
  changes: LoreBookDraftChange[]
}

export interface LoreBookDraftApplyPayload {
  loreBookId: number
  entryIds: number[]
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

export type SidebarView = 'characters' | 'loreBooks' | 'chat' | 'settings'

export type IpcJsonPayload<T> = T | string
