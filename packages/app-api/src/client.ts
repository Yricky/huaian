import type {
  AppChatMessageCreatePayload,
  AppChatMessageUpdatePayload,
  AppChatSessionCreatePayload,
  AppChatSessionState,
  AppChatSessionUpdatePayload,
  AppEvent,
  AppEventHandler,
  AppFileEntry,
  AppFrameContext,
  AppLlmInstanceSummary,
  AppStorageApi,
  AppToolDefinition,
  AppToolHandler,
  HuaianAppApi,
  JsonRecord
} from './types'

const HOST_SOURCE = 'ha-app-api-host'
const CLIENT_SOURCE = 'ha-app-api-client'

interface PendingCall {
  reject: (error: Error) => void
  resolve: (value: unknown) => void
}

export interface HaAppApiInstallOptions {
  target?: Window
  exposeGlobal?: boolean
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function cleanPath(path?: string): string {
  return String(path ?? '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '')
}

export function createHaAppApi(options: HaAppApiInstallOptions = {}): HuaianAppApi {
  const target = options.target ?? window
  let port: MessagePort | null = null
  let contextValue: AppFrameContext | null = null
  let callId = 0
  const pendingCalls = new Map<number, PendingCall>()
  const pendingPorts: Array<{ resolve: (port: MessagePort) => void }> = []
  const eventHandlers = new Map<string, Set<AppEventHandler>>()
  const toolHandlers = new Map<string, AppToolHandler>()

  function waitForPort(): Promise<MessagePort> {
    if (port) return Promise.resolve(port)
    return new Promise(resolve => pendingPorts.push({ resolve }))
  }

  function flushPortWaiters(nextPort: MessagePort): void {
    while (pendingPorts.length) pendingPorts.shift()?.resolve(nextPort)
  }

  function call(method: string, args: unknown[] = []): Promise<unknown> {
    const id = ++callId
    return waitForPort().then(nextPort => {
      nextPort.postMessage({
        source: CLIENT_SOURCE,
        type: 'call',
        id,
        method,
        args
      })
      return new Promise((resolve, reject) => pendingCalls.set(id, { resolve, reject }))
    })
  }

  function storage(namespace: 'appData' | 'save'): AppStorageApi {
    return {
      list: (path = '') => call(`${namespace}.list`, [cleanPath(path)]) as Promise<AppFileEntry[]>,
      mkdir: (path: string) => call(`${namespace}.mkdir`, [cleanPath(path)]) as Promise<void>,
      readText: (path: string) => call(`${namespace}.readText`, [cleanPath(path)]) as Promise<string>,
      readBytes: (path: string) => call(`${namespace}.readBytes`, [cleanPath(path)]) as Promise<Uint8Array>,
      writeText: (path: string, content: string) => call(`${namespace}.writeText`, [cleanPath(path), content]) as Promise<void>,
      writeBytes: (path: string, content: Uint8Array) => call(`${namespace}.writeBytes`, [cleanPath(path), content]) as Promise<void>,
      delete: (path: string, options = {}) => call(`${namespace}.delete`, [cleanPath(path), options]) as Promise<void>,
      readJson: (path: string, fallback?: unknown) => call(`${namespace}.readJson`, [cleanPath(path), fallback]),
      writeJson: (path: string, value: unknown) => call(`${namespace}.writeJson`, [cleanPath(path), value]) as Promise<void>
    }
  }

  function emit(event: AppEvent): void {
    const handlers = eventHandlers.get(event.type)
    if (!handlers?.size) return
    for (const handler of handlers) {
      void Promise.resolve(handler(event as never)).catch(console.error)
    }
  }

  function toolKey(chatSessionId: number, toolName: string): string {
    return `${chatSessionId}\u0000${toolName}`
  }

  async function handleToolCall(event: Extract<AppEvent, { type: 'toolCall' }>): Promise<void> {
    const handler = toolHandlers.get(toolKey(event.chatSessionId, event.toolName))
    if (!handler) {
      port?.postMessage({
        source: CLIENT_SOURCE,
        type: 'toolCallResponse',
        requestId: event.requestId,
        ok: false,
        error: `未注册工具处理器：${event.toolName}`
      })
      return
    }
    try {
      const output = await handler(event.input)
      port?.postMessage({
        source: CLIENT_SOURCE,
        type: 'toolCallResponse',
        requestId: event.requestId,
        ok: true,
        output
      })
    } catch (error) {
      port?.postMessage({
        source: CLIENT_SOURCE,
        type: 'toolCallResponse',
        requestId: event.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  function handlePortMessage(event: MessageEvent): void {
    const data = asRecord(event.data)
    if (data.source !== HOST_SOURCE) return
    if (data.type === 'response') {
      const id = Number(data.id)
      const pending = pendingCalls.get(id)
      if (!pending) return
      pendingCalls.delete(id)
      if (data.ok === true) pending.resolve(data.value)
      else pending.reject(new Error(typeof data.error === 'string' ? data.error : 'Huaian API call failed'))
      return
    }
    if (data.type === 'event') {
      const appEvent = asRecord(data.event) as AppEvent
      emit(appEvent)
      if (appEvent.type === 'toolCall') void handleToolCall(appEvent)
    }
  }

  function connect(nextPort: MessagePort, context: AppFrameContext): void {
    port?.close()
    port = nextPort
    contextValue = context
    port.onmessage = handlePortMessage
    port.start()
    flushPortWaiters(port)
  }

  target.addEventListener('message', event => {
    const data = asRecord(event.data)
    if (data.source !== HOST_SOURCE || data.type !== 'connect') return
    const nextPort = event.ports?.[0]
    if (!nextPort) return
    connect(nextPort, asRecord(data.context) as unknown as AppFrameContext)
  })

  const api: HuaianAppApi = {
    context: async () => {
      if (contextValue) return contextValue
      await waitForPort()
      if (!contextValue) throw new Error('Huaian app context is not available.')
      return contextValue
    },
    appData: storage('appData'),
    save: storage('save'),
    chat: {
      getLLMInstances: () => call('chat.getLLMInstances') as Promise<AppLlmInstanceSummary[]>,
      createSession: (payload: AppChatSessionCreatePayload = {}) => (
        call('chat.createSession', [payload]) as Promise<AppChatSessionState>
      ),
      listSessions: () => call('chat.listSessions') as Promise<AppChatSessionState[]>,
      getSession: (chatSessionId: number) => call('chat.getSession', [chatSessionId]) as Promise<AppChatSessionState>,
      updateSession: (chatSessionId: number, patch: AppChatSessionUpdatePayload) => (
        call('chat.updateSession', [chatSessionId, patch]) as Promise<AppChatSessionState>
      ),
      deleteSession: (chatSessionId: number) => call('chat.deleteSession', [chatSessionId]) as Promise<AppChatSessionState[]>,
      appendMessage: (chatSessionId: number, payload: AppChatMessageCreatePayload) => (
        call('chat.appendMessage', [chatSessionId, payload]) as ReturnType<HuaianAppApi['chat']['appendMessage']>
      ),
      updateMessage: (chatSessionId: number, messageId: number, patch: AppChatMessageUpdatePayload) => (
        call('chat.updateMessage', [chatSessionId, messageId, patch]) as ReturnType<HuaianAppApi['chat']['updateMessage']>
      ),
      deleteMessage: (chatSessionId: number, messageId: number) => (
        call('chat.deleteMessage', [chatSessionId, messageId]) as Promise<AppChatSessionState>
      ),
      registerTool: async (chatSessionId: number, tool: AppToolDefinition, handler: AppToolHandler) => {
        toolHandlers.set(toolKey(chatSessionId, tool.name), handler)
        return call('chat.registerTool', [chatSessionId, tool]) as Promise<AppChatSessionState>
      },
      triggerLlmReply: (chatSessionId: number) => (
        call('chat.triggerLlmReply', [chatSessionId]) as Promise<AppChatSessionState>
      ),
      stopLlmReply: (chatSessionId: number) => call('chat.stopLlmReply', [chatSessionId]) as Promise<void>
    },
    on(type, handler) {
      const handlers = eventHandlers.get(type) ?? new Set<AppEventHandler>()
      handlers.add(handler as AppEventHandler)
      eventHandlers.set(type, handlers)
      return () => {
        handlers.delete(handler as AppEventHandler)
        if (!handlers.size) eventHandlers.delete(type)
      }
    }
  }

  return api
}

export function installHaAppApi(options: HaAppApiInstallOptions = {}): HuaianAppApi {
  const target = options.target ?? window
  const existing = (target as unknown as { huaian?: HuaianAppApi }).huaian
  if (existing) return existing
  const api = createHaAppApi(options)
  if (options.exposeGlobal !== false) {
    Object.defineProperty(target, 'huaian', {
      configurable: true,
      enumerable: true,
      value: api,
      writable: false
    })
  }
  return api
}
