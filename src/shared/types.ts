import type {
  ChatBlockKind,
  ChatBlockStatus,
  ChatContentPart,
  ChatGenerationPreviewMessage,
  JsonRecord,
  OriginalChatBlock,
  ProcessingChat,
  PluginFrameApiMethod,
  PluginManifest,
  PluginToolCallRequest as PluginHandlerToolCallRequest,
  PluginFileEntry
} from '@huaian/plugin-api'

export type {
  ChatBlockKind,
  ChatBlockStatus,
  ChatBlockTargetRole,
  ChatContentPart,
  ChatGenerationPreviewMessage,
  HaExtApi,
  HaExtApiInstallOptions,
  HaExtChatApi,
  HaExtToolSettingsApi,
  JsonRecord,
  MixedChatBlock,
  OriginalChatBlock,
  ProcessingChat,
  PluginFileEntry,
  PluginFrameApiMethod,
  PluginGlobalExport,
  PluginGlobalRegistry,
  PluginManifest,
  PluginManifestEntry,
  PluginRuntimeContext,
  PluginStorageApi,
  PluginToolCallDefinition,
  PluginToolSchema,
  ReasoningContentPart,
  TextContentPart,
  ToolCallContentPart,
  ToolCallContentPartStatus
} from '@huaian/plugin-api'

export { PLUGIN_FRAME_API_METHODS } from '@huaian/plugin-api'

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
  toolDefinitions: ChatToolDefinition[]
}

export interface ChatToolDefinition {
  pluginId: string
  toolCallName: string
  commonArgs: JsonRecord
}

export interface ChatSession {
  id: number
  title: string
  runtimeConfig: ChatRuntimeConfig
  createdAt: string
  updatedAt: string
}

export interface DbChatBlock {
  id: number
  chatId: number
  kind: ChatBlockKind
  enabled: boolean
  status: ChatBlockStatus
  orderIndex: number
  contentParts: ChatContentPart[]
  metadata: JsonRecord
  llmInstanceSnapshot: LlmInstance | null
  errorText: string
  createdAt: string
  updatedAt: string
}

export interface DbChatBlockCreatePayload {
  chatId: number
  kind: ChatBlockKind
  enabled?: boolean
  contentParts: ChatContentPart[]
  metadata?: JsonRecord
  insertRelativeBlockId?: number | null
  insertPlacement?: 'before' | 'after' | null
}

export interface DbChatBlockUpdatePayload {
  id: number
  enabled?: boolean
  contentParts?: ChatContentPart[]
  metadata?: JsonRecord
  preserveStatus?: boolean
}

export interface LlmToolDefinition {
  pluginId: string
  toolCallName: string
  toolName: string
  description: string
  inputSchema: JsonRecord
  commonArgs: JsonRecord
  prompt?: string
}

export interface ChatGenerationRequest {
  chatId: number
  regenerateBlockId?: number | null
  messages?: ChatGenerationPreviewMessage[]
  toolDefinitions?: LlmToolDefinition[]
}

export interface PluginToolCallRequest extends PluginHandlerToolCallRequest {
  requestId: string
  pluginId: string
}

export interface PluginToolCallResponse {
  requestId: string
  ok: boolean
  output?: CloneableValue
  error?: string
}

export type CloneablePrimitive = string | number | boolean | null | undefined
export type CloneableRecord = { [key: string]: CloneableValue }
export type CloneableValue = CloneablePrimitive | CloneableValue[] | CloneableRecord
export type JsonRecordValue = JsonRecord[string]

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
  chatBlocks: DbChatBlock[]
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
  block: DbChatBlock
}

export type ChatGenerationEvent =
  | { type: 'started'; chatId: number; block: DbChatBlock }
  | { type: 'delta'; chatId: number; blockId: number; text: string; content: string; contentParts: ChatContentPart[] }
  | { type: 'finished'; chatId: number; block: DbChatBlock }
  | { type: 'stopped'; chatId: number; block: DbChatBlock }
  | { type: 'error'; chatId: number; block: DbChatBlock; error: string }

export type SidebarView = 'chat' | 'settings' | 'plugins'

