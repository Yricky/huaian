import { computed, inject, onBeforeUnmount, onMounted, provide, ref, type InjectionKey } from 'vue'
import type {
  ChatBlock,
  ChatCreatePayload,
  ChatBlockCreatePayload,
  ChatGenerationEvent,
  ChatGenerationPreviewMessage,
  ChatGenerationRequest,
  ChatSession,
  LlmInstance,
  LlmInstanceCreatePayload,
  LlmProvider,
  LlmProviderCreatePayload,
  ProjectConfigUpdatePayload,
  ProjectSnapshot,
  RecentProject,
  SidebarView
} from '@/shared/types'
import { preparePluginChatGeneration, startPluginToolBridge } from '../pluginRuntime'

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastMessage {
  id: number
  kind: ToastKind
  text: string
}

export function createProjectWorkbench() {
  const project = ref<ProjectSnapshot | null>(null)
  const recentProjects = ref<RecentProject[]>([])
  const activeView = ref<SidebarView>('chat')
  const selectedLlmProvider = ref<LlmProvider | null>(null)
  const selectedLlmInstance = ref<LlmInstance | null>(null)
  const selectedChat = ref<ChatSession | null>(null)
  const generatingChatIds = ref<number[]>([])
  const toasts = ref<ToastMessage[]>([])
  let toastId = 0

  const llmProviders = computed(() => project.value?.llmProviders ?? [])
  const llmInstances = computed(() => project.value?.llmInstances ?? [])
  const chats = computed(() => project.value?.chats ?? [])
  const chatBlocks = computed(() => project.value?.chatBlocks ?? [])
  const plugins = computed(() => project.value?.plugins ?? [])

  const selectedChatBlocks = computed(() => {
    const chatId = selectedChat.value?.id
    if (!chatId) return []
    return chatBlocks.value
      .filter(block => block.chatId === chatId)
      .sort((a, b) => {
        const orderDelta = a.orderIndex - b.orderIndex
        if (orderDelta !== 0) return orderDelta
        return a.id - b.id
      })
  })

  const selectedChatLlmInstance = computed(() => {
    const id = selectedChat.value?.runtimeConfig.llmInstanceId
    return id === null || id === undefined ? null : llmInstances.value.find(instance => instance.id === id) ?? null
  })

  const selectedProviderForInstance = computed(() => {
    const id = selectedLlmInstance.value?.providerId
    return id === null || id === undefined ? null : llmProviders.value.find(provider => provider.id === id) ?? null
  })

  const isSelectedChatGenerating = computed(() => (
    Boolean(selectedChat.value && generatingChatIds.value.includes(selectedChat.value.id))
  ))

  function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value))
  }

  function toIpcJson(value: unknown): string {
    return JSON.stringify(value)
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

  function resetProjectSelections() {
    selectedLlmProvider.value = null
    selectedLlmInstance.value = null
    selectedChat.value = null
  }

  function selectInitialProjectItems() {
    if (llmProviders.value.length) selectedLlmProvider.value = clone(llmProviders.value[0])
    if (llmInstances.value.length) selectedLlmInstance.value = clone(llmInstances.value[0])
    if (chats.value.length) selectedChat.value = clone(chats.value[0])
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

  function refreshSelectedChat() {
    if (!selectedChat.value) return
    const fresh = chats.value.find(item => item.id === selectedChat.value?.id)
    selectedChat.value = fresh ? clone(fresh) : null
  }

  function applyProjectSnapshot(snapshot: ProjectSnapshot) {
    project.value = snapshot
    resetProjectSelections()
    selectInitialProjectItems()
    void refreshRecentProjects()
  }

  async function refreshRecentProjects() {
    recentProjects.value = await window.electronAPI.listRecentProjects()
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
    if (!project.value) return
    refreshSelectedLlmProvider()
    refreshSelectedLlmInstance()
    refreshSelectedChat()
  }

  async function openProject() {
    try {
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
    try {
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
    else project.value.llmInstances.unshift(instance)
    selectedLlmInstance.value = clone(instance)
    refreshSelectedChat()
  }

  function replaceChat(chat: ChatSession) {
    if (!project.value) return
    const index = project.value.chats.findIndex(item => item.id === chat.id)
    if (index >= 0) project.value.chats[index] = chat
    else project.value.chats.unshift(chat)
    selectedChat.value = clone(chat)
  }

  function replaceChatBlock(block: ChatBlock) {
    if (!project.value) return
    const index = project.value.chatBlocks.findIndex(item => item.id === block.id)
    if (index >= 0) project.value.chatBlocks[index] = block
    else project.value.chatBlocks.push(block)
  }

  function providerSnapshot(provider: LlmProvider) {
    return {
      providerName: provider.name,
      type: provider.type,
      config: clone(provider.config)
    }
  }

  async function createLlmProvider(payload?: Partial<LlmProviderCreatePayload>) {
    try {
      const provider = await window.electronAPI.createLlmProvider(toIpcJson({
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
      const saved = await window.electronAPI.updateLlmProvider(toIpcJson({
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
      refreshSelectedChat()
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

  async function restoreProviderFromSelectedInstance() {
    if (!selectedLlmInstance.value) return
    try {
      const provider = await window.electronAPI.restoreLlmProviderFromInstance(selectedLlmInstance.value.id)
      replaceLlmProvider(provider)
      showToast('已从 LLM 实例恢复提供商，请补充 API Key', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function createLlmInstance(payload: LlmInstanceCreatePayload) {
    try {
      const instance = await window.electronAPI.createLlmInstance(toIpcJson(payload))
      replaceLlmInstance(instance)
      activeView.value = 'settings'
      showToast('LLM 实例已创建', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function saveLlmInstance(instance: LlmInstance) {
    try {
      const saved = await window.electronAPI.updateLlmInstance(toIpcJson({
        id: instance.id,
        name: instance.name,
        providerId: instance.providerId,
        modelId: instance.modelId,
        providerSnapshot: instance.providerSnapshot,
        parameters: instance.parameters,
        extra: instance.extra
      }))
      replaceLlmInstance(saved)
      showToast('LLM 实例已保存', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function deleteSelectedLlmInstance() {
    if (!selectedLlmInstance.value || !window.confirm('删除当前 LLM 实例？已生成的助手块会保留自己的实例快照。')) return
    try {
      project.value = await window.electronAPI.deleteLlmInstance(selectedLlmInstance.value.id)
      selectedLlmInstance.value = llmInstances.value[0] ? clone(llmInstances.value[0]) : null
      refreshSelectedChat()
      showToast('LLM 实例已删除', 'success')
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

  function selectChat(chat: ChatSession) {
    selectedChat.value = clone(chat)
  }

  async function saveProjectConfig(payload: ProjectConfigUpdatePayload): Promise<boolean> {
    if (!project.value) return false
    try {
      project.value.config = await window.electronAPI.updateProjectConfig(toIpcJson(payload))
      return true
    } catch (error) {
      showToast(errorText(error), 'error')
      return false
    }
  }

  async function createChat(payload?: ChatCreatePayload): Promise<ChatSession | null> {
    try {
      const chat = await window.electronAPI.createChat(payload ? toIpcJson(payload) : undefined)
      replaceChat(chat)
      activeView.value = 'chat'
      showToast('聊天已创建', 'success')
      return chat
    } catch (error) {
      showToast(errorText(error), 'error')
      return null
    }
  }

  async function saveChat(chat: ChatSession) {
    try {
      replaceChat(await window.electronAPI.updateChat(toIpcJson({
        id: chat.id,
        title: chat.title,
        runtimeConfig: chat.runtimeConfig
      })))
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function deleteChat(chat: ChatSession) {
    if (generatingChatIds.value.includes(chat.id) || !window.confirm('删除当前聊天？其中的所有块会一并删除。')) return
    try {
      const wasSelected = selectedChat.value?.id === chat.id
      project.value = await window.electronAPI.deleteChat(chat.id)
      if (wasSelected) {
        selectedChat.value = chats.value[0] ? clone(chats.value[0]) : null
      } else {
        refreshSelectedChat()
      }
      showToast('聊天已删除', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function createChatBlock(payload: ChatBlockCreatePayload) {
    try {
      const block = await window.electronAPI.createChatBlock(toIpcJson(payload))
      replaceChatBlock(block)
      await refreshProjectSnapshot()
      return block
    } catch (error) {
      showToast(errorText(error), 'error')
      return null
    }
  }

  async function saveChatBlock(block: ChatBlock) {
    try {
      replaceChatBlock(await window.electronAPI.updateChatBlock(toIpcJson({
        id: block.id,
        enabled: block.enabled,
        contentParts: block.contentParts,
        metadata: block.metadata
      })))
      await refreshProjectSnapshot()
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function deleteChatBlock(block: ChatBlock) {
    try {
      project.value = await window.electronAPI.deleteChatBlock(block.id)
      refreshSelectedChat()
      showToast('聊天块已删除', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function prepareGenerationRequest(payload: ChatGenerationRequest): Promise<ChatGenerationRequest> {
    if (!project.value) return payload
    const chat = chats.value.find(item => item.id === payload.chatId)
    if (!chat) return payload
    const blocks = chatBlocks.value
      .filter(block => block.chatId === chat.id)
      .sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id)
    const target = payload.regenerateBlockId
      ? blocks.find(block => block.id === payload.regenerateBlockId)
      : null
    const contextBlocks = target
      ? blocks.filter(block => block.orderIndex < target.orderIndex)
      : blocks
    const bundle = await preparePluginChatGeneration(project.value, chat, contextBlocks)
    return {
      ...payload,
      messages: bundle.messages,
      toolDefinitions: bundle.toolDefinitions
    }
  }

  async function prepareChatDisplayBlocks(chat: ChatSession, blocks: ChatBlock[]): Promise<ChatBlock[]> {
    if (!project.value) return blocks
    try {
      const bundle = await preparePluginChatGeneration(project.value, chat, blocks)
      return bundle.displayBlocks
    } catch (error) {
      showToast(errorText(error), 'error')
      return blocks
    }
  }

  async function startChatGeneration(payload: ChatGenerationRequest) {
    try {
      const prepared = await prepareGenerationRequest(payload)
      const result = await window.electronAPI.startChatGeneration(toIpcJson(prepared))
      replaceChatBlock(result.block)
      if (!generatingChatIds.value.includes(payload.chatId)) {
        generatingChatIds.value = [...generatingChatIds.value, payload.chatId]
      }
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function previewChatGeneration(payload: ChatGenerationRequest): Promise<ChatGenerationPreviewMessage[] | null> {
    try {
      const prepared = await prepareGenerationRequest(payload)
      return await window.electronAPI.previewChatGeneration(toIpcJson(prepared))
    } catch (error) {
      showToast(errorText(error), 'error')
      return null
    }
  }

  async function stopChatGeneration(chatId: number) {
    try {
      await window.electronAPI.stopChatGeneration(chatId)
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  function handleGenerationEvent(event: ChatGenerationEvent) {
    if (event.type === 'started') {
      replaceChatBlock(event.block)
      if (!generatingChatIds.value.includes(event.chatId)) {
        generatingChatIds.value = [...generatingChatIds.value, event.chatId]
      }
      return
    }

    if (event.type === 'delta') {
      const block = chatBlocks.value.find(item => item.id === event.blockId)
      if (block) {
        block.contentParts = event.contentParts
        block.status = 'generating'
      }
      return
    }

    replaceChatBlock(event.block)
    generatingChatIds.value = generatingChatIds.value.filter(id => id !== event.chatId)
    refreshSelectedChat()
    if (event.type === 'error') showToast(event.error, 'error')
  }

  function handleProjectSnapshotChanged() {
    void refreshProjectSnapshot()
  }

  let unsubscribeGenerationEvents: (() => void) | null = null

  onMounted(() => {
    void loadProject()
    startPluginToolBridge(() => project.value)
    unsubscribeGenerationEvents = window.electronAPI.onChatGenerationEvent(handleGenerationEvent)
    window.addEventListener('st-forge-project-snapshot-changed', handleProjectSnapshotChanged)
  })

  onBeforeUnmount(() => {
    unsubscribeGenerationEvents?.()
    window.removeEventListener('st-forge-project-snapshot-changed', handleProjectSnapshotChanged)
  })

  return {
    activeView,
    chatBlocks,
    chats,
    clearSelectedLlmProviderModelsCache,
    createChat,
    createChatBlock,
    createLlmInstance,
    createLlmProvider,
    deleteChat,
    deleteChatBlock,
    deleteSelectedLlmInstance,
    deleteSelectedLlmProvider,
    fetchSelectedLlmProviderModels,
    generatingChatIds,
    isSelectedChatGenerating,
    llmInstances,
    llmProviders,
    openProject,
    openRecentProject,
    plugins,
    previewChatGeneration,
    prepareChatDisplayBlocks,
    project,
    providerSnapshot,
    recentProjects,
    refreshRecentProjects,
    restoreProviderFromSelectedInstance,
    saveChat,
    saveChatBlock,
    saveLlmInstance,
    saveLlmProvider,
    saveProjectConfig,
    selectChat,
    selectLlmInstance,
    selectLlmProvider,
    selectedChat,
    selectedChatBlocks,
    selectedChatLlmInstance,
    selectedLlmInstance,
    selectedLlmProvider,
    selectedProviderForInstance,
    showToast,
    startChatGeneration,
    stopChatGeneration,
    toasts
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
