export type JsonRecord = Record<string, unknown>
export type JsonRecordValue = JsonRecord[string]

export type CloneablePrimitive = string | number | boolean | null | undefined
export type CloneableRecord = { [key: string]: CloneableValue }
export type CloneableValue = CloneablePrimitive | CloneableValue[] | CloneableRecord

export interface AppManifest {
  id: string
  name?: string
  description?: string
  version: number
  icon?: string
}

export interface AppDescriptor {
  manifest: AppManifest
  source: 'project'
}

export interface AppFileEntry {
  name: string
  path: string
  isDirectory: boolean
  size?: number
}

export interface AppSessionRecord {
  id: number
  appId: string
  title: string
  version: number
  createdAt: string
  updatedAt: string
  lastOpenedAt: string
}

export interface AppSessionCreatePayload {
  appId: string
  title?: string
}

export interface AppSessionUpdatePayload {
  appId: string
  id: number
  title: string
}

export interface AppUninstallOptions {
  deleteConfigData: boolean
  deleteAllSaves: boolean
}

export type AppStorageKind = 'appData' | 'save'

export interface AppStorageDeleteOptions {
  recursive?: boolean
}

export interface ProjectConfig {
  schemaVersion: number
  debugMode: boolean
}

export interface ProjectConfigUpdatePayload {
  debugMode?: boolean
}

