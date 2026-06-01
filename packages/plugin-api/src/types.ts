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
  setBlockPluginData(blockId: number, value: JsonRecord): Promise<OriginalChatBlock | null>
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
  blocks?: OriginalChatBlock[]
  processingChat?: ProcessingChat
}

export interface PluginChatBlockProcessor {
  process(chat: ProcessingChat): Promise<ProcessingChat> | ProcessingChat
}

export interface PluginToolHandler {
  handle(request: PluginToolCallRequest): Promise<unknown> | unknown
}