export type IpcInvokeChannel =
  | 'project:get'
  | 'project:listRecent'
  | 'project:updateConfig'
  | 'project:open'
  | 'project:openPath'
  | 'llm:createProvider'
  | 'llm:updateProvider'
  | 'llm:deleteProvider'
  | 'llm:fetchProviderModels'
  | 'llm:clearProviderModelsCache'
  | 'llm:restoreProviderFromInstance'
  | 'llm:createInstance'
  | 'llm:updateInstance'
  | 'llm:deleteInstance'
  | 'chat:create'
  | 'chat:update'
  | 'chat:delete'
  | 'chat:createBlock'
  | 'chat:updateBlock'
  | 'chat:deleteBlock'
  | 'chat:startGeneration'
  | 'chat:previewGeneration'
  | 'chat:stopGeneration'
  | 'plugin:list'
  | 'plugin:readFile'
  | 'plugin:listDataFiles'
  | 'plugin:readDataFile'
  | 'plugin:readDataFileBase64'
  | 'plugin:writeDataFile'
  | 'plugin:writeDataFileBase64'
  | 'plugin:deleteDataFile'
  | 'plugin:toolCallResponse'
  | 'app:getVersion'
  | 'app:getName'
  | 'app:quit'

export type IpcRendererEventChannel = 'plugin:toolCallRequest' | 'chat:generationEvent'

export interface ElectronApi {
  getProject(): Promise<ProjectSnapshot>
  listRecentProjects(): Promise<RecentProject[]>
  updateProjectConfig(payload: ProjectConfigUpdatePayload): Promise<ProjectConfig>
  openProject(): Promise<ProjectSnapshot | null>
  openProjectPath(path: string): Promise<ProjectSnapshot>
  createLlmProvider(payload: LlmProviderCreatePayload): Promise<LlmProvider>
  updateLlmProvider(payload: LlmProviderUpdatePayload): Promise<LlmProvider>
  deleteLlmProvider(id: number): Promise<ProjectSnapshot>
  fetchLlmProviderModels(id: number): Promise<LlmProvider>
  clearLlmProviderModelsCache(id: number): Promise<LlmProvider>
  restoreProviderFromInstance(id: number): Promise<LlmProvider>
  createLlmInstance(payload: LlmInstanceCreatePayload): Promise<LlmInstance>
  updateLlmInstance(payload: LlmInstanceUpdatePayload): Promise<LlmInstance>
  deleteLlmInstance(id: number): Promise<ProjectSnapshot>
  createChat(payload?: ChatCreatePayload): Promise<ChatSession>
  updateChat(payload: ChatUpdatePayload): Promise<ChatSession>
  deleteChat(id: number): Promise<ProjectSnapshot>
  createChatBlock(payload: DbChatBlockCreatePayload): Promise<DbChatBlock>
  updateChatBlock(payload: DbChatBlockUpdatePayload): Promise<DbChatBlock>
  deleteChatBlock(id: number): Promise<ProjectSnapshot>
  startChatGeneration(payload: ChatGenerationRequest): Promise<ChatGenerationStartResult>
  previewChatGeneration(payload: ChatGenerationRequest): Promise<ChatGenerationPreviewMessage[]>
  stopChatGeneration(chatId: number): Promise<boolean>
  listPlugins(): Promise<PluginDescriptor[]>
  readPluginFile(pluginId: string, path: string): Promise<string>
  listPluginDataFiles(pluginId: string, path?: string): Promise<PluginFileEntry[]>
  readPluginDataFile(pluginId: string, path: string): Promise<string>
  readPluginDataFileBase64(pluginId: string, path: string): Promise<string>
  writePluginDataFile(pluginId: string, path: string, content: string): Promise<void>
  writePluginDataFileBase64(pluginId: string, path: string, content: string): Promise<void>
  deletePluginDataFile(pluginId: string, path: string): Promise<void>
  pluginAssetUrl(pluginId: string, path: string): string
  onPluginToolCallRequest(callback: (request: PluginToolCallRequest) => void): () => void
  resolvePluginToolCall(response: PluginToolCallResponse): Promise<void>
  onChatGenerationEvent(callback: (event: ChatGenerationEvent) => void): () => void
  getAppVersion(): Promise<string>
  getAppName(): Promise<string>
  quit(): Promise<void>
}

