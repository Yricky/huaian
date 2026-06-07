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
const READY_RETRY_INTERVAL_MS = 100
const CONNECT_TIMEOUT_MS = 20_000

interface PendingCall {
  reject: (error: Error) => void
  resolve: (value: unknown) => void
}

interface PendingPortWaiter {
  reject: (error: Error) => void
  resolve: (port: MessagePort) => void
  timeoutId: number
}

declare global {
  interface Window {
    huaian?: HuaianAppApi
  }
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function cleanPath(path?: string): string {
  return String(path ?? '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '')
}

function randomClientId(target: Window): string {
  return target.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function messageFrameEpoch(data: JsonRecord): number | null {
  const value = Number(data.frameEpoch)
  return Number.isFinite(value) ? value : null
}

function createHuaianAppApi(target: Window): HuaianAppApi {
  const clientId = randomClientId(target)
  let port: MessagePort | null = null
  let contextValue: AppFrameContext | null = null
  let frameEpoch: number | null = null
  let callId = 0
  let readyTimer: number | null = null
  const pendingCalls = new Map<number, PendingCall>()
  const pendingPorts: PendingPortWaiter[] = []
  const eventHandlers = new Map<string, Set<AppEventHandler>>()
  const toolHandlers = new Map<string, AppToolHandler>()

  function currentFrameEpochPayload(): { frameEpoch?: number } {
    return frameEpoch === null ? {} : { frameEpoch }
  }

  function postReady(): void {
    if (target.parent === target) return
    target.parent.postMessage({
      source: CLIENT_SOURCE,
      type: 'ready',
      clientId,
      ...currentFrameEpochPayload()
    }, '*')
  }

  function stopReadyLoop(): void {
    if (readyTimer === null) return
    target.clearInterval(readyTimer)
    readyTimer = null
  }

  function startReadyLoop(): void {
    if (port || readyTimer !== null) return
    postReady()
    readyTimer = target.setInterval(() => {
      if (port) {
        stopReadyLoop()
        return
      }
      postReady()
    }, READY_RETRY_INTERVAL_MS)
  }

  function removePortWaiter(waiter: PendingPortWaiter): void {
    const index = pendingPorts.indexOf(waiter)
    if (index >= 0) pendingPorts.splice(index, 1)
  }

  function waitForPort(): Promise<MessagePort> {
    if (port) return Promise.resolve(port)
    startReadyLoop()
    return new Promise((resolve, reject) => {
      const waiter: PendingPortWaiter = {
        resolve,
        reject,
        timeoutId: target.setTimeout(() => {
          removePortWaiter(waiter)
          reject(new Error('等待 Huaian 宿主连接超时。'))
        }, CONNECT_TIMEOUT_MS)
      }
      pendingPorts.push(waiter)
    })
  }

  function flushPortWaiters(nextPort: MessagePort): void {
    while (pendingPorts.length) {
      const waiter = pendingPorts.shift()
      if (!waiter) continue
      target.clearTimeout(waiter.timeoutId)
      waiter.resolve(nextPort)
    }
  }

  function rejectPendingCalls(error: Error): void {
    for (const pending of pendingCalls.values()) pending.reject(error)
    pendingCalls.clear()
  }

  function isCurrentFrameMessage(data: JsonRecord): boolean {
    const messageEpoch = messageFrameEpoch(data)
    return messageEpoch === null || frameEpoch === null || messageEpoch === frameEpoch
  }

  function call(method: string, args: unknown[] = []): Promise<unknown> {
    const id = ++callId
    return waitForPort().then(nextPort => (
      new Promise((resolve, reject) => {
        pendingCalls.set(id, { resolve, reject })
        nextPort.postMessage({
          source: CLIENT_SOURCE,
          type: 'call',
          id,
          method,
          args,
          ...currentFrameEpochPayload()
        })
      })
    ))
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
        error: `未注册工具处理器：${event.toolName}`,
        ...currentFrameEpochPayload()
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
        output,
        ...currentFrameEpochPayload()
      })
    } catch (error) {
      port?.postMessage({
        source: CLIENT_SOURCE,
        type: 'toolCallResponse',
        requestId: event.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        ...currentFrameEpochPayload()
      })
    }
  }

  function handlePortMessage(event: MessageEvent): void {
    const data = asRecord(event.data)
    if (data.source !== HOST_SOURCE || !isCurrentFrameMessage(data)) return
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

  function connect(nextPort: MessagePort, context: AppFrameContext, nextFrameEpoch: number | null): void {
    if (port) rejectPendingCalls(new Error('Huaian API connection was replaced.'))
    port?.close()
    port = nextPort
    contextValue = context
    frameEpoch = nextFrameEpoch
    port.onmessage = handlePortMessage
    port.start()
    stopReadyLoop()
    port.postMessage({
      source: CLIENT_SOURCE,
      type: 'connected',
      clientId,
      ...currentFrameEpochPayload()
    })
    flushPortWaiters(port)
  }

  target.addEventListener('message', event => {
    const data = asRecord(event.data)
    if (data.source !== HOST_SOURCE) return
    const nextFrameEpoch = messageFrameEpoch(data)
    if (nextFrameEpoch !== null) frameEpoch = nextFrameEpoch
    if (data.type === 'connectOffer') {
      startReadyLoop()
      postReady()
      return
    }
    if (data.type !== 'connect') return
    const nextPort = event.ports?.[0]
    if (!nextPort) return
    connect(nextPort, asRecord(data.context) as unknown as AppFrameContext, nextFrameEpoch)
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

  startReadyLoop()
  return api
}

export function ensureHuaianAppApi(): HuaianAppApi {
  if (typeof window === 'undefined') throw new Error('Huaian app API can only be used in a browser window.')
  if (window.huaian) return window.huaian
  const api = createHuaianAppApi(window)
  Object.defineProperty(window, 'huaian', {
    configurable: true,
    enumerable: true,
    value: api,
    writable: false
  })
  return api
}
