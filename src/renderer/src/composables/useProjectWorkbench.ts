import { computed, inject, onBeforeUnmount, onMounted, provide, ref, type InjectionKey } from 'vue'
import type {
  ChatBlock,
  ChatBlockCreatePayload,
  ChatGenerationEvent,
  ChatGenerationRequest,
  ChatSession,
  CharacterEntry,
  ExportResult,
  LlmInstance,
  LlmInstanceCreatePayload,
  LlmProvider,
  LlmProviderCreatePayload,
  ProjectSnapshot,
  SidebarView,
  WorldBook,
  WorldEntry
} from '@/shared/types'

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastMessage {
  id: number
  kind: ToastKind
  text: string
}

export function createProjectWorkbench() {
  const project = ref<ProjectSnapshot | null>(null)
  const activeView = ref<SidebarView>('characters')
  const selectedCharacter = ref<CharacterEntry | null>(null)
  const selectedWorldBook = ref<WorldBook | null>(null)
  const selectedWorldEntry = ref<WorldEntry | null>(null)
  const selectedLlmProvider = ref<LlmProvider | null>(null)
  const selectedLlmInstance = ref<LlmInstance | null>(null)
  const selectedChat = ref<ChatSession | null>(null)
  const generatingChatIds = ref<number[]>([])

  const characterTagsText = ref('')
  const characterGreetingsText = ref('')
  const characterAdvancedJson = ref('')
  const worldEntryKeysText = ref('')
  const worldEntrySecondaryKeysText = ref('')
  const worldEntryPosition = ref('0')
  const worldEntryRole = ref('0')
  const worldEntryDepth = ref(4)
  const worldEntryProbability = ref(100)
  const worldEntryAdvancedJson = ref('')

  const draggingWorldBookIndex = ref<number | null>(null)
  const toasts = ref<ToastMessage[]>([])
  let toastId = 0
  let characterSaveSnapshot = ''
  let worldEntrySaveSnapshot = ''
  let worldBookSaveSnapshot = ''

  const characters = computed(() => project.value?.characters ?? [])
  const worldBooks = computed(() => project.value?.worldBooks ?? [])
  const worldEntries = computed(() => project.value?.worldEntries ?? [])
  const llmProviders = computed(() => project.value?.llmProviders ?? [])
  const llmInstances = computed(() => project.value?.llmInstances ?? [])
  const chats = computed(() => project.value?.chats ?? [])
  const chatBlocks = computed(() => project.value?.chatBlocks ?? [])

  const characterData = computed<Record<string, any>>(() => selectedCharacter.value?.stData?.data as Record<string, any> ?? {})
  const characterExtensions = computed<Record<string, any>>(() => characterData.value.extensions ?? {})
  const depthPrompt = computed<Record<string, any>>(() => characterExtensions.value.depth_prompt ?? {})
  const worldEntryData = computed<Record<string, any>>(() => selectedWorldEntry.value?.stData as Record<string, any> ?? {})
  const worldEntryExtensions = computed<Record<string, any>>(() => worldEntryData.value.extensions ?? {})

  const selectedWorldBookEntries = computed(() => {
    const worldBookId = selectedWorldBook.value?.id
    if (!worldBookId) return []
    return worldEntries.value
      .filter(entry => entry.worldBookId === worldBookId)
      .sort((a, b) => {
        const orderDelta = a.stData.insertion_order - b.stData.insertion_order
        if (orderDelta !== 0) return orderDelta
        return a.id - b.id
      })
  })

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
    const id = selectedChat.value?.llmInstanceId
    return id === null || id === undefined ? null : llmInstances.value.find(instance => instance.id === id) ?? null
  })

  const selectedProviderForInstance = computed(() => {
    const id = selectedLlmInstance.value?.providerId
    return id === null || id === undefined ? null : llmProviders.value.find(provider => provider.id === id) ?? null
  })

  const isSelectedChatGenerating = computed(() => (
    Boolean(selectedChat.value && generatingChatIds.value.includes(selectedChat.value.id))
  ))

  const characterSelectedWorldBook = computed(() => {
    const worldBookId = selectedCharacter.value?.forgeData.worldBookId
    return worldBookId === null || worldBookId === undefined
      ? null
      : worldBooks.value.find(book => book.id === worldBookId) ?? null
  })

  function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value))
  }

  function toIpcJson(value: unknown): string {
    return JSON.stringify(value)
  }

  function snapshot(value: unknown): string {
    return JSON.stringify(value)
  }

  function asRecord(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
  }

  function splitCommaList(value: string): string[] {
    return value.split(',').map(item => item.trim()).filter(Boolean)
  }

  function splitGreetings(value: string): string[] {
    return value
      .split(/\n---+\n/g)
      .map(item => item.trim())
      .filter(Boolean)
  }

  function characterSavePayload() {
    if (!selectedCharacter.value) return null
    const payload = clone({
      id: selectedCharacter.value.id,
      stData: selectedCharacter.value.stData,
      forgeData: selectedCharacter.value.forgeData
    })
    const stData = asRecord(payload.stData)
    const data = asRecord(stData.data)
    stData.data = data
    data.tags = splitCommaList(characterTagsText.value)
    data.alternate_greetings = splitGreetings(characterGreetingsText.value)
    return payload
  }

  function rememberCharacterSnapshot() {
    const payload = characterSavePayload()
    characterSaveSnapshot = payload ? snapshot(payload) : ''
  }

  function worldEntrySavePayload() {
    if (!selectedWorldEntry.value) return null
    const payload = clone({
      id: selectedWorldEntry.value.id,
      worldBookId: selectedWorldEntry.value.worldBookId,
      stData: selectedWorldEntry.value.stData,
      forgeData: selectedWorldEntry.value.forgeData
    })
    const data = payload.stData
    data.keys = splitCommaList(worldEntryKeysText.value)
    data.secondary_keys = splitCommaList(worldEntrySecondaryKeysText.value)
    data.position = Number(worldEntryPosition.value) === 1 ? 'after_char' : 'before_char'
    data.extensions = {
      ...asRecord(data.extensions),
      position: Number(worldEntryPosition.value),
      role: Number(worldEntryRole.value),
      depth: Number(worldEntryDepth.value),
      probability: Number(worldEntryProbability.value)
    }
    return payload
  }

  function rememberWorldEntrySnapshot() {
    const payload = worldEntrySavePayload()
    worldEntrySaveSnapshot = payload ? snapshot(payload) : ''
  }

  function worldBookSavePayload() {
    return selectedWorldBook.value
      ? clone({ id: selectedWorldBook.value.id, name: selectedWorldBook.value.name })
      : null
  }

  function rememberWorldBookSnapshot() {
    const payload = worldBookSavePayload()
    worldBookSaveSnapshot = payload ? snapshot(payload) : ''
  }

  function characterListData(entry: CharacterEntry): Record<string, any> {
    return asRecord(entry.stData.data)
  }

  function characterListName(entry: CharacterEntry): string {
    const value = characterListData(entry).name
    return typeof value === 'string' && value ? value : 'Untitled Character'
  }

  function characterListNotes(entry: CharacterEntry): string {
    const value = characterListData(entry).creator_notes
    return typeof value === 'string' && value ? value : '无作者备注'
  }

  function characterListVersion(entry: CharacterEntry): string {
    const value = characterListData(entry).character_version
    return typeof value === 'string' && value ? value : '未设置版本'
  }

  function characterListTags(entry: CharacterEntry): string[] {
    const value = characterListData(entry).tags
    return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string' && Boolean(tag)) : []
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

  function refreshSelectedCharacter() {
    if (!selectedCharacter.value) return
    const fresh = characters.value.find(item => item.id === selectedCharacter.value?.id)
    selectedCharacter.value = fresh ? clone(fresh) : null
    if (selectedCharacter.value) selectCharacter(selectedCharacter.value)
  }

  function refreshSelectedWorldBook() {
    if (!selectedWorldBook.value) return
    const fresh = worldBooks.value.find(item => item.id === selectedWorldBook.value?.id)
    selectedWorldBook.value = fresh ? clone(fresh) : null
    if (selectedWorldBook.value) rememberWorldBookSnapshot()
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

  async function loadProject() {
    project.value = await window.electronAPI.getProject()
    if (project.value) {
      if (!selectedCharacter.value && characters.value.length) selectCharacter(characters.value[0])
      if (!selectedWorldBook.value && worldBooks.value.length) selectWorldBook(worldBooks.value[0])
      if (!selectedLlmProvider.value && llmProviders.value.length) selectedLlmProvider.value = clone(llmProviders.value[0])
      if (!selectedLlmInstance.value && llmInstances.value.length) selectedLlmInstance.value = clone(llmInstances.value[0])
      if (!selectedChat.value && chats.value.length) selectedChat.value = clone(chats.value[0])
    }
  }

  async function openProject() {
    try {
      const snapshot = await window.electronAPI.openProject()
      if (snapshot) {
        project.value = snapshot
        selectedCharacter.value = null
        selectedWorldBook.value = null
        selectedWorldEntry.value = null
        selectedLlmProvider.value = null
        selectedLlmInstance.value = null
        selectedChat.value = null
        if (characters.value.length) selectCharacter(characters.value[0])
        if (worldBooks.value.length) selectWorldBook(worldBooks.value[0])
        if (llmProviders.value.length) selectedLlmProvider.value = clone(llmProviders.value[0])
        if (llmInstances.value.length) selectedLlmInstance.value = clone(llmInstances.value[0])
        if (chats.value.length) selectedChat.value = clone(chats.value[0])
        showToast('项目已打开', 'success')
      }
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  function formatDate(value: string) {
    if (!value) return ''
    return new Date(value).toLocaleString()
  }

  function entryTitle(entry: WorldEntry) {
    const data = entry.stData
    return data.comment || data.keys?.join(', ') || data.content.split(/\r?\n/).filter(Boolean).slice(0, 1).join('') || 'Untitled Entry'
  }

  function entrySummary(entry: WorldEntry) {
    const keys = entry.stData.keys?.join(', ')
    if (keys) return keys
    return entry.stData.content.split(/\r?\n/).filter(Boolean).slice(0, 2).join(' ')
  }

  function worldBookEntryCount(book: WorldBook) {
    return worldEntries.value.filter(entry => entry.worldBookId === book.id).length
  }

  function selectCharacter(entry: CharacterEntry) {
    selectedCharacter.value = clone(entry)
    characterTagsText.value = (characterData.value.tags ?? []).join(', ')
    characterGreetingsText.value = (characterData.value.alternate_greetings ?? []).join('\n---\n')
    characterAdvancedJson.value = JSON.stringify(selectedCharacter.value.stData, null, 2)
    rememberCharacterSnapshot()
  }

  function replaceCharacter(entry: CharacterEntry) {
    if (!project.value) return
    const index = project.value.characters.findIndex(item => item.id === entry.id)
    if (index >= 0) project.value.characters[index] = entry
    else project.value.characters.unshift(entry)
    selectCharacter(entry)
  }

  async function createCharacter() {
    try {
      const entry = await window.electronAPI.createCharacter()
      replaceCharacter(entry)
      activeView.value = 'characters'
      showToast('角色卡已创建', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function saveCharacter() {
    const payload = characterSavePayload()
    if (!selectedCharacter.value || !payload) return
    const nextSnapshot = snapshot(payload)
    if (nextSnapshot === characterSaveSnapshot) return
    try {
      const saved = await window.electronAPI.updateCharacter(toIpcJson(payload))
      replaceCharacter(saved)
      showToast('已保存', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function saveCharacterAdvanced() {
    if (!selectedCharacter.value) return
    try {
      const parsed = JSON.parse(characterAdvancedJson.value)
      if (snapshot(parsed) === snapshot(selectedCharacter.value.stData)) return
      selectedCharacter.value.stData = parsed
      characterTagsText.value = (characterData.value.tags ?? []).join(', ')
      characterGreetingsText.value = (characterData.value.alternate_greetings ?? []).join('\n---\n')
      await saveCharacter()
    } catch {
      showToast('高级 JSON 格式不正确，未保存', 'error')
    }
  }

  async function deleteSelectedCharacter() {
    if (!selectedCharacter.value || !window.confirm('删除当前角色卡？')) return
    try {
      project.value = await window.electronAPI.deleteCharacter(selectedCharacter.value.id)
      selectedCharacter.value = characters.value[0] ? clone(characters.value[0]) : null
      if (selectedCharacter.value) selectCharacter(selectedCharacter.value)
      showToast('角色卡已删除', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function exportSelectedCharacter() {
    if (!selectedCharacter.value) return
    try {
      const result = await window.electronAPI.exportCharacter(selectedCharacter.value.id)
      showExportToast(result)
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  function isCharacterWorldBookSelected(id: number) {
    return selectedCharacter.value?.forgeData.worldBookId === id
  }

  async function selectCharacterWorldBook(id: number) {
    if (!selectedCharacter.value) return
    selectedCharacter.value.forgeData.worldBookId = id
    await saveCharacter()
  }

  async function clearCharacterWorldBook() {
    if (!selectedCharacter.value) return
    selectedCharacter.value.forgeData.worldBookId = null
    await saveCharacter()
  }

  function selectWorldEntry(entry: WorldEntry) {
    selectedWorldEntry.value = clone(entry)
    worldEntryKeysText.value = selectedWorldEntry.value.stData.keys.join(', ')
    worldEntrySecondaryKeysText.value = selectedWorldEntry.value.stData.secondary_keys?.join(', ') ?? ''
    worldEntryPosition.value = String(selectedWorldEntry.value.stData.extensions.position ?? 0)
    worldEntryRole.value = String(selectedWorldEntry.value.stData.extensions.role ?? 0)
    worldEntryDepth.value = Number(selectedWorldEntry.value.stData.extensions.depth ?? 4)
    worldEntryProbability.value = Number(selectedWorldEntry.value.stData.extensions.probability ?? 100)
    worldEntryAdvancedJson.value = JSON.stringify(selectedWorldEntry.value.stData, null, 2)
    rememberWorldEntrySnapshot()
  }

  function toggleWorldEntry(entry: WorldEntry) {
    if (selectedWorldEntry.value?.id === entry.id) {
      selectedWorldEntry.value = null
      worldEntrySaveSnapshot = ''
    } else {
      selectWorldEntry(entry)
    }
  }

  function replaceWorldEntry(entry: WorldEntry) {
    if (!project.value) return
    const index = project.value.worldEntries.findIndex(item => item.id === entry.id)
    if (index >= 0) project.value.worldEntries[index] = entry
    else project.value.worldEntries.push(entry)
    selectWorldEntry(entry)
  }

  async function createWorldEntry() {
    if (!selectedWorldBook.value) {
      showToast('请先选择或创建世界书', 'error')
      return
    }
    try {
      const entry = await window.electronAPI.createWorldEntry(selectedWorldBook.value.id)
      replaceWorldEntry(entry)
      activeView.value = 'worldBooks'
      showToast('世界书条目已创建', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function saveWorldEntry() {
    const payload = worldEntrySavePayload()
    if (!selectedWorldEntry.value || !payload) return
    const nextSnapshot = snapshot(payload)
    if (nextSnapshot === worldEntrySaveSnapshot) return
    try {
      const saved = await window.electronAPI.updateWorldEntry(toIpcJson(payload))
      replaceWorldEntry(saved)
      showToast('已保存', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function saveWorldEntryAdvanced() {
    if (!selectedWorldEntry.value) return
    try {
      const parsed = JSON.parse(worldEntryAdvancedJson.value)
      if (snapshot(parsed) === snapshot(selectedWorldEntry.value.stData)) return
      selectedWorldEntry.value.stData = parsed
      worldEntryKeysText.value = selectedWorldEntry.value.stData.keys.join(', ')
      worldEntrySecondaryKeysText.value = selectedWorldEntry.value.stData.secondary_keys?.join(', ') ?? ''
      worldEntryPosition.value = String(selectedWorldEntry.value.stData.extensions.position ?? 0)
      worldEntryRole.value = String(selectedWorldEntry.value.stData.extensions.role ?? 0)
      worldEntryDepth.value = Number(selectedWorldEntry.value.stData.extensions.depth ?? 4)
      worldEntryProbability.value = Number(selectedWorldEntry.value.stData.extensions.probability ?? 100)
      await saveWorldEntry()
    } catch {
      showToast('高级 JSON 格式不正确，未保存', 'error')
    }
  }

  async function deleteSelectedWorldEntry() {
    if (!selectedWorldEntry.value || !window.confirm('删除当前世界书条目？')) return
    const worldBookId = selectedWorldEntry.value.worldBookId
    try {
      project.value = await window.electronAPI.deleteWorldEntry(selectedWorldEntry.value.id)
      selectedWorldEntry.value = null
      const fresh = worldBooks.value.find(item => item.id === worldBookId)
      if (fresh) selectWorldBook(fresh)
      showToast('世界书条目已删除', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  function selectWorldBook(book: WorldBook) {
    selectedWorldBook.value = clone(book)
    selectedWorldEntry.value = null
    rememberWorldBookSnapshot()
  }

  function replaceWorldBook(book: WorldBook) {
    if (!project.value) return
    const index = project.value.worldBooks.findIndex(item => item.id === book.id)
    if (index >= 0) project.value.worldBooks[index] = book
    else project.value.worldBooks.unshift(book)
    selectedWorldBook.value = clone(book)
    rememberWorldBookSnapshot()
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

  async function refreshProjectSnapshot() {
    project.value = await window.electronAPI.getProject()
    if (!project.value) return
    refreshSelectedLlmProvider()
    refreshSelectedLlmInstance()
    refreshSelectedChat()
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

  async function createChat() {
    try {
      await window.electronAPI.createChat()
      await refreshProjectSnapshot()
      selectedChat.value = chats.value[0] ? clone(chats.value[0]) : null
      activeView.value = 'chat'
      showToast('聊天已创建', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function saveChat(chat: ChatSession) {
    try {
      replaceChat(await window.electronAPI.updateChat(toIpcJson({
        id: chat.id,
        title: chat.title,
        llmInstanceId: chat.llmInstanceId
      })))
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function deleteSelectedChat() {
    if (!selectedChat.value || !window.confirm('删除当前聊天？其中的所有块会一并删除。')) return
    try {
      project.value = await window.electronAPI.deleteChat(selectedChat.value.id)
      selectedChat.value = chats.value[0] ? clone(chats.value[0]) : null
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
        title: block.title,
        summary: block.summary,
        contentParts: block.contentParts,
        metadata: block.metadata,
        targetRole: block.targetRole
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

  async function startChatGeneration(payload: ChatGenerationRequest) {
    try {
      const result = await window.electronAPI.startChatGeneration(toIpcJson(payload))
      replaceChatBlock(result.block)
      if (!generatingChatIds.value.includes(payload.chatId)) {
        generatingChatIds.value = [...generatingChatIds.value, payload.chatId]
      }
    } catch (error) {
      showToast(errorText(error), 'error')
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
        block.contentParts = [{ type: 'text', text: event.content }]
        block.status = 'generating'
      }
      return
    }

    replaceChatBlock(event.block)
    generatingChatIds.value = generatingChatIds.value.filter(id => id !== event.chatId)
    refreshSelectedChat()
    if (event.type === 'error') showToast(event.error, 'error')
  }

  async function createWorldBook() {
    try {
      const book = await window.electronAPI.createWorldBook()
      replaceWorldBook(book)
      activeView.value = 'worldBooks'
      showToast('世界书已创建', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function saveWorldBook() {
    const payload = worldBookSavePayload()
    if (!selectedWorldBook.value || !payload) return
    const nextSnapshot = snapshot(payload)
    if (nextSnapshot === worldBookSaveSnapshot) return
    try {
      const book = await window.electronAPI.updateWorldBook(toIpcJson(payload))
      replaceWorldBook(book)
      showToast('已保存', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function deleteSelectedWorldBook() {
    if (!selectedWorldBook.value || !window.confirm('删除当前世界书？其中的条目会一同删除，角色中的关联会自动移除。')) return
    try {
      project.value = await window.electronAPI.deleteWorldBook(selectedWorldBook.value.id)
      selectedWorldBook.value = null
      selectedWorldEntry.value = null
      if (worldBooks.value[0]) selectWorldBook(worldBooks.value[0])
      refreshSelectedCharacter()
      showToast('世界书已删除', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function exportSelectedWorldBook() {
    if (!selectedWorldBook.value) return
    try {
      const result = await window.electronAPI.exportWorldBook(selectedWorldBook.value.id)
      showExportToast(result)
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  function showExportToast(result: ExportResult) {
    showToast(`已导出到 ${result.historyPath}`, 'success')
  }

  function isWorldEntryExpanded(id: number) {
    return selectedWorldEntry.value?.id === id
  }

  function startWorldEntryDrag(index: number) {
    draggingWorldBookIndex.value = index
    selectedWorldEntry.value = null
    worldEntrySaveSnapshot = ''
  }

  async function moveWorldBookEntry(fromIndex: number, toIndex: number) {
    if (!selectedWorldBook.value) return
    const ids = selectedWorldBookEntries.value.map(entry => entry.id)
    const [item] = ids.splice(fromIndex, 1)
    if (item === undefined) {
      return
    }
    ids.splice(toIndex, 0, item)

    try {
      project.value = await window.electronAPI.reorderWorldEntries(toIpcJson({
        worldBookId: selectedWorldBook.value.id,
        worldEntryIds: ids
      }))
      refreshSelectedWorldBook()
      showToast('条目顺序已更新', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  let unsubscribeGenerationEvents: (() => void) | null = null

  onMounted(() => {
    void loadProject()
    unsubscribeGenerationEvents = window.electronAPI.onChatGenerationEvent(handleGenerationEvent)
  })

  onBeforeUnmount(() => {
    unsubscribeGenerationEvents?.()
  })

  return {
    activeView,
    characterAdvancedJson,
    characterData,
    characterExtensions,
    characterGreetingsText,
    characterListName,
    characterListNotes,
    characterListTags,
    characterListVersion,
    characterSelectedWorldBook,
    characterTagsText,
    characters,
    chatBlocks,
    chats,
    clearCharacterWorldBook,
    clearSelectedLlmProviderModelsCache,
    createChat,
    createChatBlock,
    createCharacter,
    createLlmInstance,
    createLlmProvider,
    createWorldBook,
    createWorldEntry,
    deleteChatBlock,
    deleteSelectedChat,
    deleteSelectedCharacter,
    deleteSelectedLlmInstance,
    deleteSelectedLlmProvider,
    deleteSelectedWorldBook,
    deleteSelectedWorldEntry,
    fetchSelectedLlmProviderModels,
    depthPrompt,
    draggingWorldBookIndex,
    entrySummary,
    entryTitle,
    exportSelectedCharacter,
    exportSelectedWorldBook,
    formatDate,
    generatingChatIds,
    isCharacterWorldBookSelected,
    isSelectedChatGenerating,
    isWorldEntryExpanded,
    llmInstances,
    llmProviders,
    moveWorldBookEntry,
    openProject,
    project,
    providerSnapshot,
    restoreProviderFromSelectedInstance,
    saveCharacter,
    saveCharacterAdvanced,
    saveChat,
    saveChatBlock,
    saveWorldBook,
    saveLlmInstance,
    saveLlmProvider,
    saveWorldEntry,
    saveWorldEntryAdvanced,
    selectChat,
    selectCharacter,
    selectLlmInstance,
    selectLlmProvider,
    selectedCharacter,
    selectedChat,
    selectedChatBlocks,
    selectedChatLlmInstance,
    selectedLlmInstance,
    selectedLlmProvider,
    selectedProviderForInstance,
    selectedWorldBook,
    selectedWorldBookEntries,
    selectedWorldEntry,
    selectCharacterWorldBook,
    selectWorldBook,
    selectWorldEntry,
    showToast,
    startChatGeneration,
    startWorldEntryDrag,
    stopChatGeneration,
    toggleWorldEntry,
    toasts,
    worldBookEntryCount,
    worldBooks,
    worldEntries,
    worldEntryAdvancedJson,
    worldEntryData,
    worldEntryDepth,
    worldEntryExtensions,
    worldEntryKeysText,
    worldEntryPosition,
    worldEntryProbability,
    worldEntryRole,
    worldEntrySecondaryKeysText
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