export interface ProjectSnapshot {
  path: string
  config: ProjectConfig
  apps: AppDescriptor[]
  appSessions: AppSessionRecord[]
  llmProviders: LlmProvider[]
  llmInstances: LlmInstance[]
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

export interface LlmInstance {
  id: number
  name: string
  providerId: number | null
  modelId: string
  extra: JsonRecord
  orderIndex: number
  createdAt: string
  updatedAt: string
}

export interface LlmInstanceCreatePayload {
  name: string
  providerId: number | null
  modelId: string
  extra: JsonRecord
}

export type LlmInstanceUpdatePayload = LlmInstanceCreatePayload & { id: number }

export type AppChatRole = 'system' | 'user' | 'assistant'
export type AppChatSessionStatus = 'idle' | 'generating' | 'stopped' | 'error'
export type AppChatMessageStatus = 'idle' | 'generating' | 'stopped' | 'error'
export type ToolCallContentPartStatus = 'pending' | 'success' | 'error'

export interface TextContentPart {
  type: 'text'
  text: string
}

export interface ReasoningContentPart {
  type: 'reasoning'
  text: string
  sendAsContext?: boolean
}

export interface ToolCallContentPart {
  type: 'tool_call'
  toolCallId: string
  toolName: string
  status: ToolCallContentPartStatus
  input: JsonRecord
  output?: unknown
  error?: string
  createdAt: string
  updatedAt: string
  extensions?: JsonRecord
}

export type AppChatContentPart = TextContentPart | ReasoningContentPart | ToolCallContentPart

export interface AppChatMessage {
  id: number
  role: AppChatRole
  contentParts: AppChatContentPart[]
  status: AppChatMessageStatus
  metadata: JsonRecord
  errorText: string
  createdAt: string
  updatedAt: string
}

export interface AppToolDefinition {
  name: string
  description: string
  inputSchema: JsonRecord
}

export interface AppLlmInstanceSummary {
  id: number
  name: string
}

export interface AppChatSessionState {
  id: number
  title: string
  messages: AppChatMessage[]
  tools: AppToolDefinition[]
  llmInstanceId: number | null
  allowUserReply: boolean
  options: string[]
  status: AppChatSessionStatus
  errorText: string
}

export interface AppChatSessionCreatePayload {
  title?: string
  messages?: AppChatMessage[]
  tools?: AppToolDefinition[]
  llmInstanceId?: number | null
  allowUserReply?: boolean
  options?: string[]
}

export type AppChatSessionUpdatePayload = Partial<Omit<AppChatSessionState, 'id'>>

export interface AppChatMessageCreatePayload {
  role: AppChatRole
  content?: string
  contentParts?: AppChatContentPart[]
  status?: AppChatMessageStatus
  metadata?: JsonRecord
  errorText?: string
}

export interface AppChatMessageUpdatePayload {
  role?: AppChatRole
  contentParts?: AppChatContentPart[]
  status?: AppChatMessageStatus
  metadata?: JsonRecord
  errorText?: string
}

export interface AppLlmGenerationRequest {
  appId: string
  appSessionId: number
  chatSessionId: number
  assistantMessageId: number
  llmInstanceId: number | null
  messages: AppChatMessage[]
  tools: AppToolDefinition[]
}

export interface AppLlmGenerationStartResult {
  appId: string
  appSessionId: number
  chatSessionId: number
  assistantMessageId: number
}

export type AppLlmGenerationEvent =
  | { type: 'started'; appId: string; appSessionId: number; chatSessionId: number; assistantMessageId: number }
  | {
    type: 'delta'
    appId: string
    appSessionId: number
    chatSessionId: number
    assistantMessageId: number
    text: string
    contentParts: AppChatContentPart[]
  }
  | {
    type: 'finished' | 'stopped'
    appId: string
    appSessionId: number
    chatSessionId: number
    assistantMessageId: number
    contentParts: AppChatContentPart[]
  }
  | {
    type: 'error'
    appId: string
    appSessionId: number
    chatSessionId: number
    assistantMessageId: number
    contentParts: AppChatContentPart[]
    error: string
  }

export interface AppToolCallRequest {
  requestId: string
  appId: string
  appSessionId: number
  chatSessionId: number
  toolName: string
  input: JsonRecord
}

export interface AppToolCallResponse {
  requestId: string
  ok: boolean
  output?: CloneableValue
  error?: string
}

export type AppFrameEvent =
  | { type: 'userMessage'; chatSessionId: number; text: string; source: 'composer' | 'option' }
  | { type: 'userStoppedReply'; chatSessionId: number }
  | { type: 'llmInstanceChanged'; chatSessionId: number; llmInstanceId: number }
  | { type: 'llmReplyStarted'; chatSessionId: number; assistantMessageId: number }
  | { type: 'llmReplyDelta'; chatSessionId: number; assistantMessageId: number; text: string; contentParts: AppChatContentPart[] }
  | { type: 'llmReplyFinished'; chatSessionId: number; assistantMessageId: number; contentParts: AppChatContentPart[] }
  | { type: 'llmReplyStopped'; chatSessionId: number; assistantMessageId: number; contentParts: AppChatContentPart[] }
  | { type: 'llmReplyError'; chatSessionId: number; assistantMessageId: number; contentParts: AppChatContentPart[]; error: string }
  | { type: 'toolCall'; requestId: string; chatSessionId: number; toolName: string; input: JsonRecord }

export interface AppFrameContext {
  appId: string
  appVersion: number
  appSessionId: number
  appSessionTitle: string
}

export type SidebarView = 'apps' | 'settings'

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
  | 'llm:createInstance'
  | 'llm:updateInstance'
  | 'llm:deleteInstance'
  | 'llm:reorderInstances'
  | 'haApp:install'
  | 'haApp:uninstall'
  | 'haApp:createSession'
  | 'haApp:updateSession'
  | 'haApp:deleteSession'
  | 'haApp:touchSession'
  | 'haApp:listStorage'
  | 'haApp:makeStorageDirectory'
  | 'haApp:readStorageFile'
  | 'haApp:readStorageFileBytes'
  | 'haApp:writeStorageFile'
  | 'haApp:writeStorageFileBytes'
  | 'haApp:deleteStoragePath'
  | 'haAppChat:startGeneration'
  | 'haAppChat:stopGeneration'
  | 'haAppChat:toolCallResponse'
  | 'app:getVersion'
  | 'app:getName'
  | 'app:quit'

export type IpcRendererEventChannel = 'haAppChat:generationEvent' | 'haAppChat:toolCallRequest'

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
  createLlmInstance(payload: LlmInstanceCreatePayload): Promise<LlmInstance>
  updateLlmInstance(payload: LlmInstanceUpdatePayload): Promise<LlmInstance>
  deleteLlmInstance(id: number): Promise<ProjectSnapshot>
  reorderLlmInstances(ids: number[]): Promise<ProjectSnapshot>
  installApp(): Promise<ProjectSnapshot>
  uninstallApp(appId: string, options: AppUninstallOptions): Promise<ProjectSnapshot>
  createAppSession(payload: AppSessionCreatePayload): Promise<AppSessionRecord>
  updateAppSession(payload: AppSessionUpdatePayload): Promise<AppSessionRecord>
  deleteAppSession(appId: string, id: number): Promise<ProjectSnapshot>
  touchAppSession(appId: string, id: number): Promise<AppSessionRecord>
  listAppStorage(kind: AppStorageKind, appId: string, appSessionId: number | null, path?: string): Promise<AppFileEntry[]>
  makeAppStorageDirectory(kind: AppStorageKind, appId: string, appSessionId: number | null, path: string): Promise<void>
  readAppStorageFile(kind: AppStorageKind, appId: string, appSessionId: number | null, path: string): Promise<string>
  readAppStorageFileBytes(kind: AppStorageKind, appId: string, appSessionId: number | null, path: string): Promise<ArrayBuffer>
  writeAppStorageFile(kind: AppStorageKind, appId: string, appSessionId: number | null, path: string, content: string): Promise<void>
  writeAppStorageFileBytes(kind: AppStorageKind, appId: string, appSessionId: number | null, path: string, content: ArrayBuffer): Promise<void>
  deleteAppStoragePath(kind: AppStorageKind, appId: string, appSessionId: number | null, path: string, options?: AppStorageDeleteOptions): Promise<void>
  appAssetUrl(appId: string, path: string): string
  startAppChatGeneration(payload: AppLlmGenerationRequest): Promise<AppLlmGenerationStartResult>
  stopAppChatGeneration(appId: string, appSessionId: number, chatSessionId?: number): Promise<boolean>
  resolveAppToolCall(response: AppToolCallResponse): Promise<void>
  onAppChatGenerationEvent(callback: (event: AppLlmGenerationEvent) => void): () => void
  onAppToolCallRequest(callback: (request: AppToolCallRequest) => void): () => void
  getAppVersion(): Promise<string>
  getAppName(): Promise<string>
  quit(): Promise<void>
}
