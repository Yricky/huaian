import type { ChatRuntimeConfig, ChatSession, JsonRecord, PluginStorageApi } from '@st-forge/plugin-api'
import { asRecord, asString, cloneJson } from '@st-forge/plugin-api'
import type { CharacterEntry, LoreBook, PluginFileRecord, WorldEntry } from './types'

export type SillyTavernRuntimeConfig = ChatRuntimeConfig & {
  characterId: number | null
  loreBookIds: number[]
  characterRegexScriptsEnabled: boolean
  promptTemplateVariables: JsonRecord
}

export function characterCardData(card: JsonRecord): JsonRecord {
  const v2Data = asRecord(card.data)
  return Object.keys(v2Data).length ? v2Data : card
}

export function characterBookFromCard(card: JsonRecord): JsonRecord | null {
  const v2Book = asRecord(asRecord(card.data).character_book)
  if (Array.isArray(v2Book.entries)) return v2Book
  const v1Book = asRecord(card.character_book)
  if (Array.isArray(v1Book.entries)) return v1Book
  return null
}

function worldBookEntries(book: JsonRecord): unknown[] {
  if (Array.isArray(book.entries)) return book.entries
  return Object.values(asRecord(book.entries))
}

export function normalizeCharacter(record: PluginFileRecord, id: number): CharacterEntry {
  const data = { ...characterCardData(record.data) }
  data.name = asString(data.name ?? record.data.name, record.fileName.replace(/\.json$/i, ''))
  data.extensions = {
    ...asRecord(data.extensions),
    depth_prompt: {
      prompt: asString(asRecord(asRecord(data.extensions).depth_prompt).prompt),
      depth: Number(asRecord(asRecord(data.extensions).depth_prompt).depth ?? 4),
      role: asString(asRecord(asRecord(data.extensions).depth_prompt).role, 'system')
    }
  }
  return {
    id,
    createdAt: '',
    updatedAt: '',
    assetPath: null,
    stData: { ...record.data, data },
    forgeData: { loreBookId: null, exportFileName: record.fileName, characterBookName: '' }
  }
}

export function normalizeWorldEntry(value: unknown, id: number, loreBookId: number): WorldEntry {
  const record = asRecord(value)
  const extensions = asRecord(record.extensions)
  const position = Number(extensions.position ?? (record.position === 'after_char' ? 1 : 0))
  return {
    id,
    loreBookId,
    createdAt: '',
    updatedAt: '',
    stData: {
      id,
      keys: Array.isArray(record.keys) ? record.keys.map(String) : Array.isArray(record.key) ? record.key.map(String) : [],
      secondary_keys: Array.isArray(record.secondary_keys) ? record.secondary_keys.map(String) : [],
      comment: asString(record.comment),
      content: asString(record.content),
      constant: record.constant === true,
      selective: record.selective === true,
      insertion_order: Number(record.insertion_order ?? record.order ?? 100),
      enabled: record.enabled !== false && record.disable !== true,
      position: position === 1 ? 'after_char' : 'before_char',
      case_sensitive: record.case_sensitive === undefined ? undefined : record.case_sensitive === true,
      extensions: {
        ...extensions,
        position,
        depth: Number(extensions.depth ?? 4),
        role: extensions.role ?? 0,
        probability: Number(extensions.probability ?? 100),
        useProbability: extensions.useProbability !== false,
        selectiveLogic: Number(extensions.selectiveLogic ?? 0)
      }
    },
    forgeData: {}
  }
}

export async function loadJsonRecords(storage: PluginStorageApi, directory: string): Promise<PluginFileRecord[]> {
  const files = await storage.list(directory)
  const jsonFiles = files.filter(file => !file.isDirectory && file.name.endsWith('.json'))
  const records = await Promise.all(jsonFiles.map(async file => {
    try {
      return {
        fileName: file.name,
        data: asRecord(JSON.parse(await storage.readText(file.path)))
      }
    } catch {
      return null
    }
  }))
  return records.filter((record): record is PluginFileRecord => record !== null)
}

