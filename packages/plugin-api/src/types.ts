export type JsonRecord = Record<string, unknown>

export interface PluginToolSchema {
  name: string
  description: string
  inputSchema: JsonRecord
}

export interface PluginToolCallManifest {
  name: string
  label?: string
  handler?: string
  prompt?: string
  tools?: PluginToolSchema[]
  settingsHtml?: string
}

export interface PluginManifestEntry {
  initGlobal?: string
  initChat?: string
  chatBlockProcessor?: string
  toolCalls?: PluginToolCallManifest[]
  settingsHtml?: string
  chatHtml?: string
}

export interface PluginManifest {
  id: string
  name?: string
  description?: string
  versionCode: number
  dependencies?: string[]
  entry?: PluginManifestEntry
}

export interface PluginDescriptor {
  manifest: PluginManifest
  source: 'project'
}

export interface PluginFileEntry {
  name: string
  path: string
  isDirectory: boolean
  size?: number
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
  llmInstanceSnapshot: unknown | null
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
  messages?: ChatGenerationPreviewMessage[]
  toolDefinitions?: LlmToolDefinition[]
  promptMetadata?: JsonRecord
}

export interface ChatGenerationPreviewMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ChatContentPart[]
  blockId?: number
}

export interface LlmToolDefinition {
  pluginId: string
  toolCallName: string
  toolName: string
  description: string
  inputSchema: JsonRecord
  commonArgs: JsonRecord
}

export interface PluginToolCallRequest {
  requestId: string
  chatId: number
  pluginId: string
  toolCallName: string
  toolName: string
  input: JsonRecord
  commonArgs: JsonRecord
}

export interface PluginToolCallResponse {
  requestId: string
  ok: boolean
  output?: unknown
  error?: string
}

export interface PluginStorageApi {
  list(path?: string): Promise<PluginFileEntry[]>
  listFor(pluginId: string, path?: string): Promise<PluginFileEntry[]>
  readText(path: string): Promise<string>
  readTextFor(pluginId: string, path: string): Promise<string>
  readBase64(path: string): Promise<string>
  readBase64For(pluginId: string, path: string): Promise<string>
  writeText(path: string, content: string): Promise<void>
  writeTextFor(pluginId: string, path: string, content: string): Promise<void>
  writeBase64(path: string, content: string): Promise<void>
  writeBase64For(pluginId: string, path: string, content: string): Promise<void>
  delete(path: string): Promise<void>
  deleteFor(pluginId: string, path: string): Promise<void>
  readJson(path: string, fallback?: unknown): Promise<unknown>
  readJsonFor(pluginId: string, path: string, fallback?: unknown): Promise<unknown>
  writeJson(path: string, value: unknown): Promise<void>
  writeJsonFor(pluginId: string, path: string, value: unknown): Promise<void>
}

export interface PluginChatApi {
  getSession(): ChatSession | null
  getPluginData(): JsonRecord
  setPluginData(value: JsonRecord): Promise<ChatSession | null>
  getBlockPluginData(blockId: number): JsonRecord
  setBlockPluginData(blockId: number, value: JsonRecord): Promise<ChatBlock | null>
}

export interface PluginRuntimeApi {
  assetUrl(path: string): string
  chat: PluginChatApi
  storage: PluginStorageApi
}

export interface PluginScopes {
  global: Record<string, unknown>
  chat: Record<string, unknown>
}

export interface PluginRuntimeContext {
  api: PluginRuntimeApi
  plugin: PluginManifest
  chat?: ChatSession
  blocks?: ChatBlock[]
  project?: unknown
}

export interface PluginProcessorState {
  blocks: ChatBlock[]
  chat: ChatSession
  messages: ChatGenerationPreviewMessage[]
  project: unknown
  virtualBlocks: ChatBlock[]
}

export interface PluginProcessorResult {
  blocks?: ChatBlock[]
  displayBlocks?: ChatBlock[]
  messages?: ChatGenerationPreviewMessage[]
  virtualBlocks?: ChatBlock[]
  metadata?: JsonRecord
}

export interface PluginChatBlockProcessor {
  process(state: PluginProcessorState): Promise<PluginProcessorResult> | PluginProcessorResult
}

export interface PluginToolHandler {
  handle(request: PluginToolCallRequest): Promise<unknown> | unknown
}

export type IpcJsonPayload<T> = T | string
