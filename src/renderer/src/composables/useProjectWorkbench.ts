import { computed, inject, onMounted, provide, ref, type InjectionKey } from 'vue'
import type {
  CharacterEntry,
  ExportResult,
  ProjectConfig,
  ProjectSnapshot,
  SidebarView,
  WorldBookExportConfig,
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
  const selectedWorldEntry = ref<WorldEntry | null>(null)
  const selectedWorldBook = ref<WorldBookExportConfig | null>(null)

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

  const draggingCharacterWorldIndex = ref<number | null>(null)
  const draggingWorldBookIndex = ref<number | null>(null)
  const toasts = ref<ToastMessage[]>([])
  let toastId = 0

  const characters = computed(() => project.value?.characters ?? [])
  const worldEntries = computed(() => project.value?.worldEntries ?? [])
  const worldBooks = computed(() => project.value?.config.worldBookExports ?? [])

  const characterData = computed<Record<string, any>>(() => selectedCharacter.value?.stData?.data as Record<string, any> ?? {})
  const characterExtensions = computed<Record<string, any>>(() => characterData.value.extensions ?? {})
  const depthPrompt = computed<Record<string, any>>(() => characterExtensions.value.depth_prompt ?? {})
  const worldEntryData = computed<Record<string, any>>(() => selectedWorldEntry.value?.stData as Record<string, any> ?? {})
  const worldEntryExtensions = computed<Record<string, any>>(() => worldEntryData.value.extensions ?? {})

  const characterSelectedWorldEntries = computed(() => {
    const ids = selectedCharacter.value?.forgeData.worldEntryIds ?? []
    return ids.map(id => worldEntries.value.find(entry => entry.id === id)).filter(Boolean) as WorldEntry[]
  })

  const worldBookSelectedEntries = computed(() => {
    const ids = selectedWorldBook.value?.worldEntryIds ?? []
    return ids.map(id => worldEntries.value.find(entry => entry.id === id)).filter(Boolean) as WorldEntry[]
  })

  function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value))
  }

  function toIpcJson(value: unknown): string {
    return JSON.stringify(value)
  }

  function asRecord(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
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

  async function loadProject() {
    project.value = await window.electronAPI.getProject()
    if (project.value) {
      if (!selectedCharacter.value && characters.value.length) selectCharacter(characters.value[0])
      if (!selectedWorldEntry.value && worldEntries.value.length) selectWorldEntry(worldEntries.value[0])
      if (!selectedWorldBook.value && worldBooks.value.length) selectWorldBook(worldBooks.value[0])
    }
  }

  async function openProject() {
    try {
      const snapshot = await window.electronAPI.openProject()
      if (snapshot) {
        project.value = snapshot
        selectedCharacter.value = null
        selectedWorldEntry.value = null
        selectedWorldBook.value = null
        if (characters.value.length) selectCharacter(characters.value[0])
        if (worldEntries.value.length) selectWorldEntry(worldEntries.value[0])
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

  function selectCharacter(entry: CharacterEntry) {
    selectedCharacter.value = clone(entry)
    characterTagsText.value = (characterData.value.tags ?? []).join(', ')
    characterGreetingsText.value = (characterData.value.alternate_greetings ?? []).join('\n---\n')
    characterAdvancedJson.value = JSON.stringify(selectedCharacter.value.stData, null, 2)
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
    if (!selectedCharacter.value) return
    try {
      characterData.value.tags = characterTagsText.value.split(',').map(item => item.trim()).filter(Boolean)
      characterData.value.alternate_greetings = characterGreetingsText.value
        .split(/\n---+\n/g)
        .map(item => item.trim())
        .filter(Boolean)
      const saved = await window.electronAPI.updateCharacter(toIpcJson({
        id: selectedCharacter.value.id,
        stData: selectedCharacter.value.stData,
        forgeData: selectedCharacter.value.forgeData
      }))
      replaceCharacter(saved)
      showToast('已保存', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function saveCharacterAdvanced() {
    if (!selectedCharacter.value) return
    try {
      selectedCharacter.value.stData = JSON.parse(characterAdvancedJson.value)
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

  function isCharacterWorldSelected(id: number) {
    return selectedCharacter.value?.forgeData.worldEntryIds.includes(id) ?? false
  }

  async function toggleCharacterWorldEntry(id: number) {
    if (!selectedCharacter.value) return
    const ids = selectedCharacter.value.forgeData.worldEntryIds
    selectedCharacter.value.forgeData.worldEntryIds = ids.includes(id)
      ? ids.filter(item => item !== id)
      : [...ids, id]
    await saveCharacter()
  }

  async function moveCharacterWorldEntry(toIndex: number) {
    if (!selectedCharacter.value || draggingCharacterWorldIndex.value === null) return
    const ids = [...selectedCharacter.value.forgeData.worldEntryIds]
    const [item] = ids.splice(draggingCharacterWorldIndex.value, 1)
    ids.splice(toIndex, 0, item)
    selectedCharacter.value.forgeData.worldEntryIds = ids
    draggingCharacterWorldIndex.value = null
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
  }

  function replaceWorldEntry(entry: WorldEntry) {
    if (!project.value) return
    const index = project.value.worldEntries.findIndex(item => item.id === entry.id)
    if (index >= 0) project.value.worldEntries[index] = entry
    else project.value.worldEntries.unshift(entry)
    selectWorldEntry(entry)
  }

  async function createWorldEntry() {
    try {
      const entry = await window.electronAPI.createWorldEntry()
      replaceWorldEntry(entry)
      activeView.value = 'worldEntries'
      showToast('世界书条目已创建', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  function applyWorldEntryForm() {
    if (!selectedWorldEntry.value) return
    const data = selectedWorldEntry.value.stData
    data.keys = worldEntryKeysText.value.split(',').map(item => item.trim()).filter(Boolean)
    data.secondary_keys = worldEntrySecondaryKeysText.value.split(',').map(item => item.trim()).filter(Boolean)
    data.position = Number(worldEntryPosition.value) === 1 ? 'after_char' : 'before_char'
    data.extensions = {
      ...data.extensions,
      position: Number(worldEntryPosition.value),
      role: Number(worldEntryRole.value),
      depth: Number(worldEntryDepth.value),
      probability: Number(worldEntryProbability.value)
    }
  }

  async function saveWorldEntry() {
    if (!selectedWorldEntry.value) return
    try {
      applyWorldEntryForm()
      const saved = await window.electronAPI.updateWorldEntry(toIpcJson({
        id: selectedWorldEntry.value.id,
        stData: selectedWorldEntry.value.stData,
        forgeData: selectedWorldEntry.value.forgeData
      }))
      replaceWorldEntry(saved)
      showToast('已保存', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function saveWorldEntryAdvanced() {
    if (!selectedWorldEntry.value) return
    try {
      selectedWorldEntry.value.stData = JSON.parse(worldEntryAdvancedJson.value)
      await saveWorldEntry()
    } catch {
      showToast('高级 JSON 格式不正确，未保存', 'error')
    }
  }

  async function deleteSelectedWorldEntry() {
    if (!selectedWorldEntry.value || !window.confirm('删除当前世界书条目？相关配置中的引用会被移除。')) return
    try {
      project.value = await window.electronAPI.deleteWorldEntry(selectedWorldEntry.value.id)
      selectedWorldEntry.value = worldEntries.value[0] ? clone(worldEntries.value[0]) : null
      if (selectedWorldEntry.value) selectWorldEntry(selectedWorldEntry.value)
      if (selectedCharacter.value) {
        const fresh = characters.value.find(item => item.id === selectedCharacter.value?.id)
        if (fresh) selectCharacter(fresh)
      }
      if (selectedWorldBook.value) {
        const fresh = worldBooks.value.find(item => item.id === selectedWorldBook.value?.id)
        if (fresh) selectWorldBook(fresh)
      }
      showToast('世界书条目已删除', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  function selectWorldBook(config: WorldBookExportConfig) {
    selectedWorldBook.value = clone(config)
  }

  function replaceProjectConfig(config: ProjectConfig) {
    if (!project.value) return
    project.value.config = config
    if (selectedWorldBook.value) {
      const fresh = config.worldBookExports.find(item => item.id === selectedWorldBook.value?.id)
      selectedWorldBook.value = fresh ? clone(fresh) : null
    }
  }

  async function createWorldBook() {
    try {
      const config = await window.electronAPI.createWorldBookExport()
      replaceProjectConfig(config)
      if (config.worldBookExports[0]) selectWorldBook(config.worldBookExports[0])
      activeView.value = 'worldBooks'
      showToast('世界书配置已创建', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function saveWorldBook() {
    if (!selectedWorldBook.value) return
    try {
      const config = await window.electronAPI.updateWorldBookExport(toIpcJson(selectedWorldBook.value))
      replaceProjectConfig(config)
      showToast('已保存', 'success')
    } catch (error) {
      showToast(errorText(error), 'error')
    }
  }

  async function deleteSelectedWorldBook() {
    if (!selectedWorldBook.value || !window.confirm('删除当前世界书导出配置？')) return
    try {
      const config = await window.electronAPI.deleteWorldBookExport(selectedWorldBook.value.id)
      replaceProjectConfig(config)
      if (worldBooks.value[0]) selectWorldBook(worldBooks.value[0])
      showToast('世界书配置已删除', 'success')
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

  function isWorldBookEntrySelected(id: number) {
    return selectedWorldBook.value?.worldEntryIds.includes(id) ?? false
  }

  async function toggleWorldBookEntry(id: number) {
    if (!selectedWorldBook.value) return
    const ids = selectedWorldBook.value.worldEntryIds
    selectedWorldBook.value.worldEntryIds = ids.includes(id)
      ? ids.filter(item => item !== id)
      : [...ids, id]
    await saveWorldBook()
  }

  async function moveWorldBookEntry(toIndex: number) {
    if (!selectedWorldBook.value || draggingWorldBookIndex.value === null) return
    const ids = [...selectedWorldBook.value.worldEntryIds]
    const [item] = ids.splice(draggingWorldBookIndex.value, 1)
    ids.splice(toIndex, 0, item)
    selectedWorldBook.value.worldEntryIds = ids
    draggingWorldBookIndex.value = null
    await saveWorldBook()
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
    characterSelectedWorldEntries,
    characterTagsText,
    characters,
    createCharacter,
    createWorldBook,
    createWorldEntry,
    deleteSelectedCharacter,
    deleteSelectedWorldBook,
    deleteSelectedWorldEntry,
    depthPrompt,
    draggingCharacterWorldIndex,
    draggingWorldBookIndex,
    entrySummary,
    entryTitle,
    exportSelectedCharacter,
    exportSelectedWorldBook,
    formatDate,
    isCharacterWorldSelected,
    isWorldBookEntrySelected,
    moveCharacterWorldEntry,
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
    selectedWorldEntry,
    selectWorldBook,
    selectWorldEntry,
    showToast,
    toasts,
    toggleCharacterWorldEntry,
    toggleWorldBookEntry,
    worldBookSelectedEntries,
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
