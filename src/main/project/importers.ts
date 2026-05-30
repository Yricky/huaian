import { dialog } from 'electron'
import { access, copyFile, mkdir, readFile } from 'fs/promises'
import { basename, extname, join, parse, relative, sep } from 'path'
import type {
  CharacterBookEntryData,
  ImportFailure,
  JsonRecord,
  ProjectImportResult
} from '../../shared/types'
import {
  asRecord,
  cloneJson,
  normalizeCharacterCard,
  normalizeCharacterForgeData,
  normalizeWorldEntryData,
  toBoolean,
  toNumber,
  toString,
  toStringArray
} from './normalizers'
import { ensureProject, type ProjectContext } from './state'
import { getProjectSnapshot, listCharacters, listLoreBooks } from './store'

interface ParsedLoreBook {
  name: string
  entries: CharacterBookEntryData[]
}

interface InsertedLoreBook {
  id: number
  entryIds: number[]
  name: string
}

const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])

function nowIso(): string {
  return new Date().toISOString()
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function sanitizeFileName(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 120)
  return cleaned || fallback
}

function withoutJsonExtension(value: string): string {
  return value.replace(/\.json$/i, '')
}

function fileBaseName(filePath: string): string {
  return withoutJsonExtension(parse(filePath).name)
}

function uniqueName(baseName: string, existingNames: Set<string>, fallback: string): string {
  const trimmed = baseName.trim() || fallback
  let name = trimmed
  let suffix = 2
  while (existingNames.has(name.toLocaleLowerCase())) {
    name = `${trimmed} (${suffix})`
    suffix += 1
  }
  existingNames.add(name.toLocaleLowerCase())
  return name
}

function nonEmptyString(value: unknown, fallback: string): string {
  const text = toString(value).trim()
  return text || fallback
}

function relativeProjectPath(project: ProjectContext, path: string): string {
  return relative(project.path, path).split(sep).join('/')
}

async function copyCharacterAsset(project: ProjectContext, sourcePath: string, characterName: string): Promise<string> {
  const assetDir = join(project.assetsPath, 'characters')
  await mkdir(assetDir, { recursive: true })

  const safeBase = sanitizeFileName(characterName || fileBaseName(sourcePath), 'character')
  let candidate = `${safeBase}.png`
  let destination = join(assetDir, candidate)
  let suffix = 2

  while (await pathExists(destination)) {
    candidate = `${safeBase} (${suffix}).png`
    destination = join(assetDir, candidate)
    suffix += 1
  }

  await copyFile(sourcePath, destination)
  return relativeProjectPath(project, destination)
}

