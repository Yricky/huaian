import { access, mkdir, readFile, readdir, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import type {
  CharacterEntry,
  CharacterUpdatePayload,
  ProjectConfig,
  ProjectSnapshot,
  WorldBook,
  WorldBookUpdatePayload,
  WorldEntry,
  WorldEntryOrderPayload,
  WorldEntryUpdatePayload
} from '../../shared/types'
import { readConfig, saveConfig } from './app-config'
import { DATABASE_FILE, EXPORTS_DIR, PROJECT_FILE } from './constants'
import { initDatabase, rowToCharacter, rowToWorldBook, rowToWorldEntry } from './database'
import {
  asRecord,
  defaultCharacterCard,
  defaultProjectConfig,
  defaultWorldEntry,
  normalizeCharacterCard,
  normalizeCharacterForgeData,
  normalizeWorldEntryData,
  toNumber
} from './normalizers'
import { ensureProject, getCurrentProject, setCurrentProject, type ProjectContext } from './state'

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function readProjectConfig(configPath: string): Promise<ProjectConfig> {
  try {
    const raw = JSON.parse(await readFile(configPath, 'utf-8'))
    const config = defaultProjectConfig()
    config.schemaVersion = toNumber(raw.schemaVersion, 1)
    return config
  } catch {
    return defaultProjectConfig()
  }
}

export async function writeProjectConfig(project = getCurrentProject()): Promise<void> {
  if (!project) return
  await writeFile(project.configPath, JSON.stringify(project.config, null, 2), 'utf-8')
}

async function isEmptyDirectory(projectPath: string): Promise<boolean> {
  const stats = await stat(projectPath)
  if (!stats.isDirectory()) return false
  const files = await readdir(projectPath)
  return files.length === 0
}

export async function isValidProject(projectPath: string): Promise<boolean> {
  return await pathExists(join(projectPath, PROJECT_FILE)) && await pathExists(join(projectPath, DATABASE_FILE))
}

export async function openProjectAt(projectPath: string): Promise<ProjectSnapshot> {
  const configPath = join(projectPath, PROJECT_FILE)
  const dbPath = join(projectPath, DATABASE_FILE)
  const exportsPath = join(projectPath, EXPORTS_DIR)

  if (!await isValidProject(projectPath)) {
    if (!await isEmptyDirectory(projectPath)) {
      throw new Error('请选择空目录，或已包含 forge.db 与 forge.project.json 的项目目录。')
    }
    await mkdir(exportsPath, { recursive: true })
    await writeFile(configPath, JSON.stringify(defaultProjectConfig(), null, 2), 'utf-8')
  }

  await mkdir(exportsPath, { recursive: true })
  const project: ProjectContext = {
    path: projectPath,
    dbPath,
    configPath,
    exportsPath,
    db: initDatabase(dbPath),
    config: await readProjectConfig(configPath)
  }

  setCurrentProject(project)
  await writeProjectConfig(project)
  await saveConfig({ ...(await readConfig()), lastProjectPath: projectPath })
  return getProjectSnapshot()
}

export function listCharacters(): CharacterEntry[] {
  const project = ensureProject()
  return project.db.prepare('SELECT * FROM character_entries ORDER BY updated_at DESC, id DESC').all().map(rowToCharacter)
}

export function listWorldBooks(): WorldBook[] {
  const project = ensureProject()
  return project.db.prepare('SELECT * FROM world_books ORDER BY updated_at DESC, id DESC').all().map(rowToWorldBook)
}

function sortWorldEntries(entries: WorldEntry[]): WorldEntry[] {
  return [...entries].sort((a, b) => {
    const orderDelta = a.stData.insertion_order - b.stData.insertion_order
    if (orderDelta !== 0) return orderDelta
    return a.id - b.id
  })
}

export function listWorldEntries(): WorldEntry[] {
  const project = ensureProject()
  const entries = project.db.prepare('SELECT * FROM world_entries').all().map(rowToWorldEntry)
  return [...entries].sort((a, b) => {
    const bookDelta = a.worldBookId - b.worldBookId
    if (bookDelta !== 0) return bookDelta
    const orderDelta = a.stData.insertion_order - b.stData.insertion_order
    if (orderDelta !== 0) return orderDelta
    return a.id - b.id
  })
}

export function listWorldEntriesForBook(worldBookId: number): WorldEntry[] {
  const project = ensureProject()
  return sortWorldEntries(
    project.db.prepare('SELECT * FROM world_entries WHERE world_book_id = ?').all(worldBookId).map(rowToWorldEntry)
  )
}

export function getCharacter(id: number): CharacterEntry {
  const project = ensureProject()
  const row = project.db.prepare('SELECT * FROM character_entries WHERE id = ?').get(id)
  if (!row) throw new Error('角色卡不存在。')
  return rowToCharacter(row)
}

export function getWorldBook(id: number): WorldBook {
  const project = ensureProject()
  const row = project.db.prepare('SELECT * FROM world_books WHERE id = ?').get(id)
  if (!row) throw new Error('世界书不存在。')
  return rowToWorldBook(row)
}

export function getWorldEntry(id: number): WorldEntry {
  const project = ensureProject()
  const row = project.db.prepare('SELECT * FROM world_entries WHERE id = ?').get(id)
  if (!row) throw new Error('世界书条目不存在。')
  return rowToWorldEntry(row)
}

export function getProjectSnapshot(): ProjectSnapshot {
  const project = ensureProject()
  return {
    path: project.path,
    config: project.config,
    characters: listCharacters(),
    worldBooks: listWorldBooks(),
    worldEntries: listWorldEntries()
  }
}

export function createCharacter(): CharacterEntry {
  const project = ensureProject()
  const now = new Date().toISOString()
  const result = project.db.prepare(`
    INSERT INTO character_entries (created_at, updated_at, st_data, forge_data)
    VALUES (?, ?, ?, ?)
  `).run(now, now, JSON.stringify(defaultCharacterCard()), JSON.stringify({
    worldBookId: null,
    exportFileName: '',
    characterBookName: ''
  }))
  return getCharacter(Number(result.lastInsertRowid))
}

export function updateCharacter(entry: CharacterUpdatePayload): CharacterEntry {
  const project = ensureProject()
  const now = new Date().toISOString()
  const stData = normalizeCharacterCard(entry.stData, now)
  const forgeData = normalizeCharacterForgeData(entry.forgeData)
  project.db.prepare(`
    UPDATE character_entries SET updated_at = ?, st_data = ?, forge_data = ? WHERE id = ?
  `).run(now, JSON.stringify(stData), JSON.stringify(forgeData), entry.id)
  return getCharacter(entry.id)
}

export async function deleteCharacter(id: number): Promise<ProjectSnapshot> {
  const project = ensureProject()
  project.db.prepare('DELETE FROM character_entries WHERE id = ?').run(id)
  return getProjectSnapshot()
}

export function createWorldBook(): WorldBook {
  const project = ensureProject()
  const now = new Date().toISOString()
  const result = project.db.prepare(`
    INSERT INTO world_books (name, created_at, updated_at)
    VALUES (?, ?, ?)
  `).run('Untitled World Book', now, now)
  return getWorldBook(Number(result.lastInsertRowid))
}

export function updateWorldBook(book: WorldBookUpdatePayload): WorldBook {
  const project = ensureProject()
  const name = book.name.trim() || 'Untitled World Book'
  const now = new Date().toISOString()
  project.db.prepare('UPDATE world_books SET name = ?, updated_at = ? WHERE id = ?').run(name, now, book.id)
  return getWorldBook(book.id)
}

export async function deleteWorldBook(id: number): Promise<ProjectSnapshot> {
  const project = ensureProject()
  getWorldBook(id)

  const transaction = project.db.transaction(() => {
    for (const character of listCharacters()) {
      if (character.forgeData.worldBookId === id) {
        character.forgeData.worldBookId = null
        updateCharacter(character)
      }
    }
    project.db.prepare('DELETE FROM world_entries WHERE world_book_id = ?').run(id)
    project.db.prepare('DELETE FROM world_books WHERE id = ?').run(id)
  })
  transaction()

  return getProjectSnapshot()
}

export function createWorldEntry(worldBookId: number): WorldEntry {
  const project = ensureProject()
  getWorldBook(worldBookId)
  const now = new Date().toISOString()
  const data = defaultWorldEntry()
  data.insertion_order = listWorldEntriesForBook(worldBookId).length + 1
  const result = project.db.prepare(`
    INSERT INTO world_entries (world_book_id, created_at, updated_at, st_data, forge_data)
    VALUES (?, ?, ?, ?, ?)
  `).run(worldBookId, now, now, JSON.stringify(data), JSON.stringify({}))
  return getWorldEntry(Number(result.lastInsertRowid))
}

export function updateWorldEntry(entry: WorldEntryUpdatePayload): WorldEntry {
  const project = ensureProject()
  getWorldBook(entry.worldBookId)
  const now = new Date().toISOString()
  project.db.prepare(`
    UPDATE world_entries SET world_book_id = ?, updated_at = ?, st_data = ?, forge_data = ? WHERE id = ?
  `).run(
    entry.worldBookId,
    now,
    JSON.stringify(normalizeWorldEntryData(entry.stData)),
    JSON.stringify(asRecord(entry.forgeData)),
    entry.id
  )
  return getWorldEntry(entry.id)
}

function renumberWorldBookEntries(worldBookId: number): void {
  const project = ensureProject()
  const now = new Date().toISOString()
  const update = project.db.prepare('UPDATE world_entries SET updated_at = ?, st_data = ? WHERE id = ?')
  for (const [index, entry] of listWorldEntriesForBook(worldBookId).entries()) {
    const data = normalizeWorldEntryData(entry.stData)
    data.insertion_order = index + 1
    update.run(now, JSON.stringify(data), entry.id)
  }
}

export async function deleteWorldEntry(id: number): Promise<ProjectSnapshot> {
  const project = ensureProject()
  const entry = getWorldEntry(id)
  project.db.prepare('DELETE FROM world_entries WHERE id = ?').run(id)
  renumberWorldBookEntries(entry.worldBookId)
  return getProjectSnapshot()
}

export function reorderWorldEntries(payload: WorldEntryOrderPayload): ProjectSnapshot {
  const project = ensureProject()
  getWorldBook(payload.worldBookId)
  const currentEntries = listWorldEntriesForBook(payload.worldBookId)
  const currentIds = currentEntries.map(entry => entry.id)
  const requestedIds = payload.worldEntryIds
  const sameEntries = currentIds.length === requestedIds.length &&
    currentIds.every(id => requestedIds.includes(id)) &&
    requestedIds.every(id => currentIds.includes(id))

  if (!sameEntries) {
    throw new Error('条目排序数据与当前世界书不匹配。')
  }

  const entryById = new Map(currentEntries.map(entry => [entry.id, entry]))
  const now = new Date().toISOString()
  const update = project.db.prepare('UPDATE world_entries SET updated_at = ?, st_data = ? WHERE id = ?')
  const transaction = project.db.transaction((ids: number[]) => {
    ids.forEach((id, index) => {
      const entry = entryById.get(id)
      if (!entry) return
      const data = normalizeWorldEntryData(entry.stData)
      data.insertion_order = index + 1
      update.run(now, JSON.stringify(data), id)
    })
  })
  transaction(requestedIds)

  return getProjectSnapshot()
}