export interface PluginRuntimeWorkerRuntime {
  signature: string
  allPlugins: PluginDescriptor[]
  activePlugins: PluginDescriptor[]
}

export interface PluginRuntimeWorkerPrepareInput {
  runtime: PluginRuntimeWorkerRuntime
  blocks: OriginalChatBlock[]
  chat: ProcessingChat['chatSession']
  hostChat: ChatSession
  processingChat: ProcessingChat
}

export type PluginRuntimeWorkerMethod =
  | 'ensurePluginRuntime'
  | 'preparePluginChatProcessing'
  | 'listPluginToolCalls'
  | 'listPluginGlobalEntries'
  | 'handlePluginToolCallRequest'

export type PluginWorkerHostCallMethod =
  | 'plugin.readFile'
  | 'storage.list'
  | 'storage.readText'
  | 'storage.readBase64'
  | 'storage.writeText'
  | 'storage.writeBase64'
  | 'storage.delete'
  | 'frame.chat.getSession'
  | 'frame.chat.getPluginData'
  | 'frame.chat.setPluginData'
  | 'frame.toolSettings.getCommonArgs'
  | 'frame.toolSettings.setCommonArgs'

export interface PluginFrameCapabilities {
  chat?: boolean
  toolSettings?: boolean
}

export type PluginHostToWorkerMessage =
  | {
    source: 'ha-ext-worker-host'
    type: 'invoke'
    id: number
    method: 'ensurePluginRuntime'
    args: PluginRuntimeWorkerRuntime
  }
  | {
    source: 'ha-ext-worker-host'
    type: 'invoke'
    id: number
    method: 'preparePluginChatProcessing'
    args: PluginRuntimeWorkerPrepareInput
  }
  | {
    source: 'ha-ext-worker-host'
    type: 'invoke'
    id: number
    method: 'listPluginToolCalls'
    args: { runtime: PluginRuntimeWorkerRuntime }
  }
  | {
    source: 'ha-ext-worker-host'
    type: 'invoke'
    id: number
    method: 'listPluginGlobalEntries'
    args: { runtime: PluginRuntimeWorkerRuntime }
  }
  | {
    source: 'ha-ext-worker-host'
    type: 'invoke'
    id: number
    method: 'handlePluginToolCallRequest'
    args: { runtime: PluginRuntimeWorkerRuntime; request: PluginToolCallRequest }
  }
  | {
    source: 'ha-ext-worker-host'
    type: 'host-response'
    id: number
    ok: boolean
    value: JsonRecordValue
    error: string
  }
  | {
    source: 'ha-ext-worker-host'
    type: 'connect-frame'
    frameId: string
    pluginId: string
    capabilities: PluginFrameCapabilities
  }
  | {
    source: 'ha-ext-worker-host'
    type: 'disconnect-frame'
    frameId: string
  }

export type PluginWorkerToHostMessage =
  | { source: 'ha-ext-worker'; type: 'ready' }
  | {
    source: 'ha-ext-worker'
    type: 'host-call'
    id: number
    method: PluginWorkerHostCallMethod
    args: JsonRecord
  }
  | {
    source: 'ha-ext-worker'
    type: 'response'
    id: number
    ok: boolean
    value: JsonRecordValue
    error: string
  }

export type MessageWithoutSource<T> = T extends { source: string } ? Omit<T, 'source'> : never
export type PluginHostToWorkerPayload = MessageWithoutSource<PluginHostToWorkerMessage>
export type PluginWorkerToHostPayload = MessageWithoutSource<PluginWorkerToHostMessage>

export type PluginFrameHostMessage =
  | {
    source: 'ha-ext-api-host'
    type: 'connect'
    frameId: string
    pluginId: string
    capabilities: PluginFrameCapabilities
  }
  | {
    source: 'ha-ext-api-host'
    type: 'response'
    id: number
    ok: boolean
    value: JsonRecordValue
    error: string
  }

export interface PluginFrameClientCallMessage {
  source: 'ha-ext-api-client'
  type: 'call'
  id: number
  method: PluginFrameApiMethod
  args: JsonRecordValue[]
}
