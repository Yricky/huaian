import { computed, inject, onMounted, provide, ref, type InjectionKey } from 'vue'
import type {
  CharacterEntry,
  ExportResult,
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

  async function loadProject() {
    project.value = await window.electronAPI.getProject()
    if (project.value) {
      if (!selectedCharacter.value && characters.value.length) selectCharacter(characters.value[0])
      if (!selectedWorldBook.value && worldBooks.value.length) selectWorldBook(worldBooks.value[0])
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
        if (characters.value.length) selectCharacter(characters.value[0])
        if (worldBooks.value.length) selectWorldBook(worldBooks.value[0])
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

  async function moveWorldBookEntry(toIndex: number) {
    if (!selectedWorldBook.value || draggingWorldBookIndex.value === null) return
    const ids = selectedWorldBookEntries.value.map(entry => entry.id)
    const [item] = ids.splice(draggingWorldBookIndex.value, 1)
    if (item === undefined) {
      draggingWorldBookIndex.value = null
      return
    }
    ids.splice(toIndex, 0, item)
    draggingWorldBookIndex.value = null

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

  onMounted(loadProject)

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
    clearCharacterWorldBook,
    createCharacter,
    createWorldBook,
    createWorldEntry,
    deleteSelectedCharacter,
    deleteSelectedWorldBook,
    deleteSelectedWorldEntry,
    depthPrompt,
    draggingWorldBookIndex,
    entrySummary,
    entryTitle,
    exportSelectedCharacter,
    exportSelectedWorldBook,
    formatDate,
    isCharacterWorldBookSelected,
    isWorldEntryExpanded,
    moveWorldBookEntry,
    openProject,
    project,
    saveCharacter,
    saveCharacterAdvanced,
    saveWorldBook,
    saveWorldEntry,
    saveWorldEntryAdvanced,
    selectCharacter,
    selectedCharacter,
    selectedWorldBook,
    selectedWorldBookEntries,
    selectedWorldEntry,
    selectCharacterWorldBook,
    selectWorldBook,
    selectWorldEntry,
    showToast,
    startWorldEntryDrag,
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
