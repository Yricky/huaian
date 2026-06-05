import { computed, inject, onBeforeUnmount, onMounted, provide, ref, toRaw, type InjectionKey } from 'vue'
import type {
  AppChatContentPart,
  AppChatMessage,
  AppChatMessageCreatePayload,
  AppChatMessageUpdatePayload,
  AppChatSessionCreatePayload,
  AppChatSessionState,
  AppChatSessionUpdatePayload,
  AppDescriptor,
  AppFileEntry,
  AppFrameContext,
  AppFrameEvent,
  AppLlmInstanceSummary,
  AppLlmGenerationEvent,
  AppSessionRecord,
  AppToolCallRequest,
  AppToolDefinition,
  AppUninstallOptions,
  JsonRecord,
  LlmInstance,
  LlmInstanceCreatePayload,
  LlmProvider,
  LlmProviderCreatePayload,
  ProjectConfigUpdatePayload,
  ProjectSnapshot,
  RecentProject,
  SidebarView
} from '@/shared/types'
import { asRecord, toStructuredCloneable } from '../../../shared/value-utils'

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastMessage {
  id: number
  kind: ToastKind
  text: string
}

export interface RecentAppItem {
  app: AppDescriptor
  lastOpenedAt: string
  running: boolean
}

export interface RuntimeAppSession {
  key: string
  app: AppDescriptor
  record: AppSessionRecord
  chatSessions: AppChatSessionState[]
  activeChatSessionId: number | null
  chatPanelOpen: boolean
  nextChatSessionId: number
  nextMessageId: number
  port: MessagePort | null
  frameLoadCount: number
}

type HostCallHandler = (runtime: RuntimeAppSession, args: unknown[]) => Promise<unknown> | unknown

const HOST_SOURCE = 'ha-app-api-host'
const CLIENT_SOURCE = 'ha-app-api-client'