export async function loadSillyTavernCompatData(storage: PluginStorageApi, chat: ChatSession) {
  const [characterRecords, worldBookRecords] = await Promise.all([
    loadJsonRecords(storage, 'characters'),
    loadJsonRecords(storage, 'worldbooks')
  ])
  const config = asRecord(asRecord(chat.runtimeConfig.pluginData).silly_tavern_compat)
  const characterFile = asString(config.characterFile)
  const worldBookFiles = Array.isArray(config.worldBookFiles) ? config.worldBookFiles.map(String) : []
  const characters = characterRecords.map((record, index) => normalizeCharacter(record, index + 1))
  const selectedCharacterIndex = characterRecords.findIndex(record => record.fileName === characterFile)
  const characterId = selectedCharacterIndex >= 0 ? selectedCharacterIndex + 1 : characters[0]?.id ?? null
  const selectedCharacterRecord = characterId === null ? null : characterRecords[characterId - 1] ?? null
  const embeddedBook = selectedCharacterRecord ? characterBookFromCard(selectedCharacterRecord.data) : null
  const embeddedBookId = embeddedBook ? 1 : null
  const externalBookIdOffset = embeddedBook ? 2 : 1
  if (embeddedBookId !== null && characterId !== null && characters[characterId - 1]) {
    const selectedCharacter = characters[characterId - 1]
    characters[characterId - 1] = {
      ...selectedCharacter,
      forgeData: {
        ...selectedCharacter.forgeData,
        loreBookId: embeddedBookId,
        characterBookName: asString(embeddedBook.name, `${asString(characterCardData(selectedCharacterRecord?.data ?? {}).name, '角色卡')} 内置世界书`)
      }
    }
  }

  const embeddedLoreBooks: LoreBook[] = embeddedBook && embeddedBookId !== null ? [{
    id: embeddedBookId,
    name: asString(embeddedBook.name, characters[characterId === null ? -1 : characterId - 1]?.forgeData.characterBookName || '角色卡内置世界书'),
    createdAt: '',
    updatedAt: ''
  }] : []
  const externalLoreBooks: LoreBook[] = worldBookRecords.map((record, index) => ({
    id: index + externalBookIdOffset,
    name: asString(record.data.name, record.fileName.replace(/\.json$/i, '')),
    createdAt: '',
    updatedAt: ''
  }))
  const loreBooks = [...embeddedLoreBooks, ...externalLoreBooks]
  const embeddedWorldEntries = embeddedBook && embeddedBookId !== null
    ? worldBookEntries(embeddedBook).map((entry, index) => normalizeWorldEntry(entry, index + 1 + embeddedBookId * 10000, embeddedBookId))
    : []
  const externalWorldEntries = worldBookRecords.flatMap((record, bookIndex) => {
    const loreBookId = bookIndex + externalBookIdOffset
    const entries = worldBookEntries(record.data)
    return entries.map((entry, index) => normalizeWorldEntry(entry, index + 1 + loreBookId * 10000, loreBookId))
  })
  const worldEntries = [...embeddedWorldEntries, ...externalWorldEntries]
  const selectedWorldBookIds = worldBookFiles
    .map(fileName => {
      const index = worldBookRecords.findIndex(record => record.fileName === fileName)
      return index >= 0 ? index + externalBookIdOffset : 0
    })
    .filter(id => id > 0)
  const runtimeConfig: SillyTavernRuntimeConfig = {
    ...chat.runtimeConfig,
    characterId: characters.some(character => character.id === characterId) ? characterId : characters[0]?.id ?? null,
    loreBookIds: selectedWorldBookIds,
    characterRegexScriptsEnabled: true,
    promptTemplateVariables: {}
  }
  return {
    characters,
    loreBooks,
    worldEntries,
    runtimeConfig
  }
}

export function entryTitle(entry: WorldEntry): string {
  return entry.stData.comment?.trim() || entry.stData.keys.join(', ') || `Entry #${entry.id}`
}

export function roleToNumber(value: unknown): number | null {
  if (value === 'system') return 0
  if (value === 'user') return 1
  if (value === 'assistant') return 2
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(2, Math.trunc(number))) : null
}

export function applyToolInput(entry: JsonRecord, input: JsonRecord): JsonRecord {
  const next = cloneJson(entry)
  const extensions = asRecord(next.extensions)
  if (input.title !== undefined) next.comment = String(input.title)
  if (input.content !== undefined) next.content = String(input.content)
  if (input.enabled !== undefined) next.enabled = input.enabled === true
  if (input.constant !== undefined) next.constant = input.constant === true
  if (input.selective !== undefined) next.selective = input.selective === true
  if (input.order !== undefined && input.order !== null) next.insertion_order = Number(input.order)
  if (Array.isArray(input.keys)) next.keys = input.keys.map(String).filter(Boolean)
  if (Array.isArray(input.secondaryKeys)) next.secondary_keys = input.secondaryKeys.map(String).filter(Boolean)
  if (input.position !== undefined && input.position !== null) {
    const position = Number(input.position)
    extensions.position = position
    next.position = position === 1 ? 'after_char' : 'before_char'
  }
  const role = roleToNumber(input.role)
  if (role !== null) extensions.role = role
  if (input.depth !== undefined && input.depth !== null) extensions.depth = Math.max(0, Number(input.depth))
  if (input.probability !== undefined && input.probability !== null) extensions.probability = Math.max(0, Math.min(100, Number(input.probability)))
  if (input.selectiveLogic !== undefined && input.selectiveLogic !== null) extensions.selectiveLogic = Math.max(0, Math.min(3, Number(input.selectiveLogic)))
  next.extensions = extensions
  return next
}
