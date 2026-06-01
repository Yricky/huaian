import { computed, inject, onBeforeUnmount, onMounted, provide, ref, watch, type InjectionKey } from 'vue'
import type {
  DbChatBlock,
  ChatCreatePayload,
  DbChatBlockCreatePayload,
  ChatGenerationEvent,
  ChatGenerationPreviewMessage,
  ChatGenerationRequest,
  ChatSession,
  LlmToolDefinition,
  LlmInstance,
  LlmInstanceCreatePayload,
  LlmProvider,
  LlmProviderCreatePayload,
  ProjectConfigUpdatePayload,
  ProjectSnapshot,
  ProcessingChat,
  RecentProject,
  SidebarView
} from '@/shared/types'
import {
  messagesFromProcessingChat,
  mixedBlockFromDbChatBlock,
  preparePluginChatProcessing,
  processingChatFromDbBlocks,
  startPluginToolBridge
} from '../pluginRuntime'
import { asRecord } from '../../../shared/value-utils'

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
  const processingChats = ref<Record<number, ProcessingChat>>({})
  const processingToolDefinitions = ref<Record<number, LlmToolDefinition[]>>({})
  const toasts = ref<ToastMessage[]>([])
  let toastId = 0
  let processingRefreshSerial = 0
  const processingRefreshPromises = new Map<number, Promise<ProcessingChat | null>>()
  const processingRefreshTokens = new Map<number, number>()
  const processingTimeoutChats = new Set<number>()

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

  const selectedProcessingChat = computed(() => {
    const chat = selectedChat.value
    if (!chat) return null
    return processingChatForDisplay(chat, selectedChatBlocks.value)
  })

  const selectedProcessingSignature = computed(() => {
    const chat = selectedChat.value
    if (!chat || !project.value) return ''
    return processingSignature(chat, selectedChatBlocks.value, project.value)
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

  function sortedChatBlocksFor(chatId: number): DbChatBlock[] {
    return chatBlocks.value
      .filter(block => block.chatId === chatId)
      .sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id)
  }

  function processableChatBlocks(blocks: DbChatBlock[]): DbChatBlock[] {
    return blocks.filter(block => block.status !== 'generating')
  }

  function metadataForOriginalSignature(metadata: unknown): Record<string, unknown> {
    const { pluginData: _pluginData, ...rest } = asRecord(metadata)
    return rest
  }

  function processingSignature(chat: ChatSession, blocks: DbChatBlock[], snapshot: ProjectSnapshot): string {
    return JSON.stringify({
      chatId: chat.id,
      enabledPluginIds: chat.runtimeConfig.enabledPluginIds,
      toolDefinitions: chat.runtimeConfig.toolDefinitions,
      plugins: snapshot.plugins.map(plugin => ({
        id: plugin.manifest.id,
        versionCode: plugin.manifest.versionCode,
        entry: plugin.manifest.entry
      })),
      blocks: processableChatBlocks(blocks).map(block => ({
        id: block.id,
        kind: block.kind,
        role: block.metadata.targetRole,
        enabled: block.enabled,
        orderIndex: block.orderIndex,
        contentParts: block.contentParts,
        metadata: metadataForOriginalSignature(block.metadata)
      }))
    })
  }

  function pluginDataPatchHasEntries(value: unknown): boolean {
    return Object.keys(asRecord(value)).length > 0
  }

  function mergePluginData(base: unknown, patch: unknown): Record<string, unknown> {
    return {
      ...asRecord(base),
      ...asRecord(patch)
    }
  }

  function processingChatForDisplay(chat: ChatSession, blocks: DbChatBlock[]): ProcessingChat {
    const cached = processingChats.value[chat.id] ?? processingChatFromDbBlocks(chat, processableChatBlocks(blocks))
    const missingBlocks = blocks
      .filter(block => !cached.chatBlocks.some(item => item.original?.id === block.id))
      .map(mixedBlockFromDbChatBlock)
      .sort((a, b) => {
        const left = blocks.find(block => block.id === a.original?.id)?.orderIndex ?? 0
        const right = blocks.find(block => block.id === b.original?.id)?.orderIndex ?? 0
        return left - right
      })
    if (!missingBlocks.length) return cached

    const orderById = new Map(blocks.map(block => [block.id, block.orderIndex]))
    const result: ProcessingChat['chatBlocks'] = []
    let missingIndex = 0
    for (const block of cached.chatBlocks) {
      const order = block.original ? orderById.get(block.original.id) ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY
      while (missingIndex < missingBlocks.length) {
        const missing = missingBlocks[missingIndex]
        const missingOrder = orderById.get(missing.original?.id ?? -1) ?? Number.POSITIVE_INFINITY
        if (missingOrder >= order) break
        result.push(missing)
        missingIndex += 1
      }
      result.push(block)
    }
    result.push(...missingBlocks.slice(missingIndex))
    return {
      ...cached,
      chatBlocks: result
    }
  }

  function scopedProcessingChatForGeneration(chat: ChatSession, processingChat: ProcessingChat, regenerateBlockId?: number | null): ProcessingChat {
    if (!regenerateBlockId) return processingChat
    const target = sortedChatBlocksFor(chat.id).find(block => block.id === regenerateBlockId)
    if (!target) return processingChat
    const allowedIds = new Set(sortedChatBlocksFor(chat.id)
      .filter(block => block.orderIndex < target.orderIndex)
      .map(block => block.id))
    const scopedBlocks: ProcessingChat['chatBlocks'] = []
    for (const block of processingChat.chatBlocks) {
      if (block.original?.id === regenerateBlockId) break
      if (block.original && !allowedIds.has(block.original.id)) continue
      scopedBlocks.push(block)
    }
    return {
      ...processingChat,
      chatBlocks: scopedBlocks
    }
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

  function replaceChatBlock(block: DbChatBlock) {
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

  async function createChatBlock(payload: DbChatBlockCreatePayload) {
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

  async function saveChatBlock(block: DbChatBlock) {
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

  async function deleteChatBlock(block: DbChatBlock) {
    try {
      project.value = await window.electronAPI.deleteChatBlock(block.id)
      refreshSelectedChat()
      showToast('聊天块已删除', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function writeProcessingPluginData(chat: ChatSession, processingChat: ProcessingChat) {
    if (pluginDataPatchHasEntries(processingChat.pluginData)) {
      const updated = await window.electronAPI.updateChat(toIpcJson({
        id: chat.id,
        title: chat.title,
        runtimeConfig: {
          ...chat.runtimeConfig,
          pluginData: mergePluginData(chat.runtimeConfig.pluginData, processingChat.pluginData)
        }
      }))
      replaceChat(updated)
    }

    const blockById = new Map(sortedChatBlocksFor(chat.id).map(block => [block.id, block]))
    for (const block of processingChat.chatBlocks) {
      const originalId = block.original?.id
      if (originalId === undefined || !pluginDataPatchHasEntries(block.pluginData)) continue
      const sourceBlock = blockById.get(originalId)
      if (!sourceBlock) continue
      const metadata = {
        ...sourceBlock.metadata,
        pluginData: mergePluginData(asRecord(sourceBlock.metadata.pluginData), block.pluginData)
      }
      const updated = await window.electronAPI.updateChatBlock(toIpcJson({
        id: sourceBlock.id,
        metadata,
        preserveStatus: true
      }))
      replaceChatBlock(updated)
    }
  }

  async function disableChatPluginsAfterProcessingTimeout(chatId: number) {
    if (processingTimeoutChats.has(chatId)) return
    processingTimeoutChats.add(chatId)
    const chat = chats.value.find(item => item.id === chatId)
    if (!chat || chat.runtimeConfig.enabledPluginIds.length === 0) return
    showToast('插件处理超过 1 秒，已禁用当前聊天插件。', 'error')
    const updated = await window.electronAPI.updateChat(toIpcJson({
      id: chat.id,
      title: chat.title,
      runtimeConfig: {
        ...chat.runtimeConfig,
        enabledPluginIds: []
      }
    }))
    replaceChat(updated)
    processingChats.value = {
      ...processingChats.value,
      [chatId]: processingChatFromDbBlocks(updated, processableChatBlocks(sortedChatBlocksFor(chatId)))
    }
    processingToolDefinitions.value = {
      ...processingToolDefinitions.value,
      [chatId]: []
    }
  }

  async function refreshProcessingChat(chatId: number, writeBackPluginData: boolean): Promise<ProcessingChat | null> {
    if (!project.value) return null
    const chat = chats.value.find(item => item.id === chatId)
    if (!chat) return null
    const snapshot = project.value
    const blocks = processableChatBlocks(sortedChatBlocksFor(chatId))
    const token = ++processingRefreshSerial
    processingRefreshTokens.set(chatId, token)
    let currentPromise: Promise<ProcessingChat | null> | null = null
    currentPromise = (async () => {
      let timedOut = false
      const timeout = window.setTimeout(() => {
        timedOut = true
        void disableChatPluginsAfterProcessingTimeout(chatId)
      }, 1000)
      try {
        const bundle = await preparePluginChatProcessing(snapshot, chat, blocks)
        if (timedOut) return null
        processingTimeoutChats.delete(chatId)
        if (processingRefreshTokens.get(chatId) === token) {
          processingChats.value = {
            ...processingChats.value,
            [chatId]: bundle.processingChat
          }
          processingToolDefinitions.value = {
            ...processingToolDefinitions.value,
            [chatId]: bundle.toolDefinitions
          }
        }
        if (writeBackPluginData) {
          await writeProcessingPluginData(chat, bundle.processingChat)
        }
        return bundle.processingChat
      } catch (error) {
        showToast(errorText(error), 'error')
        const fallback = processingChatFromDbBlocks(chat, blocks)
        processingChats.value = {
          ...processingChats.value,
          [chatId]: fallback
        }
        processingToolDefinitions.value = {
          ...processingToolDefinitions.value,
          [chatId]: []
        }
        return fallback
      } finally {
        window.clearTimeout(timeout)
        if (currentPromise && processingRefreshPromises.get(chatId) === currentPromise) {
          processingRefreshPromises.delete(chatId)
        }
      }
    })()
    processingRefreshPromises.set(chatId, currentPromise)
    return currentPromise
  }

  async function waitForProcessingRefresh(chatId: number, promise: Promise<ProcessingChat | null>): Promise<ProcessingChat | null> {
    return Promise.race([
      promise,
      new Promise<null>(resolve => {
        window.setTimeout(() => {
          void disableChatPluginsAfterProcessingTimeout(chatId)
          resolve(null)
        }, 1000)
      })
    ])
  }

  async function processingChatForGeneration(chat: ChatSession): Promise<ProcessingChat> {
    const pending = processingRefreshPromises.get(chat.id)
    if (pending) {
      const result = await waitForProcessingRefresh(chat.id, pending)
      if (!result) throw new Error('插件处理超时，已取消生成。')
      return processingChatForDisplay(chat, sortedChatBlocksFor(chat.id))
    }

    const cached = processingChats.value[chat.id]
    if (cached) return processingChatForDisplay(chat, sortedChatBlocksFor(chat.id))

    const result = await waitForProcessingRefresh(chat.id, refreshProcessingChat(chat.id, false))
    if (!result) throw new Error('插件处理超时，已取消生成。')
    return processingChatForDisplay(chat, sortedChatBlocksFor(chat.id))
  }

  async function prepareGenerationRequest(payload: ChatGenerationRequest): Promise<ChatGenerationRequest> {
    if (!project.value) return payload
    const chat = chats.value.find(item => item.id === payload.chatId)
    if (!chat) return payload
    const processingChat = scopedProcessingChatForGeneration(
      chat,
      await processingChatForGeneration(chat),
      payload.regenerateBlockId
    )
    return {
      ...payload,
      messages: messagesFromProcessingChat(processingChat),
      toolDefinitions: processingToolDefinitions.value[chat.id] ?? []
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

  async function handlePluginDataChanged() {
    try {
      await refreshProjectSnapshot()
    } catch {
      // The processor refresh below still gives storage-only plugin changes a chance to update the cache.
    }
    const chatId = selectedChat.value?.id
    if (chatId) void refreshProcessingChat(chatId, true)
  }

  let unsubscribeGenerationEvents: (() => void) | null = null

  watch(() => ({
    chatId: selectedChat.value?.id ?? null,
    signature: selectedProcessingSignature.value
  }), (current, previous) => {
    if (current.chatId === null || !current.signature) return
    void refreshProcessingChat(current.chatId, previous?.chatId === current.chatId)
  }, { immediate: true })

  onMounted(() => {
    void loadProject()
    startPluginToolBridge(() => project.value)
    unsubscribeGenerationEvents = window.electronAPI.onChatGenerationEvent(handleGenerationEvent)
    window.addEventListener('st-forge-plugin-data-changed', handlePluginDataChanged)
    window.addEventListener('st-forge-project-snapshot-changed', handleProjectSnapshotChanged)
  })

  onBeforeUnmount(() => {
    unsubscribeGenerationEvents?.()
    window.removeEventListener('st-forge-plugin-data-changed', handlePluginDataChanged)
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
    selectedProcessingChat,
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
