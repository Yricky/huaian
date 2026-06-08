import { computed, inject, onBeforeUnmount, onMounted, provide, ref, toRaw, type InjectionKey } from 'vue'
import {
  APP_API_CLIENT_SOURCE,
  APP_API_HOST_SOURCE,
  type AssistantContentPart,
  type AppChatContentPart,
  type AppChatMessage,
  type AppChatMessageCreatePayload,
  type AppChatMessageUpdatePayload,
  type AppChatSessionCreatePayload,
  type AppChatSessionState,
  type AppChatSessionUpdatePayload,
  type AppEvent,
  type AppFileEntry,
  type AppFrameContext,
  type AppLlmInstanceSummary,
  type AppToolDefinition,
  type UserContentPart
} from '@huaian/app-api'
import { asRecord, toStructuredCloneable } from '@huaian/app-api/value-utils'
import type {
  AppDescriptor,
  AppLlmGenerationEvent,
  AppSessionRecord,
  AppToolCallRequest,
  AppUninstallOptions,
  LlmInstance,
  LlmInstanceCreatePayload,
  LlmProvider,
  LlmProviderCreatePayload,
  ProjectSnapshot,
  RecentProject,
  SidebarView
} from '@/shared/types'

type AssistantChatMessage = Extract<AppChatMessage, { role: 'assistant' }>

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
  const isInstallingApp = ref(false)
  const isUninstallingApp = ref(false)
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
    return `${appId}/${sessionId}`
  }

  function replaceRuntime(runtime: RuntimeAppSession) {
    const index = runningAppSessions.value.findIndex(item => item.key === runtime.key)
    if (index >= 0) runningAppSessions.value[index] = runtime
    runningAppSessions.value = [...runningAppSessions.value]
  }

  async function resetRuntimeFrameSessions(runtime: RuntimeAppSession): Promise<void> {
    const appId = runtime.app.manifest.id
    const appSessionId = runtime.record.id
    runtime.port?.close()
    runtime.port = null
    runtime.chatSessions = []
    runtime.activeChatSessionId = null
    runtime.chatPanelOpen = false
    runtime.nextChatSessionId = 0
    runtime.nextMessageId = 0
    replaceRuntime(runtime)
    try {
      await window.electronAPI.stopAppChatGeneration(appId, appSessionId)
    } catch (error) {
      showToast(errorText(error), 'error')
    }
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

  function normalizePartForRole(role: AppChatMessage['role'], part: AppChatContentPart): AppChatContentPart {
    if (role === 'system') {
      if (part.type !== 'text') throw new Error('system 消息只支持 text contentPart。')
      return { type: 'text', text: part.text }
    }
    if (role === 'user') {
      if (part.type === 'text') return { type: 'text', text: part.text }
      if (part.type === 'image') {
        return {
          type: 'image',
          file: toStructuredCloneable(part.file),
          mediaType: part.mediaType,
          filename: part.filename,
          alt: part.alt
        }
      }
      throw new Error('user 消息只支持 text 和 image contentPart。')
    }
    if (part.type === 'text') return { type: 'text', text: part.text }
    if (part.type === 'reasoning') return { type: 'reasoning', text: part.text, sendAsContext: part.sendAsContext }
    if (part.type === 'image') {
      return {
        type: 'image',
        file: toStructuredCloneable(part.file),
        mediaType: part.mediaType,
        filename: part.filename,
        alt: part.alt
      }
    }
    return toStructuredCloneable(part)
  }

  function normalizeContentParts(role: AppChatMessage['role'], contentParts?: AppChatContentPart[]): AppChatContentPart[] {
    const rawParts = toStructuredCloneable(contentParts ?? [])
    return rawParts.map(part => normalizePartForRole(role, part))
  }

  function normalizeMessage(id: number, payload: AppChatMessageCreatePayload): AppChatMessage {
    const now = nowIso()
    const base = {
      id,
      role: payload.role,
      contentParts: normalizeContentParts(payload.role, payload.contentParts as AppChatContentPart[] | undefined),
      metadata: asRecord(payload.metadata),
      createdAt: now,
      updatedAt: now
    }
    if (payload.role === 'assistant') {
      return {
        ...base,
        role: 'assistant',
        contentParts: base.contentParts as AssistantContentPart[],
        status: payload.status ?? 'idle',
        errorText: payload.errorText ?? ''
      }
    }
    return base as AppChatMessage
  }

  function normalizeStoredMessage(message: AppChatMessage): AppChatMessage {
    const raw = toStructuredCloneable(message)
    const base = {
      id: raw.id,
      role: raw.role,
      contentParts: normalizeContentParts(raw.role, raw.contentParts),
      metadata: asRecord(raw.metadata),
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt
    }
    if (raw.role === 'assistant') {
      return {
        ...base,
        role: 'assistant',
        contentParts: base.contentParts as AssistantContentPart[],
        status: raw.status ?? 'idle',
        errorText: raw.errorText ?? ''
      }
    }
    return base as AppChatMessage
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
    const messages = (payload.messages ?? []).map(message => normalizeStoredMessage(message))
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

  function sendFrameEvent(runtime: RuntimeAppSession, event: AppEvent): void {
    runtime.port?.postMessage({
      source: APP_API_HOST_SOURCE,
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
    for (const runtime of runningAppSessions.value) {
      runtime.port?.close()
    }
    runningAppSessions.value = []
  }

  function selectInitialProjectItems() {
    if (llmProviders.value.length) selectedLlmProvider.value = toStructuredCloneable(llmProviders.value[0])
    if (llmInstances.value.length) selectedLlmInstance.value = toStructuredCloneable(llmInstances.value[0])
    if (apps.value.length) selectedAppId.value = apps.value[0].manifest.id
  }

  function refreshSelectedLlmProvider() {
    if (!selectedLlmProvider.value) return
    const fresh = llmProviders.value.find(item => item.id === selectedLlmProvider.value?.id)
    selectedLlmProvider.value = fresh ? toStructuredCloneable(fresh) : null
  }

  function refreshSelectedLlmInstance() {
    if (!selectedLlmInstance.value) return
    const fresh = llmInstances.value.find(item => item.id === selectedLlmInstance.value?.id)
    selectedLlmInstance.value = fresh ? toStructuredCloneable(fresh) : null
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
    selectedLlmProvider.value = toStructuredCloneable(provider)
  }

  function replaceLlmInstance(instance: LlmInstance) {
    if (!project.value) return
    const index = project.value.llmInstances.findIndex(item => item.id === instance.id)
    if (index >= 0) project.value.llmInstances[index] = instance
    else project.value.llmInstances.push(instance)
    project.value.llmInstances.sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id)
    selectedLlmInstance.value = toStructuredCloneable(instance)
  }

  async function createLlmProvider(payload?: Partial<LlmProviderCreatePayload>) {
    try {
      const provider = await window.electronAPI.createLlmProvider(toStructuredCloneable({
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
      const saved = await window.electronAPI.updateLlmProvider(toStructuredCloneable({
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
      selectedLlmProvider.value = llmProviders.value[0] ? toStructuredCloneable(llmProviders.value[0]) : null
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
      const instance = await window.electronAPI.createLlmInstance(toStructuredCloneable(payload))
      replaceLlmInstance(instance)
      activeView.value = 'settings'
      showToast('LLM 实例已创建', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function saveLlmInstance(instance: LlmInstance) {
    try {
      const saved = await window.electronAPI.updateLlmInstance(toStructuredCloneable({
        id: instance.id,
        name: instance.name,
        providerId: instance.providerId,
        modelId: instance.modelId,
        features: instance.features,
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
      selectedLlmInstance.value = llmInstances.value[0] ? toStructuredCloneable(llmInstances.value[0]) : null
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
    selectedLlmProvider.value = toStructuredCloneable(provider)
  }

  function selectLlmInstance(instance: LlmInstance) {
    selectedLlmInstance.value = toStructuredCloneable(instance)
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
    if (isInstallingApp.value || isUninstallingApp.value) {
      showToast('应用安装或卸载正在进行，请稍后再试。', 'info')
      return
    }
    if (runningAppSessions.value.length) {
      showToast('请先关闭运行中的应用，再安装或更新应用。', 'error')
      return
    }
    isInstallingApp.value = true
    try {
      const result = await window.electronAPI.installApp()
      project.value = result.project
      if (result.installed) {
        selectInitialProjectItems()
        showToast('应用已安装', 'success')
      }
    } catch (error) {
      showToast(errorText(error), 'error')
    } finally {
      isInstallingApp.value = false
    }
  }

  async function uninstallSelectedApp(options: AppUninstallOptions) {
    if (isInstallingApp.value || isUninstallingApp.value) {
      showToast('应用安装或卸载正在进行，请稍后再试。', 'info')
      return
    }
    const app = selectedApp.value
    if (!app) return
    const appId = app.manifest.id
    if (runningAppSessions.value.some(runtime => runtime.app.manifest.id === appId)) {
      showToast('请先关闭该应用正在运行的存档。', 'error')
      return
    }
    isUninstallingApp.value = true
    try {
      project.value = await window.electronAPI.uninstallApp(appId, options)
      selectedAppId.value = apps.value[0]?.manifest.id ?? null
      showToast('应用已卸载', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    } finally {
      isUninstallingApp.value = false
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

  async function renameAppSession(record: AppSessionRecord, title: string): Promise<boolean> {
    const nextTitle = title.trim()
    if (!nextTitle) {
      showToast('存档名称不能为空。', 'error')
      return false
    }
    if (nextTitle === record.title) return true
    try {
      const saved = await window.electronAPI.updateAppSession({ appId: record.appId, id: record.id, title: nextTitle })
      replaceAppSessionRecord(saved)
      const runtime = runtimeFor(saved.appId, saved.id)
      if (runtime) {
        runtime.record = saved
        replaceRuntime(runtime)
      }
      showToast('存档已重命名', 'success')
      return true
    } catch (error) {
      showToast(errorText(error), 'error')
      return false
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

  async function sendUserMessage(
    runtime: RuntimeAppSession,
    chatSessionId: number,
    source: 'composer' | 'option',
    contentParts: UserContentPart[]
  ) {
    const session = chatSession(runtime, chatSessionId)
    const parts = normalizeContentParts('user', contentParts as AppChatContentPart[]) as UserContentPart[]
    if (!parts.length) return
    if (source === 'composer' && !session.allowUserReply) return
    if (source === 'option') session.options = []
    replaceRuntime(runtime)
    sendFrameEvent(runtime, {
      type: 'userMessage',
      chatSessionId,
      contentParts: parts,
      source
    })
  }

  function appLlmInstances(): AppLlmInstanceSummary[] {
    return availableLlmInstances.value.map(instance => ({
      id: instance.id,
      name: instance.name,
      features: toStructuredCloneable(instance.features)
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
    'appData.writeBytes': (runtime, args) => window.electronAPI.writeAppStorageFileBytes('appData', runtime.app.manifest.id, null, String(args[0] ?? ''), args[1] as ArrayBuffer),
    'appData.delete': (runtime, args) => window.electronAPI.deleteAppStoragePath('appData', runtime.app.manifest.id, null, String(args[0] ?? ''), asRecord(args[1])),
    'appData.readJson': (runtime, args) => readJsonStorage(runtime, 'appData', String(args[0] ?? ''), args[1]),
    'appData.writeJson': (runtime, args) => window.electronAPI.writeAppStorageFile('appData', runtime.app.manifest.id, null, String(args[0] ?? ''), JSON.stringify(args[1] ?? null, null, 2)),
    'save.list': (runtime, args) => window.electronAPI.listAppStorage('save', runtime.app.manifest.id, runtime.record.id, String(args[0] ?? '')),
    'save.mkdir': (runtime, args) => window.electronAPI.makeAppStorageDirectory('save', runtime.app.manifest.id, runtime.record.id, String(args[0] ?? '')),
    'save.readText': (runtime, args) => window.electronAPI.readAppStorageFile('save', runtime.app.manifest.id, runtime.record.id, String(args[0] ?? '')),
    'save.readBytes': (runtime, args) => window.electronAPI.readAppStorageFileBytes('save', runtime.app.manifest.id, runtime.record.id, String(args[0] ?? '')),
    'save.writeText': (runtime, args) => window.electronAPI.writeAppStorageFile('save', runtime.app.manifest.id, runtime.record.id, String(args[0] ?? ''), String(args[1] ?? '')),
    'save.writeBytes': (runtime, args) => window.electronAPI.writeAppStorageFileBytes('save', runtime.app.manifest.id, runtime.record.id, String(args[0] ?? ''), args[1] as ArrayBuffer),
    'save.delete': (runtime, args) => window.electronAPI.deleteAppStoragePath('save', runtime.app.manifest.id, runtime.record.id, String(args[0] ?? ''), asRecord(args[1])),
    'save.readJson': (runtime, args) => readJsonStorage(runtime, 'save', String(args[0] ?? ''), args[1]),
    'save.writeJson': (runtime, args) => window.electronAPI.writeAppStorageFile('save', runtime.app.manifest.id, runtime.record.id, String(args[0] ?? ''), JSON.stringify(args[1] ?? null, null, 2)),
    'chat.getLLMInstances': () => appLlmInstances(),
    'chat.createSession': (runtime, args) => {
      const session = freshChatSession(runtime, asRecord(args[0]) as AppChatSessionCreatePayload)
      runtime.chatSessions = [...runtime.chatSessions, session]
      if (runtime.activeChatSessionId === null) runtime.activeChatSessionId = session.id
      replaceRuntime(runtime)
      return toStructuredCloneable(session)
    },
    'chat.listSessions': runtime => toStructuredCloneable(runtime.chatSessions),
    'chat.getSession': (runtime, args) => toStructuredCloneable(chatSession(runtime, Number(args[0]))),
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
        session.messages = patch.messages.map(message => normalizeStoredMessage(message))
        runtime.nextMessageId = Math.max(runtime.nextMessageId, ...session.messages.map(message => message.id + 1), 0)
      }
      replaceRuntime(runtime)
      return toStructuredCloneable(session)
    },
    'chat.deleteSession': async (runtime, args) => {
      const id = Number(args[0])
      if (chatSession(runtime, id).status === 'generating') await stopChatReply(runtime, id)
      runtime.chatSessions = runtime.chatSessions.filter(session => session.id !== id)
      if (runtime.activeChatSessionId === id) runtime.activeChatSessionId = runtime.chatSessions[0]?.id ?? null
      replaceRuntime(runtime)
      return toStructuredCloneable(runtime.chatSessions)
    },
    'chat.appendMessage': (runtime, args) => {
      const session = chatSession(runtime, Number(args[0]))
      assertChatEditable(session)
      const message = normalizeMessage(runtime.nextMessageId++, asRecord(args[1]) as unknown as AppChatMessageCreatePayload)
      session.messages = [...session.messages, message]
      replaceRuntime(runtime)
      return toStructuredCloneable(message)
    },
    'chat.updateMessage': (runtime, args) => {
      const session = chatSession(runtime, Number(args[0]))
      assertChatEditable(session)
      const messageId = Number(args[1])
      const patchRecord = asRecord(args[2])
      const patch = patchRecord as AppChatMessageUpdatePayload
      const message = session.messages.find(item => item.id === messageId)
      if (!message) throw new Error('消息不存在。')
      const nextRole = patch.role ?? message.role
      if (nextRole !== 'assistant' && (hasOwn(patchRecord, 'status') || hasOwn(patchRecord, 'errorText'))) {
        throw new Error('status 和 errorText 只支持 assistant 消息。')
      }
      const nextContentParts = patch.contentParts
        ? normalizeContentParts(nextRole, patch.contentParts as AppChatContentPart[])
        : message.contentParts
      const base = {
        id: message.id,
        role: nextRole,
        contentParts: nextContentParts,
        metadata: hasOwn(patch, 'metadata') ? asRecord(patch.metadata) : message.metadata,
        createdAt: message.createdAt,
        updatedAt: nowIso()
      }
      const nextMessage = nextRole === 'assistant'
        ? {
          ...base,
          role: 'assistant' as const,
          contentParts: nextContentParts as AssistantContentPart[],
          status: hasOwn(patchRecord, 'status')
            ? patchRecord.status as AssistantChatMessage['status']
            : (message.role === 'assistant' ? message.status : 'idle'),
          errorText: hasOwn(patchRecord, 'errorText')
            ? String(patchRecord.errorText ?? '')
            : (message.role === 'assistant' ? message.errorText : '')
        }
        : base as AppChatMessage
      session.messages = session.messages.map(item => item.id === messageId ? nextMessage : item)
      replaceRuntime(runtime)
      return toStructuredCloneable(nextMessage)
    },
    'chat.deleteMessage': (runtime, args) => {
      const session = chatSession(runtime, Number(args[0]))
      assertChatEditable(session)
      const messageId = Number(args[1])
      session.messages = session.messages.filter(message => message.id !== messageId)
      replaceRuntime(runtime)
      return toStructuredCloneable(session)
    },
    'chat.registerTool': (runtime, args) => {
      const session = chatSession(runtime, Number(args[0]))
      assertChatEditable(session)
      const tool = normalizeTools([args[1]])[0]
      if (!tool) throw new Error('工具定义不合法。')
      session.tools = [...session.tools.filter(item => item.name !== tool.name), tool]
      replaceRuntime(runtime)
      return toStructuredCloneable(session)
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
    const responsePort = channel.port1
    runtime.port.onmessage = event => {
      const data = asRecord(event.data)
      if (data.source !== APP_API_CLIENT_SOURCE) return
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
      const sendResponse = (value: unknown) => {
        if (runtime.port !== responsePort) return
        responsePort.postMessage({ source: APP_API_HOST_SOURCE, type: 'response', id, ok: true, value })
      }
      const sendTransferredBufferResponse = (value: ArrayBuffer) => {
        if (runtime.port !== responsePort) return
        responsePort.postMessage({ source: APP_API_HOST_SOURCE, type: 'response', id, ok: true, value }, [value])
      }
      void Promise.resolve(handleHostCall(runtime, method, args))
        .then(value => {
          if (method.endsWith('.readBytes') && value instanceof ArrayBuffer) {
            sendTransferredBufferResponse(value)
          } else {
            sendResponse(value)
          }
        })
        .catch(error => {
          if (runtime.port !== responsePort) return
          responsePort.postMessage({
            source: APP_API_HOST_SOURCE,
            type: 'response',
            id,
            ok: false,
            error: errorText(error)
          })
        })
    }
    runtime.port.start()
    targetWindow.postMessage({
      source: APP_API_HOST_SOURCE,
      type: 'connect',
      context: contextForRuntime(runtime)
    }, '*', [channel.port2])
    replaceRuntime(runtime)
  }

  async function handleAppFrameLoaded(runtime: RuntimeAppSession, targetWindow: Window) {
    const frameLoadCount = runtime.frameLoadCount + 1
    runtime.frameLoadCount = frameLoadCount
    await resetRuntimeFrameSessions(runtime)
    if (runtime.frameLoadCount !== frameLoadCount) return
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
    }) as AssistantChatMessage
    const contextMessages = toStructuredCloneable(session.messages)
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
        tools: toStructuredCloneable(session.tools)
      })
      return toStructuredCloneable(session)
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
    if (!session || !message || message.role !== 'assistant') return

    if (event.type === 'started') {
      session.status = 'generating'
      message.status = 'generating'
      sendFrameEvent(runtime, { type: 'llmReplyStarted', chatSessionId: session.id, assistantMessageId: message.id })
    } else if (event.type === 'delta') {
      message.contentParts = toStructuredCloneable(event.contentParts)
      message.status = 'generating'
      message.updatedAt = nowIso()
      sendFrameEvent(runtime, {
        type: 'llmReplyDelta',
        chatSessionId: session.id,
        assistantMessageId: message.id,
        text: event.text,
        contentParts: toStructuredCloneable(event.contentParts)
      })
    } else if (event.type === 'finished') {
      message.contentParts = toStructuredCloneable(event.contentParts)
      message.status = 'idle'
      message.updatedAt = nowIso()
      session.status = 'idle'
      session.errorText = ''
      sendFrameEvent(runtime, {
        type: 'llmReplyFinished',
        chatSessionId: session.id,
        assistantMessageId: message.id,
        contentParts: toStructuredCloneable(event.contentParts)
      })
    } else if (event.type === 'stopped') {
      message.contentParts = toStructuredCloneable(event.contentParts)
      message.status = 'stopped'
      message.updatedAt = nowIso()
      session.status = 'stopped'
      sendFrameEvent(runtime, {
        type: 'llmReplyStopped',
        chatSessionId: session.id,
        assistantMessageId: message.id,
        contentParts: toStructuredCloneable(event.contentParts)
      })
    } else if (event.type === 'error') {
      message.contentParts = toStructuredCloneable(event.contentParts)
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
        contentParts: toStructuredCloneable(event.contentParts),
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
    for (const runtime of runningAppSessions.value) {
      runtime.port?.close()
    }
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
    isInstallingApp,
    isUninstallingApp,
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
