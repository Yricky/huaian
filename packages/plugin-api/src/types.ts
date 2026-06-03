export type JsonRecord = Record<string, unknown>

export interface PluginToolSchema {
  name: string
  description: string
  inputSchema: JsonRecord
}

export interface PluginToolCallDefinition {
  name: string
  label?: string
  prompt?: string
  tools?: PluginToolSchema[]
  settingsHtml?: string
}

export interface PluginManifestEntry {
  initGlobal?: string
}

export interface PluginManifest {
  id: string
  name?: string
  description?: string
  versionCode: number
  dependencies?: string[]
  entry?: PluginManifestEntry
}

export interface PluginFileEntry {
  name: string
  path: string
  isDirectory: boolean
  size?: number
}

export interface ChatSession {
  id: number
  title: string
  pluginData: JsonRecord
  createdAt: string
  updatedAt: string
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

export type LLMContentPart = TextContentPart | ReasoningContentPart
export type ChatContentPart = LLMContentPart | ToolCallContentPart

// 从DbChatBlock中拆出来的表示原始聊天块的对象
export interface OriginalChatBlock {
  id: number
  enabled: boolean
  contentParts: ChatContentPart[]
  metadata: JsonRecord
}

export interface LLMChatBlock {
  content?: string | LLMContentPart[]
}

export interface UIChatBlock {
  contentParts?: ChatContentPart[]
}

/**
 * 整体聊天块处理流程中唯一代表聊天块的实体
 */
export interface MixedChatBlock {
  role: ChatBlockTargetRole
  //插件不得更改此内容，默认有值
  original?: OriginalChatBlock
  //实际发送给llm的内容，若为undefined会回退到original，默认为undefined
  llm?: LLMChatBlock
  //给用户展示的内容，若为undefined会回退到original，默认为undefined
  user?: UIChatBlock
  // 对聊天块的metadata_json.pluginData对象所做的更改，落库时会写回
  pluginData: JsonRecord
}

export interface ProcessingChat {
  chatSession: ChatSession
  //对聊天的runtime_config_json.pluginData对象所做的更改，落库时会写回
  pluginData: JsonRecord
  chatBlocks: MixedChatBlock[]
}

export interface ChatGenerationPreviewMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ChatContentPart[]
  blockId?: number
}

export interface PluginToolCallRequest {
  chatId: number
  toolCallName: string
  toolName: string
  input: JsonRecord
  commonArgs: JsonRecord
}

export interface PluginStorageApi {
  list(path?: string): Promise<PluginFileEntry[]>
  listFor(pluginId: string, path?: string): Promise<PluginFileEntry[]>
  readText(path: string): Promise<string>
  readTextFor(pluginId: string, path: string): Promise<string>
  readBytes(path: string): Promise<Uint8Array>
  readBytesFor(pluginId: string, path: string): Promise<Uint8Array>
  writeText(path: string, content: string): Promise<void>
  writeTextFor(pluginId: string, path: string, content: string): Promise<void>
  writeBytes(path: string, content: Uint8Array): Promise<void>
  writeBytesFor(pluginId: string, path: string, content: Uint8Array): Promise<void>
  delete(path: string): Promise<void>
  deleteFor(pluginId: string, path: string): Promise<void>
  readJson(path: string, fallback?: unknown): Promise<unknown>
  readJsonFor(pluginId: string, path: string, fallback?: unknown): Promise<unknown>
  writeJson(path: string, value: unknown): Promise<void>
  writeJsonFor(pluginId: string, path: string, value: unknown): Promise<void>
}

export interface HaExtChatApi {
  getSession(): Promise<ChatSession | null>
  getPluginData(): Promise<JsonRecord>
  setPluginData(value: JsonRecord): Promise<JsonRecord>
}

export interface HaExtToolSettingsApi {
  getCommonArgs(): Promise<JsonRecord>
  setCommonArgs(value: JsonRecord): Promise<JsonRecord>
}

export interface HaExtApi {
  assetUrl(path: string): string
  storage: PluginStorageApi
  chat?: HaExtChatApi
  toolSettings?: HaExtToolSettingsApi
}

export interface HaExtApiInstallOptions {
  chat?: boolean
  toolSettings?: boolean
}

export const PLUGIN_FRAME_API_METHODS = {
  STORAGE_LIST: 'storage.list',
  STORAGE_LIST_FOR: 'storage.listFor',
  STORAGE_READ_TEXT: 'storage.readText',
  STORAGE_READ_TEXT_FOR: 'storage.readTextFor',
  STORAGE_READ_BYTES: 'storage.readBytes',
  STORAGE_READ_BYTES_FOR: 'storage.readBytesFor',
  STORAGE_WRITE_TEXT: 'storage.writeText',
  STORAGE_WRITE_TEXT_FOR: 'storage.writeTextFor',
  STORAGE_WRITE_BYTES: 'storage.writeBytes',
  STORAGE_WRITE_BYTES_FOR: 'storage.writeBytesFor',
  STORAGE_DELETE: 'storage.delete',
  STORAGE_DELETE_FOR: 'storage.deleteFor',
  STORAGE_READ_JSON: 'storage.readJson',
  STORAGE_READ_JSON_FOR: 'storage.readJsonFor',
  STORAGE_WRITE_JSON: 'storage.writeJson',
  STORAGE_WRITE_JSON_FOR: 'storage.writeJsonFor',
  CHAT_GET_SESSION: 'chat.getSession',
  CHAT_GET_PLUGIN_DATA: 'chat.getPluginData',
  CHAT_SET_PLUGIN_DATA: 'chat.setPluginData',
  TOOL_SETTINGS_GET_COMMON_ARGS: 'toolSettings.getCommonArgs',
  TOOL_SETTINGS_SET_COMMON_ARGS: 'toolSettings.setCommonArgs'
} as const

export type PluginFrameApiMethod =
  (typeof PLUGIN_FRAME_API_METHODS)[keyof typeof PLUGIN_FRAME_API_METHODS]

export interface PluginRuntimeContext {
  haExtApi: HaExtApi
  plugin: PluginManifest
}

export interface PluginChatBlockProcessor {
  process(chat: ProcessingChat): Promise<ProcessingChat> | ProcessingChat
}

export interface PluginToolHandler extends PluginToolCallDefinition {
  handle(request: PluginToolCallRequest): Promise<unknown> | unknown
}

export type PluginSharedExports = Record<string, unknown>

export interface PluginGlobalExport {
  settingsHtml?: string
  chatHtml?: string
  chatBlockProcessor?: PluginChatBlockProcessor
  toolCalls?: Record<string, PluginToolHandler>
  exports?: PluginSharedExports
}

export interface PluginGlobalRegistry {
  get(pluginId: string): PluginGlobalExport | undefined
  all(): Record<string, PluginGlobalExport>
}
