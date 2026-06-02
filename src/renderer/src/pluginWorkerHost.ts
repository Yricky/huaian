import type { ChatSession, JsonRecord } from '../../shared/types'
import { asRecord, asString } from '../../shared/value-utils'
import PluginRuntimeWorker from './plugin-worker/worker.ts?worker'

const HOST_SOURCE = 'ha-ext-worker-host'
const WORKER_SOURCE = 'ha-ext-worker'
const API_HOST_SOURCE = 'ha-ext-api-host'
const INVOCATION_TIMEOUT_MS = 120_000

interface PendingInvocation {
  reject: (error: Error) => void
  resolve: (value: unknown) => void
  timeout: number
}

export interface PluginFrameRegistration {
  capabilities: {
    chat?: boolean
    toolSettings?: boolean
  }
  frameId: string
  getChat?: () => ChatSession | null
  getCommonArgs?: () => JsonRecord
  getWindow: () => Window | null
  pluginId: string
  setChatPluginData?: (value: JsonRecord) => Promise<JsonRecord>
  setCommonArgs?: (value: JsonRecord) => JsonRecord
}

let worker: Worker | null = null
let runtimeSignature = ''
let nextMessageId = 0
const pendingInvocations = new Map<number, PendingInvocation>()
const frameRegistrations = new Map<string, PluginFrameRegistration>()

function cloneForMessage<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null))
}

function dispatchPluginDataChanged(pluginId: string): void {
  window.dispatchEvent(new CustomEvent('st-forge-plugin-data-changed', { detail: { pluginId } }))
}

function dispatchProjectSnapshotChanged(): void {
  window.dispatchEvent(new CustomEvent('st-forge-project-snapshot-changed'))
}

function publicChatSession(chat: ChatSession | null): JsonRecord | null {
  return chat
    ? {
        id: chat.id,
        title: chat.title,
        pluginData: asRecord(chat.runtimeConfig.pluginData),
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt
      }
    : null
}

function postToWorker(message: JsonRecord, transfer?: Transferable[]): void {
  worker?.postMessage(cloneForMessage({
    source: HOST_SOURCE,
    ...message
  }), transfer ?? [])
}

function reconnectRegisteredFrames(): void {
  for (const frameId of frameRegistrations.keys()) connectPluginFrame(frameId)
}

function rejectPendingInvocations(error: Error): void {
  for (const pending of pendingInvocations.values()) {
    window.clearTimeout(pending.timeout)
    pending.reject(error)
  }
  pendingInvocations.clear()
}

function createWorker(): Worker {
  const nextWorker = new PluginRuntimeWorker()
  nextWorker.addEventListener('message', onWorkerMessage)
  return nextWorker
}

function ensureWorker(signature?: string): Worker {
  const shouldReset = Boolean(worker && signature && runtimeSignature && signature !== runtimeSignature)
  if (shouldReset) {
    rejectPendingInvocations(new Error('Plugin worker runtime reset.'))
    worker?.terminate()
    worker = null
  }
  if (!worker) {
    worker = createWorker()
    if (shouldReset) window.queueMicrotask(reconnectRegisteredFrames)
  }
  if (signature) runtimeSignature = signature
  return worker
}