export function createProjectWorkbench() {
  const project = ref<ProjectSnapshot | null>(null)
  const recentProjects = ref<RecentProject[]>([])
  const activeView = ref<SidebarView>('apps')
  const selectedAppId = ref<string | null>(null)
  const activeRuntimeKey = ref<string | null>(null)
  const runningAppSessions = ref<RuntimeAppSession[]>([])
  const selectedLlmProvider = ref<LlmProvider | null>(null)
  const selectedLlmInstance = ref<LlmInstance | null>(null)
  const toasts = ref<ToastMessage[]>([])
  let toastId = 0
  let unsubscribeGenerationEvents: (() => void) | null = null
  let unsubscribeToolRequests: (() => void) | null = null

  const apps = computed(() => project.value?.apps ?? [])
  const appSessions = computed(() => project.value?.appSessions ?? [])
  const llmProviders = computed(() => project.value?.llmProviders ?? [])
  const llmInstances = computed(() => project.value?.llmInstances ?? [])
  const availableLlmInstances = computed(() => {
    const providerIds = new Set(llmProviders.value.map(provider => provider.id))
    return llmInstances.value.filter(instance => instance.providerId !== null && providerIds.has(instance.providerId))
  })
  const appById = computed(() => new Map(apps.value.map(app => [app.manifest.id, app])))
  const activeRuntime = computed(() => (
    runningAppSessions.value.find(runtime => runtime.key === activeRuntimeKey.value) ?? null
  ))
  const selectedApp = computed(() => {
    if (activeRuntime.value) return activeRuntime.value.app
    return selectedAppId.value ? appById.value.get(selectedAppId.value) ?? null : null
  })
  const selectedAppSessions = computed(() => {
    const appId = selectedApp.value?.manifest.id ?? selectedAppId.value
    if (!appId) return []
    return appSessions.value.filter(session => session.appId === appId)
      .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt) || b.id - a.id)
  })
  const recentApps = computed<RecentAppItem[]>(() => {
    const rows: RecentAppItem[] = []
    const seen = new Set<string>()
    for (const session of appSessions.value) {
      if (seen.has(session.appId)) continue
      const app = appById.value.get(session.appId)
      if (!app) continue
      seen.add(session.appId)
      rows.push({
        app,
        lastOpenedAt: session.lastOpenedAt,
        running: runningAppSessions.value.some(runtime => runtime.app.manifest.id === app.manifest.id)
      })
      if (rows.length >= 20) break
    }
    return rows
  })
  const selectedProviderForInstance = computed(() => {
    const id = selectedLlmInstance.value?.providerId
    return id === null || id === undefined ? null : llmProviders.value.find(provider => provider.id === id) ?? null
  })

  function clone<T>(value: T): T {
    return toStructuredCloneable(value) as T
  }

  function toIpcPayload<T>(value: T): T {
    const raw = toRaw(value)
    if (Array.isArray(raw)) return raw.map(item => toIpcPayload(item)) as T
    if (raw && typeof raw === 'object') {
      return Object.fromEntries(
        Object.entries(raw).map(([key, item]) => [key, toIpcPayload(item)])
      ) as T
    }
    return raw
  }

  function showToast(text: string, kind: ToastKind = 'info') {
    const id = ++toastId
    toasts.value.push({ id, kind, text })
    window.setTimeout(() => {
      toasts.value = toasts.value.filter(item => item.id !== id)
    }, 2400)
  }

  function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  function runtimeKey(appId: string, sessionId: number): string {
    return `${appId}\u0000${sessionId}`
  }

  function replaceRuntime(runtime: RuntimeAppSession) {
    const index = runningAppSessions.value.findIndex(item => item.key === runtime.key)
    if (index >= 0) runningAppSessions.value[index] = runtime
    runningAppSessions.value = [...runningAppSessions.value]
  }

  function runtimeFor(appId: string, appSessionId: number): RuntimeAppSession | null {
    return runningAppSessions.value.find(runtime => runtime.app.manifest.id === appId && runtime.record.id === appSessionId) ?? null
  }

  function chatSession(runtime: RuntimeAppSession, chatSessionId: number): AppChatSessionState {
    const session = runtime.chatSessions.find(item => item.id === chatSessionId)
    if (!session) throw new Error('chatSession 不存在。')
    return session
  }

  function assertChatEditable(session: AppChatSessionState): void {
    if (session.status === 'generating') throw new Error('当前 chatSession 正在生成，暂不能修改。')
  }

  function nowIso(): string {
    return new Date().toISOString()
  }

  function normalizeContentParts(payload: AppChatMessageCreatePayload): AppChatContentPart[] {
    if (payload.contentParts) return clone(payload.contentParts)
    return payload.content ? [{ type: 'text', text: payload.content }] : []
  }

  function normalizeMessage(id: number, payload: AppChatMessageCreatePayload): AppChatMessage {
    const now = nowIso()
    return {
      id,
      role: payload.role,
      contentParts: normalizeContentParts(payload),
      status: payload.status ?? 'idle',
      metadata: asRecord(payload.metadata),
      errorText: payload.errorText ?? '',
      createdAt: now,
      updatedAt: now
    }
  }

  function defaultLlmInstanceId(): number | null {
    return availableLlmInstances.value[0]?.id ?? null
  }

  function availableLlmInstanceId(id: number | null | undefined): number | null {
    if (id === null || id === undefined) return null
    return availableLlmInstances.value.some(instance => instance.id === id) ? id : null
  }

  function replyLlmInstanceId(id: number | null | undefined): number | null {
    return availableLlmInstanceId(id) ?? defaultLlmInstanceId()
  }

  function normalizeOptions(options: unknown): string[] {
    return Array.isArray(options) ? options.map(item => String(item)).filter(Boolean) : []
  }

  function normalizeTools(tools: unknown): AppToolDefinition[] {
    if (!Array.isArray(tools)) return []
    return tools.flatMap(item => {
      const record = asRecord(item)
      const name = typeof record.name === 'string' ? record.name.trim() : ''
      if (!name) return []
      return [{
        name,
        description: typeof record.description === 'string' ? record.description : '',
        inputSchema: asRecord(record.inputSchema)
      }]
    })
  }

  function hasOwn(record: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key)
  }

  function freshChatSession(runtime: RuntimeAppSession, payload: AppChatSessionCreatePayload = {}): AppChatSessionState {
    const id = runtime.nextChatSessionId++
    const messages = (payload.messages ?? []).map(message => clone(message))
    runtime.nextMessageId = Math.max(runtime.nextMessageId, ...messages.map(message => message.id + 1), 0)
    return {
      id,
      title: (payload.title ?? '').trim() || `对话 ${id}`,
      messages,
      tools: normalizeTools(payload.tools),
      llmInstanceId: payload.llmInstanceId === undefined ? defaultLlmInstanceId() : availableLlmInstanceId(payload.llmInstanceId),
      allowUserReply: payload.allowUserReply !== false,
      options: normalizeOptions(payload.options),
      status: 'idle',
      errorText: ''
    }
  }

  function sendFrameEvent(runtime: RuntimeAppSession, event: AppFrameEvent): void {
    runtime.port?.postMessage({
      source: HOST_SOURCE,
      type: 'event',
      event
    })
  }

  function contextForRuntime(runtime: RuntimeAppSession): AppFrameContext {
    return {
      appId: runtime.app.manifest.id,
      appVersion: runtime.app.manifest.version,
      appSessionId: runtime.record.id,
      appSessionTitle: runtime.record.title
    }
  }

  async function refreshRecentProjects() {
    recentProjects.value = await window.electronAPI.listRecentProjects()
  }

  function resetProjectSelections() {
    selectedLlmProvider.value = null
    selectedLlmInstance.value = null
    selectedAppId.value = null
    activeRuntimeKey.value = null
    runningAppSessions.value = []
  }

  function selectInitialProjectItems() {
    if (llmProviders.value.length) selectedLlmProvider.value = clone(llmProviders.value[0])
    if (llmInstances.value.length) selectedLlmInstance.value = clone(llmInstances.value[0])
    if (apps.value.length) selectedAppId.value = apps.value[0].manifest.id
  }

  function refreshSelectedLlmProvider() {
    if (!selectedLlmProvider.value) return
    const fresh = llmProviders.value.find(item => item.id === selectedLlmProvider.value?.id)
    selectedLlmProvider.value = fresh ? clone(fresh) : null
  }

  function refreshSelectedLlmInstance() {
    if (!selectedLlmInstance.value) return
    const fresh = llmInstances.value.find(item => item.id === selectedLlmInstance.value?.id)
    selectedLlmInstance.value = fresh ? clone(fresh) : null
  }

  function applyProjectSnapshot(snapshot: ProjectSnapshot) {
    project.value = snapshot
    resetProjectSelections()
    selectInitialProjectItems()
    void refreshRecentProjects()
  }

  async function loadProject() {
    try {
      applyProjectSnapshot(await window.electronAPI.getProject())
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function refreshProjectSnapshot() {
    project.value = await window.electronAPI.getProject()
    refreshSelectedLlmProvider()
    refreshSelectedLlmInstance()
  }

  async function openProject() {
    if (runningAppSessions.value.length && !window.confirm('切换项目会关闭所有运行中的应用，继续？')) return
    try {
      for (const runtime of runningAppSessions.value) {
        await window.electronAPI.stopAppChatGeneration(runtime.app.manifest.id, runtime.record.id)
      }
      const previousPath = project.value?.path
      const snapshot = await window.electronAPI.openProject()
      if (snapshot) {
        applyProjectSnapshot(snapshot)
        if (snapshot.path !== previousPath) showToast('项目已打开', 'success')
      }
    } catch (error) {
      showToast(errorText(error), 'error')
      await refreshRecentProjects()
    }
  }

  async function openRecentProject(projectPath: string) {
    if (project.value?.path === projectPath) return
    if (runningAppSessions.value.length && !window.confirm('切换项目会关闭所有运行中的应用，继续？')) return
    try {
      for (const runtime of runningAppSessions.value) {
        await window.electronAPI.stopAppChatGeneration(runtime.app.manifest.id, runtime.record.id)
      }
      applyProjectSnapshot(await window.electronAPI.openProjectPath(projectPath))
      showToast('项目已打开', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
      await refreshRecentProjects()
    }
  }

  function replaceLlmProvider(provider: LlmProvider) {
    if (!project.value) return
    const index = project.value.llmProviders.findIndex(item => item.id === provider.id)
    if (index >= 0) project.value.llmProviders[index] = provider
    else project.value.llmProviders.unshift(provider)
    selectedLlmProvider.value = clone(provider)
  }

  function replaceLlmInstance(instance: LlmInstance) {
    if (!project.value) return
    const index = project.value.llmInstances.findIndex(item => item.id === instance.id)
    if (index >= 0) project.value.llmInstances[index] = instance
    else project.value.llmInstances.push(instance)
    project.value.llmInstances.sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id)
    selectedLlmInstance.value = clone(instance)
  }

  async function createLlmProvider(payload?: Partial<LlmProviderCreatePayload>) {
    try {
      const provider = await window.electronAPI.createLlmProvider(toIpcPayload({
        name: payload?.name ?? '新提供商',
        type: payload?.type ?? 'openai-compatible',
        apiKey: payload?.apiKey ?? '',
        config: payload?.config ?? {}
      }))
      replaceLlmProvider(provider)
      activeView.value = 'settings'
      showToast('提供商已创建', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function saveLlmProvider(provider: LlmProvider) {
    try {
      const saved = await window.electronAPI.updateLlmProvider(toIpcPayload({
        id: provider.id,
        name: provider.name,
        type: provider.type,
        apiKey: provider.apiKey,
        config: provider.config
      }))
      replaceLlmProvider(saved)
      showToast('提供商已保存', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function deleteSelectedLlmProvider() {
    if (!selectedLlmProvider.value || !window.confirm('删除当前提供商？LLM 实例会保留，但需要重新绑定 API Key 来源。')) return
    try {
      project.value = await window.electronAPI.deleteLlmProvider(selectedLlmProvider.value.id)
      selectedLlmProvider.value = llmProviders.value[0] ? clone(llmProviders.value[0]) : null
      refreshSelectedLlmInstance()
      showToast('提供商已删除', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function fetchSelectedLlmProviderModels() {
    if (!selectedLlmProvider.value) return
    try {
      const provider = await window.electronAPI.fetchLlmProviderModels(selectedLlmProvider.value.id)
      replaceLlmProvider(provider)
      showToast(`已拉取 ${provider.modelsCache.length} 个模型`, 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function clearSelectedLlmProviderModelsCache() {
    if (!selectedLlmProvider.value) return
    try {
      replaceLlmProvider(await window.electronAPI.clearLlmProviderModelsCache(selectedLlmProvider.value.id))
      showToast('模型缓存已清空', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function createLlmInstance(payload: LlmInstanceCreatePayload) {
    try {
      const instance = await window.electronAPI.createLlmInstance(toIpcPayload(payload))
      replaceLlmInstance(instance)
      activeView.value = 'settings'
      showToast('LLM 实例已创建', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function saveLlmInstance(instance: LlmInstance) {
    try {
      const saved = await window.electronAPI.updateLlmInstance(toIpcPayload({
        id: instance.id,
        name: instance.name,
        providerId: instance.providerId,
        modelId: instance.modelId,
        extra: instance.extra
      }))
      replaceLlmInstance(saved)
      showToast('LLM 实例已保存', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function deleteSelectedLlmInstance() {
    if (!selectedLlmInstance.value || !window.confirm('删除当前 LLM 实例？运行中的应用不会自动切换。')) return
    try {
      project.value = await window.electronAPI.deleteLlmInstance(selectedLlmInstance.value.id)
      selectedLlmInstance.value = llmInstances.value[0] ? clone(llmInstances.value[0]) : null
      showToast('LLM 实例已删除', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function reorderLlmInstances(ids: number[]) {
    try {
      project.value = await window.electronAPI.reorderLlmInstances(ids)
      refreshSelectedLlmInstance()
      showToast('LLM 实例顺序已保存', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  function selectLlmProvider(provider: LlmProvider) {
    selectedLlmProvider.value = clone(provider)
  }

  function selectLlmInstance(instance: LlmInstance) {
    selectedLlmInstance.value = clone(instance)
  }

  async function saveProjectConfig(payload: ProjectConfigUpdatePayload): Promise<boolean> {
    if (!project.value) return false
    try {
      project.value.config = await window.electronAPI.updateProjectConfig(toIpcPayload(payload))
      return true
    } catch (error) {
      showToast(errorText(error), 'error')
      return false
    }
  }

  function appIconUrl(app: AppDescriptor): string {
    return app.manifest.icon ? window.electronAPI.appAssetUrl(app.manifest.id, app.manifest.icon) : ''
  }

  function openApp(appId: string) {
    activeView.value = 'apps'
    selectedAppId.value = appId
    const running = runningAppSessions.value.find(runtime => runtime.app.manifest.id === appId)
    if (running) {
      activeRuntimeKey.value = running.key
      return
    }
    activeRuntimeKey.value = null
  }

  function showAppLibrary() {
    activeView.value = 'apps'
    selectedAppId.value = null
    activeRuntimeKey.value = null
  }

  async function installApp() {
    if (runningAppSessions.value.length) {
      showToast('请先关闭运行中的应用，再安装或更新应用。', 'error')
      return
    }
    try {
      project.value = await window.electronAPI.installApp()
      selectInitialProjectItems()
      showToast('应用已安装', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function uninstallSelectedApp(options: AppUninstallOptions) {
    const app = selectedApp.value
    if (!app) return
    const appId = app.manifest.id
    if (runningAppSessions.value.some(runtime => runtime.app.manifest.id === appId)) {
      showToast('请先关闭该应用正在运行的存档。', 'error')
      return
    }
    if (!window.confirm(`卸载应用「${app.manifest.name || appId}」？`)) return
    try {
      project.value = await window.electronAPI.uninstallApp(appId, options)
      selectedAppId.value = apps.value[0]?.manifest.id ?? null
      showToast('应用已卸载', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  function replaceAppSessionRecord(record: AppSessionRecord) {
    if (!project.value) return
    const index = project.value.appSessions.findIndex(item => item.appId === record.appId && item.id === record.id)
    if (index >= 0) project.value.appSessions[index] = record
    else project.value.appSessions.unshift(record)
    project.value.appSessions = [...project.value.appSessions].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))
  }

  async function createAppSession(appId: string) {
    try {
      const record = await window.electronAPI.createAppSession({ appId })
      replaceAppSessionRecord(record)
      await openAppSession(record)
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function renameAppSession(record: AppSessionRecord) {
    const title = window.prompt('存档名称', record.title)
    if (title === null) return
    try {
      const saved = await window.electronAPI.updateAppSession({ appId: record.appId, id: record.id, title })
      replaceAppSessionRecord(saved)
      const runtime = runtimeFor(saved.appId, saved.id)
      if (runtime) {
        runtime.record = saved
        replaceRuntime(runtime)
      }
      showToast('存档已重命名', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function deleteAppSession(record: AppSessionRecord) {
    if (runtimeFor(record.appId, record.id)) {
      showToast('请先关闭正在运行的存档。', 'error')
      return
    }
    if (!window.confirm(`删除存档「${record.title}」？`)) return
    try {
      project.value = await window.electronAPI.deleteAppSession(record.appId, record.id)
      showToast('存档已删除', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function openAppSession(record: AppSessionRecord) {
    const existing = runningAppSessions.value.find(runtime => runtime.app.manifest.id === record.appId)
    if (existing) {
      activeRuntimeKey.value = existing.key
      selectedAppId.value = record.appId
      activeView.value = 'apps'
      return
    }

    const app = appById.value.get(record.appId)
    if (!app) {
      showToast('应用尚未安装。', 'error')
      return
    }

    try {
      const touched = await window.electronAPI.touchAppSession(record.appId, record.id)
      replaceAppSessionRecord(touched)
      const runtime: RuntimeAppSession = {
        key: runtimeKey(record.appId, record.id),
        app,
        record: touched,
        chatSessions: [],
        activeChatSessionId: null,
        chatPanelOpen: false,
        nextChatSessionId: 0,
        nextMessageId: 0,
        port: null,
        frameLoadCount: 0
      }
      runningAppSessions.value = [...runningAppSessions.value, runtime]
      selectedAppId.value = record.appId
      activeRuntimeKey.value = runtime.key
      activeView.value = 'apps'
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function closeRuntime(runtime: RuntimeAppSession) {
    const hasGenerating = runtime.chatSessions.some(session => session.status === 'generating')
    if (hasGenerating && !window.confirm('该存档还有正在生成的回复，关闭会全部终止。继续？')) return
    await window.electronAPI.stopAppChatGeneration(runtime.app.manifest.id, runtime.record.id)
    runtime.port?.close()
    runningAppSessions.value = runningAppSessions.value.filter(item => item.key !== runtime.key)
    if (activeRuntimeKey.value === runtime.key) {
      activeRuntimeKey.value = null
      selectedAppId.value = runtime.app.manifest.id
    }
  }

  function toggleChatPanel(runtime: RuntimeAppSession, chatSessionId: number) {
    if (runtime.activeChatSessionId === chatSessionId && runtime.chatPanelOpen) {
      runtime.chatPanelOpen = false
    } else {
      runtime.activeChatSessionId = chatSessionId
      runtime.chatPanelOpen = true
    }
    replaceRuntime(runtime)
  }

  async function sendUserMessage(runtime: RuntimeAppSession, chatSessionId: number, text: string, source: 'composer' | 'option') {
    const session = chatSession(runtime, chatSessionId)
    if (!text.trim()) return
    if (source === 'composer' && !session.allowUserReply) return
    if (source === 'option') session.options = []
    replaceRuntime(runtime)
    sendFrameEvent(runtime, {
      type: 'userMessage',
      chatSessionId,
      text,
      source
    })
  }

  function appLlmInstances(): AppLlmInstanceSummary[] {
    return availableLlmInstances.value.map(instance => ({
      id: instance.id,
      name: instance.name
    }))
  }

  function changeChatSessionLlmInstance(runtime: RuntimeAppSession, chatSessionId: number, llmInstanceId: number) {
    const session = chatSession(runtime, chatSessionId)
    if (session.status === 'generating') {
      showToast('当前 chatSession 正在生成，暂不能切换 LLM。', 'error')
      return
    }
    const instance = availableLlmInstances.value.find(item => item.id === llmInstanceId)
    if (!instance) {
      showToast('请选择可用的 LLM 实例。', 'error')
      return
    }
    if (session.llmInstanceId === instance.id) return
    session.llmInstanceId = instance.id
    replaceRuntime(runtime)
    sendFrameEvent(runtime, {
      type: 'llmInstanceChanged',
      chatSessionId,
      llmInstanceId: instance.id
    })
  }

  async function stopChatReply(runtime: RuntimeAppSession, chatSessionId: number) {
    await window.electronAPI.stopAppChatGeneration(runtime.app.manifest.id, runtime.record.id, chatSessionId)
    sendFrameEvent(runtime, { type: 'userStoppedReply', chatSessionId })
  }

  function storageSessionId(runtime: RuntimeAppSession, kind: 'appData' | 'save'): number | null {
    return kind === 'appData' ? null : runtime.record.id
  }

  async function readJsonStorage(runtime: RuntimeAppSession, kind: 'appData' | 'save', path: string, fallback: unknown) {
    const text = await window.electronAPI.readAppStorageFile(kind, runtime.app.manifest.id, storageSessionId(runtime, kind), path)
    if (!text) return fallback
    try {
      return JSON.parse(text)
    } catch {
      return fallback
    }
  }

  const hostHandlers: Record<string, HostCallHandler> = {
    'context.get': runtime => contextForRuntime(runtime),
    'appData.list': (runtime, args) => window.electronAPI.listAppStorage('appData', runtime.app.manifest.id, null, String(args[0] ?? '')),
    'appData.mkdir': (runtime, args) => window.electronAPI.makeAppStorageDirectory('appData', runtime.app.manifest.id, null, String(args[0] ?? '')),
    'appData.readText': (runtime, args) => window.electronAPI.readAppStorageFile('appData', runtime.app.manifest.id, null, String(args[0] ?? '')),
    'appData.readBytes': (runtime, args) => window.electronAPI.readAppStorageFileBytes('appData', runtime.app.manifest.id, null, String(args[0] ?? '')),
    'appData.writeText': (runtime, args) => window.electronAPI.writeAppStorageFile('appData', runtime.app.manifest.id, null, String(args[0] ?? ''), String(args[1] ?? '')),
    'appData.writeBytes': (runtime, args) => window.electronAPI.writeAppStorageFileBytes('appData', runtime.app.manifest.id, null, String(args[0] ?? ''), args[1] as Uint8Array),
    'appData.delete': (runtime, args) => window.electronAPI.deleteAppStoragePath('appData', runtime.app.manifest.id, null, String(args[0] ?? ''), asRecord(args[1])),
    'appData.readJson': (runtime, args) => readJsonStorage(runtime, 'appData', String(args[0] ?? ''), args[1]),
    'appData.writeJson': (runtime, args) => window.electronAPI.writeAppStorageFile('appData', runtime.app.manifest.id, null, String(args[0] ?? ''), JSON.stringify(args[1] ?? null, null, 2)),
    'save.list': (runtime, args) => window.electronAPI.listAppStorage('save', runtime.app.manifest.id, runtime.record.id, String(args[0] ?? '')),
    'save.mkdir': (runtime, args) => window.electronAPI.makeAppStorageDirectory('save', runtime.app.manifest.id, runtime.record.id, String(args[0] ?? '')),
    'save.readText': (runtime, args) => window.electronAPI.readAppStorageFile('save', runtime.app.manifest.id, runtime.record.id, String(args[0] ?? '')),
    'save.readBytes': (runtime, args) => window.electronAPI.readAppStorageFileBytes('save', runtime.app.manifest.id, runtime.record.id, String(args[0] ?? '')),
    'save.writeText': (runtime, args) => window.electronAPI.writeAppStorageFile('save', runtime.app.manifest.id, runtime.record.id, String(args[0] ?? ''), String(args[1] ?? '')),
    'save.writeBytes': (runtime, args) => window.electronAPI.writeAppStorageFileBytes('save', runtime.app.manifest.id, runtime.record.id, String(args[0] ?? ''), args[1] as Uint8Array),
    'save.delete': (runtime, args) => window.electronAPI.deleteAppStoragePath('save', runtime.app.manifest.id, runtime.record.id, String(args[0] ?? ''), asRecord(args[1])),
    'save.readJson': (runtime, args) => readJsonStorage(runtime, 'save', String(args[0] ?? ''), args[1]),
    'save.writeJson': (runtime, args) => window.electronAPI.writeAppStorageFile('save', runtime.app.manifest.id, runtime.record.id, String(args[0] ?? ''), JSON.stringify(args[1] ?? null, null, 2)),
    'chat.getLLMInstances': () => appLlmInstances(),
    'chat.createSession': (runtime, args) => {
      const session = freshChatSession(runtime, asRecord(args[0]) as AppChatSessionCreatePayload)
      runtime.chatSessions = [...runtime.chatSessions, session]
      if (runtime.activeChatSessionId === null) runtime.activeChatSessionId = session.id
      replaceRuntime(runtime)
      return clone(session)
    },
    'chat.listSessions': runtime => clone(runtime.chatSessions),
    'chat.getSession': (runtime, args) => clone(chatSession(runtime, Number(args[0]))),
    'chat.updateSession': (runtime, args) => {
      const id = Number(args[0])
      const patch = asRecord(args[1]) as AppChatSessionUpdatePayload
      const session = chatSession(runtime, id)
      assertChatEditable(session)
      Object.assign(session, {
        ...patch,
        tools: hasOwn(patch, 'tools') ? normalizeTools(patch.tools) : session.tools,
        options: hasOwn(patch, 'options') ? normalizeOptions(patch.options) : session.options
      })
      if (patch.messages) {
        session.messages = patch.messages.map(message => clone(message))
        runtime.nextMessageId = Math.max(runtime.nextMessageId, ...session.messages.map(message => message.id + 1), 0)
      }
      replaceRuntime(runtime)
      return clone(session)
    },
    'chat.deleteSession': async (runtime, args) => {
      const id = Number(args[0])
      if (chatSession(runtime, id).status === 'generating') await stopChatReply(runtime, id)
      runtime.chatSessions = runtime.chatSessions.filter(session => session.id !== id)
      if (runtime.activeChatSessionId === id) runtime.activeChatSessionId = runtime.chatSessions[0]?.id ?? null
      replaceRuntime(runtime)
      return clone(runtime.chatSessions)
    },
    'chat.appendMessage': (runtime, args) => {
      const session = chatSession(runtime, Number(args[0]))
      assertChatEditable(session)
      const message = normalizeMessage(runtime.nextMessageId++, asRecord(args[1]) as unknown as AppChatMessageCreatePayload)
      session.messages = [...session.messages, message]
      replaceRuntime(runtime)
      return clone(message)
    },
    'chat.updateMessage': (runtime, args) => {
      const session = chatSession(runtime, Number(args[0]))
      assertChatEditable(session)
      const messageId = Number(args[1])
      const patch = asRecord(args[2]) as AppChatMessageUpdatePayload
      const message = session.messages.find(item => item.id === messageId)
      if (!message) throw new Error('消息不存在。')
      Object.assign(message, {
        ...patch,
        updatedAt: nowIso()
      })
      replaceRuntime(runtime)
      return clone(message)
    },
    'chat.deleteMessage': (runtime, args) => {
      const session = chatSession(runtime, Number(args[0]))
      assertChatEditable(session)
      const messageId = Number(args[1])
      session.messages = session.messages.filter(message => message.id !== messageId)
      replaceRuntime(runtime)
      return clone(session)
    },
    'chat.registerTool': (runtime, args) => {
      const session = chatSession(runtime, Number(args[0]))
      assertChatEditable(session)
      const tool = normalizeTools([args[1]])[0]
      if (!tool) throw new Error('工具定义不合法。')
      session.tools = [...session.tools.filter(item => item.name !== tool.name), tool]
      replaceRuntime(runtime)
      return clone(session)
    },
    'chat.triggerLlmReply': (runtime, args) => triggerLlmReply(runtime, Number(args[0])),
    'chat.stopLlmReply': (runtime, args) => stopChatReply(runtime, Number(args[0]))
  }

  async function handleHostCall(runtime: RuntimeAppSession, method: string, args: unknown[]): Promise<unknown> {
    const handler = hostHandlers[method]
    if (!handler) throw new Error(`未知应用 API：${method}`)
    return handler(runtime, args)
  }

  function connectAppFrame(runtime: RuntimeAppSession, targetWindow: Window) {
    runtime.port?.close()
    const channel = new MessageChannel()
    runtime.port = channel.port1
    runtime.port.onmessage = event => {
      const data = asRecord(event.data)
      if (data.source !== CLIENT_SOURCE) return
      if (data.type === 'toolCallResponse') {
        void window.electronAPI.resolveAppToolCall({
          requestId: String(data.requestId ?? ''),
          ok: data.ok === true,
          output: data.output as never,
          error: typeof data.error === 'string' ? data.error : undefined
        })
        return
      }
      if (data.type !== 'call') return
      const id = Number(data.id)
      const method = String(data.method ?? '')
      const args = Array.isArray(data.args) ? data.args : []
      void Promise.resolve(handleHostCall(runtime, method, args))
        .then(value => runtime.port?.postMessage({ source: HOST_SOURCE, type: 'response', id, ok: true, value }))
        .catch(error => runtime.port?.postMessage({
          source: HOST_SOURCE,
          type: 'response',
          id,
          ok: false,
          error: errorText(error)
        }))
    }
    runtime.port.start()
    targetWindow.postMessage({
      source: HOST_SOURCE,
      type: 'connect',
      context: contextForRuntime(runtime)
    }, '*', [channel.port2])
    replaceRuntime(runtime)
  }

  async function handleAppFrameLoaded(runtime: RuntimeAppSession, targetWindow: Window) {
    runtime.frameLoadCount += 1
    connectAppFrame(runtime, targetWindow)
  }

  async function triggerLlmReply(runtime: RuntimeAppSession, chatSessionId: number) {
    const session = chatSession(runtime, chatSessionId)
    assertChatEditable(session)
    const llmInstanceId = replyLlmInstanceId(session.llmInstanceId)
    if (!llmInstanceId) throw new Error('项目里还没有可用的 LLM 实例。')
    const assistant = normalizeMessage(runtime.nextMessageId++, {
      role: 'assistant',
      contentParts: [],
      status: 'generating'
    })
    const contextMessages = clone(session.messages)
    session.messages = [...session.messages, assistant]
    session.status = 'generating'
    session.errorText = ''
    session.llmInstanceId = llmInstanceId
    replaceRuntime(runtime)

    try {
      await window.electronAPI.startAppChatGeneration({
        appId: runtime.app.manifest.id,
        appSessionId: runtime.record.id,
        chatSessionId,
        assistantMessageId: assistant.id,
        llmInstanceId,
        messages: contextMessages,
        tools: clone(session.tools)
      })
      return clone(session)
    } catch (error) {
      assistant.status = 'error'
      assistant.errorText = errorText(error)
      session.status = 'error'
      session.errorText = assistant.errorText
      replaceRuntime(runtime)
      sendFrameEvent(runtime, {
        type: 'llmReplyError',
        chatSessionId,
        assistantMessageId: assistant.id,
        contentParts: assistant.contentParts,
        error: assistant.errorText
      })
      throw error
    }
  }

  function applyGenerationEvent(event: AppLlmGenerationEvent) {
    const runtime = runtimeFor(event.appId, event.appSessionId)
    if (!runtime) return
    const session = runtime.chatSessions.find(item => item.id === event.chatSessionId)
    const message = session?.messages.find(item => item.id === event.assistantMessageId)
    if (!session || !message) return

    if (event.type === 'started') {
      session.status = 'generating'
      message.status = 'generating'
      sendFrameEvent(runtime, { type: 'llmReplyStarted', chatSessionId: session.id, assistantMessageId: message.id })
    } else if (event.type === 'delta') {
      message.contentParts = clone(event.contentParts)
      message.status = 'generating'
      message.updatedAt = nowIso()
      sendFrameEvent(runtime, {
        type: 'llmReplyDelta',
        chatSessionId: session.id,
        assistantMessageId: message.id,
        text: event.text,
        contentParts: clone(event.contentParts)
      })
    } else if (event.type === 'finished') {
      message.contentParts = clone(event.contentParts)
      message.status = 'idle'
      message.updatedAt = nowIso()
      session.status = 'idle'
      session.errorText = ''
      sendFrameEvent(runtime, {
        type: 'llmReplyFinished',
        chatSessionId: session.id,
        assistantMessageId: message.id,
        contentParts: clone(event.contentParts)
      })
    } else if (event.type === 'stopped') {
      message.contentParts = clone(event.contentParts)
      message.status = 'stopped'
      message.updatedAt = nowIso()
      session.status = 'stopped'
      sendFrameEvent(runtime, {
        type: 'llmReplyStopped',
        chatSessionId: session.id,
        assistantMessageId: message.id,
        contentParts: clone(event.contentParts)
      })
    } else if (event.type === 'error') {
      message.contentParts = clone(event.contentParts)
      message.status = 'error'
      message.errorText = event.error
      message.updatedAt = nowIso()
      session.status = 'error'
      session.errorText = event.error
      showToast(event.error, 'error')
      sendFrameEvent(runtime, {
        type: 'llmReplyError',
        chatSessionId: session.id,
        assistantMessageId: message.id,
        contentParts: clone(event.contentParts),
        error: event.error
      })
    }
    replaceRuntime(runtime)
  }

  function handleToolCallRequest(request: AppToolCallRequest) {
    const runtime = runtimeFor(request.appId, request.appSessionId)
    if (!runtime?.port) {
      void window.electronAPI.resolveAppToolCall({
        requestId: request.requestId,
        ok: false,
        error: '应用会话未连接。'
      })
      return
    }
    sendFrameEvent(runtime, {
      type: 'toolCall',
      requestId: request.requestId,
      chatSessionId: request.chatSessionId,
      toolName: request.toolName,
      input: request.input
    })
  }

  function appStorageFilesPlaceholder(): AppFileEntry[] {
    return []
  }

  onMounted(() => {
    void loadProject()
    unsubscribeGenerationEvents = window.electronAPI.onAppChatGenerationEvent(applyGenerationEvent)
    unsubscribeToolRequests = window.electronAPI.onAppToolCallRequest(handleToolCallRequest)
  })

  onBeforeUnmount(() => {
    unsubscribeGenerationEvents?.()
    unsubscribeToolRequests?.()
    for (const runtime of runningAppSessions.value) runtime.port?.close()
  })

  return {
    activeRuntime,
    activeRuntimeKey,
    activeView,
    appIconUrl,
    appSessions,
    apps,
    appStorageFilesPlaceholder,
    availableLlmInstances,
    changeChatSessionLlmInstance,
    clearSelectedLlmProviderModelsCache,
    closeRuntime,
    connectAppFrame,
    createAppSession,
    createLlmInstance,
    createLlmProvider,
    deleteAppSession,
    deleteSelectedLlmInstance,
    deleteSelectedLlmProvider,
    fetchSelectedLlmProviderModels,
    handleAppFrameLoaded,
    installApp,
    llmInstances,
    llmProviders,
    openApp,
    openAppSession,
    openProject,
    openRecentProject,
    project,
    recentApps,
    recentProjects,
    refreshRecentProjects,
    renameAppSession,
    reorderLlmInstances,
    runningAppSessions,
    saveLlmInstance,
    saveLlmProvider,
    saveProjectConfig,
    selectLlmInstance,
    selectLlmProvider,
    selectedApp,
    selectedAppId,
    selectedAppSessions,
    selectedLlmInstance,
    selectedLlmProvider,
    selectedProviderForInstance,
    sendUserMessage,
    showAppLibrary,
    showToast,
    stopChatReply,
    toasts,
    toggleChatPanel,
    uninstallSelectedApp
  }
}

export type ProjectWorkbench = ReturnType<typeof createProjectWorkbench>

const projectWorkbenchKey: InjectionKey<ProjectWorkbench> = Symbol('ProjectWorkbench')

export function provideProjectWorkbench(workbench: ProjectWorkbench): void {
  provide(projectWorkbenchKey, workbench)
}

export function useProjectWorkbench(): ProjectWorkbench {
  const workbench = inject(projectWorkbenchKey)
  if (!workbench) {
    throw new Error('Project workbench context is not available.')
  }
  return workbench
}