function parseJsonText(text: string, filePath: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${basename(filePath)} 不是有效的 JSON。`)
  }
}

function readPngTextChunks(buffer: Buffer): Array<{ keyword: string; text: string }> {
  if (buffer.length < pngSignature.length || !buffer.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new Error('不是有效的 PNG 文件。')
  }

  const chunks: Array<{ keyword: string; text: string }> = []
  let offset = pngSignature.length

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const nextOffset = dataEnd + 4

    if (dataEnd > buffer.length || nextOffset > buffer.length) {
      throw new Error('PNG 元数据结构不完整。')
    }

    if (type === 'tEXt') {
      const data = buffer.subarray(dataStart, dataEnd)
      const separatorIndex = data.indexOf(0)
      if (separatorIndex > -1) {
        chunks.push({
          keyword: data.subarray(0, separatorIndex).toString('latin1'),
          text: data.subarray(separatorIndex + 1).toString('latin1')
        })
      }
    }

    offset = nextOffset
    if (type === 'IEND') break
  }

  return chunks
}

async function readCharacterCardFromPng(filePath: string): Promise<unknown> {
  const chunks = readPngTextChunks(await readFile(filePath))
  const chunk = chunks.find(item => item.keyword.toLowerCase() === 'ccv3') ??
    chunks.find(item => item.keyword.toLowerCase() === 'chara')

  if (!chunk) {
    throw new Error(`${basename(filePath)} 中没有 SillyTavern 角色卡元数据。`)
  }

  const text = Buffer.from(chunk.text, 'base64').toString('utf-8')
  return parseJsonText(text, filePath)
}

async function readImportObject(filePath: string): Promise<unknown> {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.png') return readCharacterCardFromPng(filePath)
  if (extension === '.json') return parseJsonText(await readFile(filePath, 'utf-8'), filePath)
  throw new Error(`${basename(filePath)} 的格式不受支持。`)
}

function isCharacterCardLike(value: unknown): boolean {
  const card = asRecord(value)
  const data = asRecord(card.data)
  return Boolean(
    card.spec === 'chara_card_v2' ||
    card.spec === 'chara_card_v3' ||
    data.name ||
    data.description ||
    data.first_mes ||
    card.first_mes ||
    card.mes_example ||
    card.personality ||
    card.scenario
  )
}

function maybeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function firstDefined<T>(...values: T[]): T | undefined {
  return values.find(value => value !== undefined)
}

function asEntryArray(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.map(item => asRecord(item))
  const entries = asRecord(value)
  return Object.entries(entries)
    .map(([key, item], index) => {
      const value = asRecord(item)
      const uid = value.uid === undefined ? maybeNumber(key) : null
      return {
        key,
        index,
        value: uid === null ? value : { ...value, uid }
      }
    })
    .sort((a, b) => {
      const aDisplay = maybeNumber(a.value.displayIndex) ?? maybeNumber(a.value.uid) ?? maybeNumber(a.key) ?? a.index
      const bDisplay = maybeNumber(b.value.displayIndex) ?? maybeNumber(b.value.uid) ?? maybeNumber(b.key) ?? b.index
      if (aDisplay !== bDisplay) return aDisplay - bDisplay
      return a.index - b.index
    })
    .map(item => item.value)
}

function worldInfoEntryToCharacterBookEntry(entryValue: unknown): CharacterBookEntryData {
  const entry = asRecord(entryValue)
  const extensions = asRecord(entry.extensions)
  const uid = maybeNumber(entry.uid)
  const position = toNumber(firstDefined(extensions.position, entry.position), 0)
  const role = firstDefined(extensions.role, entry.role)
  const probability = firstDefined(extensions.probability, entry.probability)
  const useProbability = firstDefined(extensions.useProbability, entry.useProbability)
  const depth = firstDefined(extensions.depth, entry.depth)
  const caseSensitive = firstDefined(extensions.case_sensitive, entry.caseSensitive)

  const data: CharacterBookEntryData = {
    keys: toStringArray(firstDefined(entry.key, entry.keys)),
    secondary_keys: toStringArray(firstDefined(entry.keysecondary, entry.secondary_keys)),
    comment: toString(entry.comment),
    content: toString(entry.content),
    constant: toBoolean(entry.constant, false),
    selective: toBoolean(entry.selective, false),
    insertion_order: toNumber(firstDefined(entry.order, entry.insertion_order), 100),
    enabled: toBoolean(firstDefined(entry.enabled, entry.disable === undefined ? undefined : !entry.disable), true),
    position: position === 1 ? 'after_char' : 'before_char',
    extensions: {
      ...extensions,
      position,
      depth: depth ?? 4,
      role: role ?? 0,
      probability: probability ?? 100,
      useProbability: useProbability ?? true,
      display_index: firstDefined(extensions.display_index, entry.displayIndex, uid) ?? 0,
      vectorized: toBoolean(firstDefined(extensions.vectorized, entry.vectorized), false),
      selectiveLogic: toNumber(firstDefined(extensions.selectiveLogic, entry.selectiveLogic), 0),
      ignore_budget: toBoolean(firstDefined(extensions.ignore_budget, entry.ignoreBudget), false),
      exclude_recursion: toBoolean(firstDefined(extensions.exclude_recursion, entry.excludeRecursion), false),
      prevent_recursion: toBoolean(firstDefined(extensions.prevent_recursion, entry.preventRecursion), false),
      match_persona_description: toBoolean(firstDefined(extensions.match_persona_description, entry.matchPersonaDescription), false),
      match_character_description: toBoolean(firstDefined(extensions.match_character_description, entry.matchCharacterDescription), false),
      match_character_personality: toBoolean(firstDefined(extensions.match_character_personality, entry.matchCharacterPersonality), false),
      match_character_depth_prompt: toBoolean(firstDefined(extensions.match_character_depth_prompt, entry.matchCharacterDepthPrompt), false),
      match_scenario: toBoolean(firstDefined(extensions.match_scenario, entry.matchScenario), false),
      match_creator_notes: toBoolean(firstDefined(extensions.match_creator_notes, entry.matchCreatorNotes), false),
      delay_until_recursion: firstDefined(extensions.delay_until_recursion, entry.delayUntilRecursion) ?? 0,
      outlet_name: toString(firstDefined(extensions.outlet_name, entry.outletName)),
      group: toString(firstDefined(extensions.group, entry.group)),
      group_override: toBoolean(firstDefined(extensions.group_override, entry.groupOverride), false),
      group_weight: toNumber(firstDefined(extensions.group_weight, entry.groupWeight), 100),
      scan_depth: firstDefined(extensions.scan_depth, entry.scanDepth) ?? null,
      case_sensitive: caseSensitive ?? null,
      match_whole_words: firstDefined(extensions.match_whole_words, entry.matchWholeWords) ?? null,
      use_group_scoring: firstDefined(extensions.use_group_scoring, entry.useGroupScoring) ?? null,
      automation_id: toString(firstDefined(extensions.automation_id, entry.automationId)),
      sticky: firstDefined(extensions.sticky, entry.sticky) ?? null,
      cooldown: firstDefined(extensions.cooldown, entry.cooldown) ?? null,
      delay: firstDefined(extensions.delay, entry.delay) ?? null,
      triggers: Array.isArray(firstDefined(extensions.triggers, entry.triggers))
        ? firstDefined(extensions.triggers, entry.triggers)
        : []
    }
  }

  if (uid !== null && Number.isInteger(uid)) data.id = uid
  if (caseSensitive !== undefined && caseSensitive !== null) {
    data.case_sensitive = toBoolean(caseSensitive, false)
  }
  return normalizeWorldEntryData(data)
}

function characterBookEntryToWorldEntry(entry: unknown): CharacterBookEntryData {
  return normalizeWorldEntryData(entry)
}

function parseLoreBook(value: unknown, fallbackName: string): ParsedLoreBook {
  const root = asRecord(value)
  const data = asRecord(root.data)
  const embeddedBook = asRecord(data.character_book)
  const embeddedFallbackName = `${toString(data.name, fallbackName)}的世界书`

  if (Array.isArray(embeddedBook.entries)) {
    return {
      name: nonEmptyString(embeddedBook.name, embeddedFallbackName),
      entries: embeddedBook.entries.map(characterBookEntryToWorldEntry)
    }
  }

  if (Array.isArray(root.entries)) {
    return {
      name: nonEmptyString(root.name, fallbackName),
      entries: root.entries.map(characterBookEntryToWorldEntry)
    }
  }

  if (root.entries && typeof root.entries === 'object') {
    return {
      name: nonEmptyString(root.name, fallbackName),
      entries: asEntryArray(root.entries).map(worldInfoEntryToCharacterBookEntry)
    }
  }

  throw new Error(`${fallbackName} 中没有可导入的世界书 entries。`)
}

function insertLoreBook(project: ProjectContext, parsed: ParsedLoreBook, existingNames: Set<string>): InsertedLoreBook {
  const now = nowIso()
  const name = uniqueName(parsed.name, existingNames, 'Untitled LoreBook')
  const transaction = project.db.transaction((entries: CharacterBookEntryData[]) => {
    const bookResult = project.db.prepare(`
      INSERT INTO world_books (name, created_at, updated_at)
      VALUES (?, ?, ?)
    `).run(name, now, now)
    const loreBookId = Number(bookResult.lastInsertRowid)
    const entryIds: number[] = []
    const insertEntry = project.db.prepare(`
      INSERT INTO world_entries (world_book_id, created_at, updated_at, st_data, forge_data)
      VALUES (?, ?, ?, ?, ?)
    `)

    for (const entry of entries) {
      const normalized = normalizeWorldEntryData(entry)
      const entryResult = insertEntry.run(loreBookId, now, now, json(normalized), json({}))
      entryIds.push(Number(entryResult.lastInsertRowid))
    }

    return { id: loreBookId, entryIds, name }
  })

  return transaction(parsed.entries)
}

function importResult(
  importedCharacterIds: number[],
  importedLoreBookIds: number[],
  importedWorldEntryIds: number[],
  failures: ImportFailure[]
): ProjectImportResult {
  return {
    snapshot: getProjectSnapshot(),
    importedCharacterIds,
    importedLoreBookIds,
    importedWorldEntryIds,
    failures
  }
}

export async function importCharactersFromFiles(filePaths: string[]): Promise<ProjectImportResult> {
  const project = ensureProject()
  const characterNames = new Set(listCharacters().map(character => toString(asRecord(character.stData.data).name).toLocaleLowerCase()))
  const loreBookNames = new Set(listLoreBooks().map(book => book.name.toLocaleLowerCase()))
  const importedCharacterIds: number[] = []
  const importedLoreBookIds: number[] = []
  const importedWorldEntryIds: number[] = []
  const failures: ImportFailure[] = []

  for (const filePath of filePaths) {
    try {
      const raw = await readImportObject(filePath)
      if (!isCharacterCardLike(raw)) {
        throw new Error(`${basename(filePath)} 不是可识别的 SillyTavern 角色卡。`)
      }

      const rawCard = asRecord(cloneJson(raw))
      const rawData = asRecord(rawCard.data)
      const normalizedCard = normalizeCharacterCard(rawCard)
      const normalizedData = asRecord(normalizedCard.data)
      normalizedData.name = uniqueName(toString(normalizedData.name), characterNames, 'Untitled Character')
      normalizedCard.name = normalizedData.name
      normalizedCard.data = normalizedData

      const embeddedFallbackName = `${normalizedData.name}的世界书`
      const embeddedBook = rawData.character_book ? parseLoreBook({
        name: nonEmptyString(asRecord(rawData.character_book).name, embeddedFallbackName),
        entries: Array.isArray(asRecord(rawData.character_book).entries)
          ? asRecord(rawData.character_book).entries
          : []
      }, embeddedFallbackName) : null
      const assetPath = extname(filePath).toLowerCase() === '.png'
        ? await copyCharacterAsset(project, filePath, toString(normalizedData.name, fileBaseName(filePath)))
        : null
      const insertedBook = embeddedBook ? insertLoreBook(project, embeddedBook, loreBookNames) : null
      if (insertedBook) {
        importedLoreBookIds.push(insertedBook.id)
        importedWorldEntryIds.push(...insertedBook.entryIds)
      }

      const now = nowIso()
      const forgeData = normalizeCharacterForgeData({
        loreBookId: insertedBook?.id ?? null,
        exportFileName: '',
        characterBookName: insertedBook?.name ?? ''
      })
      const result = project.db.prepare(`
        INSERT INTO character_entries (created_at, updated_at, asset_path, st_data, forge_data)
        VALUES (?, ?, ?, ?, ?)
      `).run(now, now, assetPath, json(normalizedCard), json(forgeData))
      importedCharacterIds.push(Number(result.lastInsertRowid))
    } catch (error) {
      failures.push({
        filePath,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return importResult(importedCharacterIds, importedLoreBookIds, importedWorldEntryIds, failures)
}

export async function importLoreBooksFromFiles(filePaths: string[]): Promise<ProjectImportResult> {
  const project = ensureProject()
  const loreBookNames = new Set(listLoreBooks().map(book => book.name.toLocaleLowerCase()))
  const importedLoreBookIds: number[] = []
  const importedWorldEntryIds: number[] = []
  const failures: ImportFailure[] = []

  for (const filePath of filePaths) {
    try {
      const raw = await readImportObject(filePath)
      const parsed = parseLoreBook(raw, fileBaseName(filePath))
      const inserted = insertLoreBook(project, parsed, loreBookNames)
      importedLoreBookIds.push(inserted.id)
      importedWorldEntryIds.push(...inserted.entryIds)
    } catch (error) {
      failures.push({
        filePath,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return importResult([], importedLoreBookIds, importedWorldEntryIds, failures)
}

export async function importCharactersFromDialog(): Promise<ProjectImportResult | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'SillyTavern Character Cards', extensions: ['json', 'png'] },
      { name: 'JSON', extensions: ['json'] },
      { name: 'PNG', extensions: ['png'] }
    ]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return importCharactersFromFiles(result.filePaths)
}

export async function importLoreBooksFromDialog(): Promise<ProjectImportResult | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'SillyTavern Lorebooks', extensions: ['json', 'png'] },
      { name: 'JSON', extensions: ['json'] },
      { name: 'PNG Character Cards', extensions: ['png'] }
    ]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return importLoreBooksFromFiles(result.filePaths)
}