async function handleHostMethod(method: string, argsValue: unknown): Promise<unknown> {
  const args = asRecord(argsValue)
  const pluginId = asString(args.pluginId)

  if (method === 'plugin.readFile') {
    return window.electronAPI.readPluginFile(pluginId, asString(args.path))
  }

  if (method === 'storage.list') {
    return window.electronAPI.listPluginDataFiles(pluginId, asString(args.path))
  }
  if (method === 'storage.readText') {
    return window.electronAPI.readPluginDataFile(pluginId, asString(args.path))
  }
  if (method === 'storage.readBase64') {
    return window.electronAPI.readPluginDataFileBase64(pluginId, asString(args.path))
  }
  if (method === 'storage.writeText') {
    await window.electronAPI.writePluginDataFile(pluginId, asString(args.path), String(args.content ?? ''))
    dispatchPluginDataChanged(pluginId)
    return null
  }
  if (method === 'storage.writeBase64') {
    await window.electronAPI.writePluginDataFileBase64(pluginId, asString(args.path), String(args.content ?? ''))
    dispatchPluginDataChanged(pluginId)
    return null
  }
  if (method === 'storage.delete') {
    await window.electronAPI.deletePluginDataFile(pluginId, asString(args.path))
    dispatchPluginDataChanged(pluginId)
    return null
  }

  if (method === 'frame.chat.getSession') {
    const frame = frameRegistrations.get(asString(args.frameId))
    if (!frame?.capabilities.chat) throw new Error('当前插件页面没有聊天 API。')
    return publicChatSession(frame.getChat?.() ?? null)
  }
  if (method === 'frame.chat.getPluginData') {
    const frame = frameRegistrations.get(asString(args.frameId))
    if (!frame?.capabilities.chat) throw new Error('当前插件页面没有聊天 API。')
    return asRecord(asRecord(frame.getChat?.()?.runtimeConfig.pluginData)[frame.pluginId])
  }
  if (method === 'frame.chat.setPluginData') {
    const frame = frameRegistrations.get(asString(args.frameId))
    if (!frame?.capabilities.chat || !frame.setChatPluginData) throw new Error('当前插件页面没有聊天 API。')
    return frame.setChatPluginData(asRecord(args.value))
  }

  if (method === 'frame.toolSettings.getCommonArgs') {
    const frame = frameRegistrations.get(asString(args.frameId))
    if (!frame?.capabilities.toolSettings || !frame.getCommonArgs) throw new Error('当前插件页面没有工具设置 API。')
    return cloneForMessage(frame.getCommonArgs())
  }
  if (method === 'frame.toolSettings.setCommonArgs') {
    const frame = frameRegistrations.get(asString(args.frameId))
    if (!frame?.capabilities.toolSettings || !frame.setCommonArgs) throw new Error('当前插件页面没有工具设置 API。')
    return frame.setCommonArgs(asRecord(args.value))
  }

  throw new Error(`Unknown plugin worker host method: ${method}`)
}

function replyToWorkerHostCall(id: number, ok: boolean, value: unknown = null, error = ''): void {
  postToWorker({
    type: 'host-response',
    id,
    ok,
    value: value === undefined ? null : value,
    error
  })
}

async function handleWorkerHostCall(data: JsonRecord): Promise<void> {
  const id = Number(data.id)
  if (!Number.isFinite(id)) return
  try {
    const value = await handleHostMethod(asString(data.method), data.args)
    replyToWorkerHostCall(id, true, value)
  } catch (error) {
    replyToWorkerHostCall(id, false, null, error instanceof Error ? error.message : String(error))
  }
}

function onWorkerMessage(event: MessageEvent): void {
  const data = asRecord(event.data)
  if (data.source !== WORKER_SOURCE) return

  if (data.type === 'ready') return

  if (data.type === 'host-call') {
    void handleWorkerHostCall(data)
    return
  }

  if (data.type !== 'response') return
  const id = Number(data.id)
  const pending = pendingInvocations.get(id)
  if (!pending) return
  pendingInvocations.delete(id)
  window.clearTimeout(pending.timeout)
  if (data.ok) pending.resolve(data.value)
  else pending.reject(new Error(asString(data.error, 'Plugin worker call failed')))
}

export function registerPluginFrame(registration: PluginFrameRegistration): () => void {
  frameRegistrations.set(registration.frameId, registration)
  return () => {
    frameRegistrations.delete(registration.frameId)
    postToWorker({
      type: 'disconnect-frame',
      frameId: registration.frameId
    })
  }
}

export function connectPluginFrame(frameId: string): void {
  const registration = frameRegistrations.get(frameId)
  const frameWindow = registration?.getWindow()
  if (!registration || !frameWindow) return
  ensureWorker()
  const channel = new MessageChannel()
  postToWorker({
    type: 'connect-frame',
    frameId,
    pluginId: registration.pluginId,
    capabilities: registration.capabilities
  }, [channel.port1])
  frameWindow.postMessage({
    source: API_HOST_SOURCE,
    type: 'connect',
    frameId,
    pluginId: registration.pluginId,
    capabilities: registration.capabilities
  }, '*', [channel.port2])
}

export async function invokePluginWorker<T = unknown>(method: string, args: unknown, signature?: string): Promise<T> {
  ensureWorker(signature)
  const id = ++nextMessageId
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pendingInvocations.delete(id)
      reject(new Error(`Plugin worker call timed out: ${method}`))
    }, INVOCATION_TIMEOUT_MS)
    pendingInvocations.set(id, { resolve: resolve as (value: unknown) => void, reject, timeout })
    postToWorker({
      type: 'invoke',
      id,
      method,
      args
    })
  })
}

export function resetPluginWorker(): void {
  worker?.terminate()
  worker = null
  runtimeSignature = ''
  rejectPendingInvocations(new Error('Plugin worker reset.'))
  window.queueMicrotask(reconnectRegisteredFrames)
}
