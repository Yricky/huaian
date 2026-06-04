export type JsonRecord = Record<string, unknown>
export type CloneablePrimitive = string | number | boolean | null | undefined
export type CloneableRecord = { [key: string]: CloneableValue }
export type CloneableValue = CloneablePrimitive | CloneableValue[] | CloneableRecord

export interface AppFileEntry {
  name: string
  path: string
  isDirectory: boolean
  size?: number
}

export interface AppFrameContext {
  appId: string
  appVersion: number
  appSessionId: number
  appSessionTitle: string
}

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

export type AppEvent =
  | { type: 'userMessage'; chatSessionId: number; text: string; source: 'composer' | 'option' }
  | { type: 'userStoppedReply'; chatSessionId: number }
  | { type: 'llmReplyStarted'; chatSessionId: number; assistantMessageId: number }
  | { type: 'llmReplyDelta'; chatSessionId: number; assistantMessageId: number; text: string; contentParts: AppChatContentPart[] }
  | { type: 'llmReplyFinished'; chatSessionId: number; assistantMessageId: number; contentParts: AppChatContentPart[] }
  | { type: 'llmReplyStopped'; chatSessionId: number; assistantMessageId: number; contentParts: AppChatContentPart[] }
  | { type: 'llmReplyError'; chatSessionId: number; assistantMessageId: number; contentParts: AppChatContentPart[]; error: string }
  | { type: 'toolCall'; requestId: string; chatSessionId: number; toolName: string; input: JsonRecord }

export interface AppStorageApi {
  list(path?: string): Promise<AppFileEntry[]>
  mkdir(path: string): Promise<void>
  readText(path: string): Promise<string>
  readBytes(path: string): Promise<Uint8Array>
  writeText(path: string, content: string): Promise<void>
  writeBytes(path: string, content: Uint8Array): Promise<void>
  delete(path: string, options?: { recursive?: boolean }): Promise<void>
  readJson(path: string, fallback?: unknown): Promise<unknown>
  writeJson(path: string, value: unknown): Promise<void>
}

export interface AppChatApi {
  createSession(payload?: AppChatSessionCreatePayload): Promise<AppChatSessionState>
  listSessions(): Promise<AppChatSessionState[]>
  getSession(chatSessionId: number): Promise<AppChatSessionState>
  updateSession(chatSessionId: number, patch: AppChatSessionUpdatePayload): Promise<AppChatSessionState>
  deleteSession(chatSessionId: number): Promise<AppChatSessionState[]>
  appendMessage(chatSessionId: number, payload: AppChatMessageCreatePayload): Promise<AppChatMessage>
  updateMessage(chatSessionId: number, messageId: number, patch: AppChatMessageUpdatePayload): Promise<AppChatMessage>
  deleteMessage(chatSessionId: number, messageId: number): Promise<AppChatSessionState>
  registerTool(chatSessionId: number, tool: AppToolDefinition, handler: AppToolHandler): Promise<AppChatSessionState>
  triggerLlmReply(chatSessionId: number): Promise<AppChatSessionState>
  stopLlmReply(chatSessionId: number): Promise<void>
}

export type AppToolHandler = (input: JsonRecord) => Promise<unknown> | unknown
export type AppEventHandler<TEvent extends AppEvent = AppEvent> = (event: TEvent) => void | Promise<void>

export interface HuaianAppApi {
  context(): Promise<AppFrameContext>
  appData: AppStorageApi
  save: AppStorageApi
  chat: AppChatApi
  on<TType extends AppEvent['type']>(
    type: TType,
    handler: AppEventHandler<Extract<AppEvent, { type: TType }>>
  ): () => void
}
