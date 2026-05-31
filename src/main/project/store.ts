import { access, mkdir, readFile, readdir, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import type {
  ChatBlock,
  ChatCreatePayload,
  ChatBlockCreatePayload,
  ChatBlockUpdatePayload,
  ChatContentPart,
  ChatRuntimeConfig,
  ChatSession,
  ChatUpdatePayload,
  CharacterEntry,
  CharacterUpdatePayload,
  JsonRecord,
  LlmInstance,
  LlmInstanceCreatePayload,
  LlmInstanceUpdatePayload,
  LlmProvider,
  LlmProviderCreatePayload,
  LlmProviderUpdatePayload,
  LlmProviderSnapshot,
  ProviderModelCacheItem,
  ProjectConfig,
  ProjectConfigUpdatePayload,
  ProjectSnapshot,
  RecentProject,
  LoreBook,
  LoreBookUpdatePayload,
  WorldEntry,
  WorldEntryOrderPayload,
  WorldEntryUpdatePayload
} from '../../shared/types'
import { chatBlockMetadataForStorage } from '../../shared/chat-blocks'
import { readConfig, saveConfig } from './app-config'
import { app } from 'electron'
import { ASSETS_DIR, DATABASE_FILE, DEFAULT_PROJECT_DIR, EXPORTS_DIR, PROJECT_FILE } from './constants'
import {
  initDatabase,
  rowToCharacter,
  rowToChatBlock,
  rowToChatSession,
  rowToLlmInstance,
  rowToLlmProvider,
  rowToLoreBook,
  rowToWorldEntry
} from './database'
import {
  asRecord,
  defaultCharacterCard,
  defaultProjectConfig,
  defaultWorldEntry,
  normalizeChatRuntimeConfig,
  normalizeCharacterCard,
  normalizeCharacterForgeData,
  normalizeProjectConfig,
  normalizeWorldEntryData
} from './normalizers'
import { ensureProject, getCurrentProject, setCurrentProject, type ProjectContext } from './state'

const MAX_RECENT_PROJECTS = 20

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
    return normalizeProjectConfig(JSON.parse(await readFile(configPath, 'utf-8')))
  } catch {
    return defaultProjectConfig()
  }
}

export async function writeProjectConfig(project = getCurrentProject()): Promise<void> {
  if (!project) return
  await writeFile(project.configPath, JSON.stringify(project.config, null, 2), 'utf-8')
}

export async function updateProjectConfig(payload: ProjectConfigUpdatePayload): Promise<ProjectConfig> {
  const project = ensureProject()
  project.config = normalizeProjectConfig({
    ...project.config,
    ...payload
  })
  await writeProjectConfig(project)
  return project.config
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

function projectDisplayName(projectPath: string): string {
  return projectPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || projectPath
}

function uniqueProjectPaths(paths: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  return paths
    .map(path => path?.trim() ?? '')
    .filter(path => {
      if (!path || seen.has(path)) return false
      seen.add(path)
      return true
    })
}

async function rememberProjectPath(projectPath: string): Promise<void> {
  const config = await readConfig()
  const recentProjectPaths = uniqueProjectPaths([projectPath, ...(config.recentProjectPaths ?? [])])
    .slice(0, MAX_RECENT_PROJECTS)
  await saveConfig({
    ...config,
    lastProjectPath: projectPath,
    recentProjectPaths
  })
}

export async function listRecentProjects(): Promise<RecentProject[]> {
  const config = await readConfig()
  const configuredPaths = uniqueProjectPaths(config.recentProjectPaths ?? [])
  const validPaths: string[] = []

  for (const projectPath of configuredPaths) {
    if (await isValidProject(projectPath)) validPaths.push(projectPath)
  }

  if (validPaths.length !== configuredPaths.length || config.lastProjectPath && !validPaths.includes(config.lastProjectPath)) {
    await saveConfig({
      ...config,
      lastProjectPath: validPaths[0],
      recentProjectPaths: validPaths
    })
  }

  return validPaths.map(projectPath => ({
    path: projectPath,
    name: projectDisplayName(projectPath)
  }))
}

export async function forgetRecentProject(projectPath: string): Promise<void> {
  const config = await readConfig()
  const recentProjectPaths = uniqueProjectPaths(config.recentProjectPaths ?? [])
    .filter(path => path !== projectPath)
  await saveConfig({
    ...config,
    lastProjectPath: config.lastProjectPath === projectPath ? recentProjectPaths[0] : config.lastProjectPath,
    recentProjectPaths
  })
}

export function defaultProjectPath(): string {
  return join(app.getPath('userData'), DEFAULT_PROJECT_DIR)
}

export async function openDefaultProject(): Promise<ProjectSnapshot> {
  const projectPath = defaultProjectPath()
  await mkdir(projectPath, { recursive: true })
  return openProjectAt(projectPath)
}

export async function openProjectAt(projectPath: string): Promise<ProjectSnapshot> {
  const configPath = join(projectPath, PROJECT_FILE)
  const dbPath = join(projectPath, DATABASE_FILE)
  const exportsPath = join(projectPath, EXPORTS_DIR)
  const assetsPath = join(projectPath, ASSETS_DIR)

  if (!await isValidProject(projectPath)) {
    if (!await isEmptyDirectory(projectPath)) {
      throw new Error('请选择空目录，或已包含 forge.db 与 forge.project.json 的项目目录。')
    }
    await mkdir(exportsPath, { recursive: true })
    await mkdir(assetsPath, { recursive: true })
    await writeFile(configPath, JSON.stringify(defaultProjectConfig(), null, 2), 'utf-8')
  }

  await mkdir(exportsPath, { recursive: true })
  await mkdir(assetsPath, { recursive: true })
  const project: ProjectContext = {
    path: projectPath,
    dbPath,
    configPath,
    exportsPath,
    assetsPath,
    db: initDatabase(dbPath),
    config: await readProjectConfig(configPath)
  }

  setCurrentProject(project)
  await writeProjectConfig(project)
  await rememberProjectPath(projectPath)
  return getProjectSnapshot()
}

export function listCharacters(): CharacterEntry[] {
  const project = ensureProject()
  return project.db.prepare('SELECT * FROM character_entries ORDER BY updated_at DESC, id DESC').all().map(rowToCharacter)
}

export function listLoreBooks(): LoreBook[] {
  const project = ensureProject()
  return project.db.prepare('SELECT * FROM world_books ORDER BY updated_at DESC, id DESC').all().map(rowToLoreBook)
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
    const bookDelta = a.loreBookId - b.loreBookId
    if (bookDelta !== 0) return bookDelta
    const orderDelta = a.stData.insertion_order - b.stData.insertion_order
    if (orderDelta !== 0) return orderDelta
    return a.id - b.id
  })
}

export function listLlmProviders(): LlmProvider[] {
  const project = ensureProject()
  return project.db.prepare('SELECT * FROM llm_providers ORDER BY updated_at DESC, id DESC').all().map(rowToLlmProvider)
}

export function listLlmInstances(): LlmInstance[] {
  const project = ensureProject()
  return project.db.prepare('SELECT * FROM llm_instances ORDER BY updated_at DESC, id DESC').all().map(rowToLlmInstance)
}

export function listChats(): ChatSession[] {
  const project = ensureProject()
  return project.db.prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC, id DESC').all().map(rowToChatSession)
}

export function listChatBlocks(): ChatBlock[] {
  const project = ensureProject()
  return project.db.prepare('SELECT * FROM chat_blocks ORDER BY chat_id ASC, order_index ASC, id ASC').all().map(rowToChatBlock)
}

export function listChatBlocksForChat(chatId: number): ChatBlock[] {
  const project = ensureProject()
  return project.db.prepare(`
    SELECT * FROM chat_blocks WHERE chat_id = ? ORDER BY order_index ASC, id ASC
  `).all(chatId).map(rowToChatBlock)
}

export function listWorldEntriesForBook(loreBookId: number): WorldEntry[] {
  const project = ensureProject()
  return sortWorldEntries(
    project.db.prepare('SELECT * FROM world_entries WHERE world_book_id = ?').all(loreBookId).map(rowToWorldEntry)
  )
}

export function getCharacter(id: number): CharacterEntry {
  const project = ensureProject()
  const row = project.db.prepare('SELECT * FROM character_entries WHERE id = ?').get(id)
  if (!row) throw new Error('角色卡不存在。')
  return rowToCharacter(row)
}

export function getLoreBook(id: number): LoreBook {
  const project = ensureProject()
  const row = project.db.prepare('SELECT * FROM world_books WHERE id = ?').get(id)
  if (!row) throw new Error('世界书不存在。')
  return rowToLoreBook(row)
}

export function getWorldEntry(id: number): WorldEntry {
  const project = ensureProject()
  const row = project.db.prepare('SELECT * FROM world_entries WHERE id = ?').get(id)
  if (!row) throw new Error('世界书条目不存在。')
  return rowToWorldEntry(row)
}

export function getLlmProvider(id: number): LlmProvider {
  const project = ensureProject()
  const row = project.db.prepare('SELECT * FROM llm_providers WHERE id = ?').get(id)
  if (!row) throw new Error('LLM 提供商不存在。')
  return rowToLlmProvider(row)
}

export function getLlmInstance(id: number): LlmInstance {
  const project = ensureProject()
  const row = project.db.prepare('SELECT * FROM llm_instances WHERE id = ?').get(id)
  if (!row) throw new Error('LLM 实例不存在。')
  return rowToLlmInstance(row)
}

export function getChat(id: number): ChatSession {
  const project = ensureProject()
  const row = project.db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id)
  if (!row) throw new Error('聊天不存在。')
  return rowToChatSession(row)
}

export function getChatBlock(id: number): ChatBlock {
  const project = ensureProject()
  const row = project.db.prepare('SELECT * FROM chat_blocks WHERE id = ?').get(id)
  if (!row) throw new Error('聊天块不存在。')
  return rowToChatBlock(row)
}

export function getProjectSnapshot(): ProjectSnapshot {
  const project = ensureProject()
  return {
    path: project.path,
    config: project.config,
    characters: listCharacters(),
    loreBooks: listLoreBooks(),
    worldEntries: listWorldEntries(),
    llmProviders: listLlmProviders(),
    llmInstances: listLlmInstances(),
    chats: listChats(),
    chatBlocks: listChatBlocks()
  }
}

export function createCharacter(): CharacterEntry {
  const project = ensureProject()
  const now = new Date().toISOString()
  const result = project.db.prepare(`
    INSERT INTO character_entries (created_at, updated_at, asset_path, st_data, forge_data)
    VALUES (?, ?, ?, ?, ?)
  `).run(now, now, null, JSON.stringify(defaultCharacterCard()), JSON.stringify({
    loreBookId: null,
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
  const transaction = project.db.transaction(() => {
    project.db.prepare('DELETE FROM character_entries WHERE id = ?').run(id)
    const now = nowIso()
    const update = project.db.prepare('UPDATE chat_sessions SET runtime_config_json = ?, updated_at = ? WHERE id = ?')
    for (const chat of listChats()) {
      if (chat.runtimeConfig.characterId !== id) continue
      update.run(
        json({ ...chat.runtimeConfig, characterId: null }),
        now,
        chat.id
      )
    }
  })
  transaction()
  return getProjectSnapshot()
}

export function createLoreBook(): LoreBook {
  const project = ensureProject()
  const now = new Date().toISOString()
  const result = project.db.prepare(`
    INSERT INTO world_books (name, created_at, updated_at)
    VALUES (?, ?, ?)
  `).run('Untitled LoreBook', now, now)
  return getLoreBook(Number(result.lastInsertRowid))
}

export function updateLoreBook(book: LoreBookUpdatePayload): LoreBook {
  const project = ensureProject()
  const name = book.name.trim() || 'Untitled LoreBook'
  const now = new Date().toISOString()
  project.db.prepare('UPDATE world_books SET name = ?, updated_at = ? WHERE id = ?').run(name, now, book.id)
  return getLoreBook(book.id)
}

export async function deleteLoreBook(id: number): Promise<ProjectSnapshot> {
  const project = ensureProject()
  getLoreBook(id)

  const transaction = project.db.transaction(() => {
    for (const character of listCharacters()) {
      if (character.forgeData.loreBookId === id) {
        character.forgeData.loreBookId = null
        updateCharacter(character)
      }
    }
    const now = nowIso()
    const update = project.db.prepare('UPDATE chat_sessions SET runtime_config_json = ?, updated_at = ? WHERE id = ?')
    for (const chat of listChats()) {
      if (!chat.runtimeConfig.loreBookIds.includes(id)) continue
      update.run(
        json({
          ...chat.runtimeConfig,
          loreBookIds: chat.runtimeConfig.loreBookIds.filter(loreBookId => loreBookId !== id)
        }),
        now,
        chat.id
      )
    }
    project.db.prepare('DELETE FROM world_entries WHERE world_book_id = ?').run(id)
    project.db.prepare('DELETE FROM world_books WHERE id = ?').run(id)
  })
  transaction()

  return getProjectSnapshot()
}

export function createWorldEntry(loreBookId: number): WorldEntry {
  const project = ensureProject()
  getLoreBook(loreBookId)
  const now = new Date().toISOString()
  const data = defaultWorldEntry()
  data.insertion_order = listWorldEntriesForBook(loreBookId).length + 1
  const result = project.db.prepare(`
    INSERT INTO world_entries (world_book_id, created_at, updated_at, st_data, forge_data)
    VALUES (?, ?, ?, ?, ?)
  `).run(loreBookId, now, now, JSON.stringify(data), JSON.stringify({}))
  return getWorldEntry(Number(result.lastInsertRowid))
}

export function updateWorldEntry(entry: WorldEntryUpdatePayload): WorldEntry {
  const project = ensureProject()
  getLoreBook(entry.loreBookId)
  const now = new Date().toISOString()
  project.db.prepare(`
    UPDATE world_entries SET world_book_id = ?, updated_at = ?, st_data = ?, forge_data = ? WHERE id = ?
  `).run(
    entry.loreBookId,
    now,
    JSON.stringify(normalizeWorldEntryData(entry.stData)),
    JSON.stringify(asRecord(entry.forgeData)),
    entry.id
  )
  return getWorldEntry(entry.id)
}

function renumberLoreBookEntries(loreBookId: number): void {
  const project = ensureProject()
  const now = new Date().toISOString()
  const update = project.db.prepare('UPDATE world_entries SET updated_at = ?, st_data = ? WHERE id = ?')
  for (const [index, entry] of listWorldEntriesForBook(loreBookId).entries()) {
    const data = normalizeWorldEntryData(entry.stData)
    data.insertion_order = index + 1
    update.run(now, JSON.stringify(data), entry.id)
  }
}

export async function deleteWorldEntry(id: number): Promise<ProjectSnapshot> {
  const project = ensureProject()
  const entry = getWorldEntry(id)
  project.db.prepare('DELETE FROM world_entries WHERE id = ?').run(id)
  renumberLoreBookEntries(entry.loreBookId)
  return getProjectSnapshot()
}

export function reorderWorldEntries(payload: WorldEntryOrderPayload): ProjectSnapshot {
  const project = ensureProject()
  getLoreBook(payload.loreBookId)
  const currentEntries = listWorldEntriesForBook(payload.loreBookId)
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

function nowIso(): string {
  return new Date().toISOString()
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null)
}

function defaultChatRuntimeConfig(llmInstanceId: number | null = null): ChatRuntimeConfig {
  return {
    characterId: null,
    llmInstanceId,
    loreBookIds: [],
    characterRegexScriptsEnabled: true
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function normalizeName(value: string, fallback: string): string {
  return value.trim() || fallback
}

export function providerSnapshotFromProvider(provider: LlmProvider): LlmProviderSnapshot {
  return {
    providerName: provider.name,
    type: provider.type,
    config: cloneJson(provider.config)
  }
}

export function createLlmProvider(payload: LlmProviderCreatePayload): LlmProvider {
  const project = ensureProject()
  const now = nowIso()
  const result = project.db.prepare(`
    INSERT INTO llm_providers (name, type, api_key, created_at, updated_at, config_json, models_cache_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    normalizeName(payload.name, '新提供商'),
    payload.type,
    payload.apiKey ?? '',
    now,
    now,
    json(asRecord(payload.config)),
    json([])
  )
  return getLlmProvider(Number(result.lastInsertRowid))
}

export function updateLlmProvider(payload: LlmProviderUpdatePayload): LlmProvider {
  const project = ensureProject()
  getLlmProvider(payload.id)
  const now = nowIso()
  project.db.prepare(`
    UPDATE llm_providers
    SET name = ?, type = ?, api_key = ?, config_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    normalizeName(payload.name, '新提供商'),
    payload.type,
    payload.apiKey ?? '',
    json(asRecord(payload.config)),
    now,
    payload.id
  )
  return getLlmProvider(payload.id)
}

export function updateLlmProviderModelsCache(id: number, models: ProviderModelCacheItem[]): LlmProvider {
  const project = ensureProject()
  getLlmProvider(id)
  const now = nowIso()
  project.db.prepare(`
    UPDATE llm_providers SET models_cache_json = ?, updated_at = ? WHERE id = ?
  `).run(json(models), now, id)
  return getLlmProvider(id)
}

export function clearLlmProviderModelsCache(id: number): LlmProvider {
  return updateLlmProviderModelsCache(id, [])
}

export function restoreLlmProviderFromInstance(id: number): LlmProvider {
  const instance = getLlmInstance(id)
  const project = ensureProject()
  const now = nowIso()
  const model: ProviderModelCacheItem = {
    id: instance.modelId,
    displayName: instance.modelId,
    metadata: { source: 'restored' },
    fetchedAt: now
  }
  const result = project.db.prepare(`
    INSERT INTO llm_providers (name, type, api_key, created_at, updated_at, config_json, models_cache_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    `${instance.providerSnapshot.providerName || instance.name}（恢复）`,
    instance.providerSnapshot.type,
    '',
    now,
    now,
    json(instance.providerSnapshot.config),
    json([model])
  )
  return getLlmProvider(Number(result.lastInsertRowid))
}

export async function deleteLlmProvider(id: number): Promise<ProjectSnapshot> {
  const project = ensureProject()
  getLlmProvider(id)
  const transaction = project.db.transaction(() => {
    project.db.prepare('UPDATE llm_instances SET provider_id = NULL, updated_at = ? WHERE provider_id = ?').run(nowIso(), id)
    project.db.prepare('DELETE FROM llm_providers WHERE id = ?').run(id)
  })
  transaction()
  return getProjectSnapshot()
}

export function createLlmInstance(payload: LlmInstanceCreatePayload): LlmInstance {
  const project = ensureProject()
  const now = nowIso()
  const result = project.db.prepare(`
    INSERT INTO llm_instances (
      name, provider_id, model_id, provider_snapshot_json, parameters_json, extra_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    normalizeName(payload.name, '新 LLM 实例'),
    payload.providerId,
    payload.modelId.trim(),
    json(payload.providerSnapshot),
    json(payload.parameters),
    json(asRecord(payload.extra)),
    now,
    now
  )
  return getLlmInstance(Number(result.lastInsertRowid))
}

export function updateLlmInstance(payload: LlmInstanceUpdatePayload): LlmInstance {
  const project = ensureProject()
  getLlmInstance(payload.id)
  const now = nowIso()
  project.db.prepare(`
    UPDATE llm_instances
    SET name = ?, provider_id = ?, model_id = ?, provider_snapshot_json = ?, parameters_json = ?, extra_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    normalizeName(payload.name, '新 LLM 实例'),
    payload.providerId,
    payload.modelId.trim(),
    json(payload.providerSnapshot),
    json(payload.parameters),
    json(asRecord(payload.extra)),
    now,
    payload.id
  )
  return getLlmInstance(payload.id)
}

export async function deleteLlmInstance(id: number): Promise<ProjectSnapshot> {
  const project = ensureProject()
  getLlmInstance(id)
  const transaction = project.db.transaction(() => {
    const now = nowIso()
    const update = project.db.prepare('UPDATE chat_sessions SET runtime_config_json = ?, updated_at = ? WHERE id = ?')
    for (const chat of listChats()) {
      if (chat.runtimeConfig.llmInstanceId !== id) continue
      update.run(
        json({ ...chat.runtimeConfig, llmInstanceId: null }),
        now,
        chat.id
      )
    }
    project.db.prepare('DELETE FROM llm_instances WHERE id = ?').run(id)
  })
  transaction()
  return getProjectSnapshot()
}

function touchChat(chatId: number): void {
  const project = ensureProject()
  project.db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(nowIso(), chatId)
}

export function createChat(payload: ChatCreatePayload = {}): ChatSession {
  const project = ensureProject()
  const now = nowIso()
  const recentInstance = listLlmInstances()[0] ?? null
  const runtimeConfig = normalizeChatRuntimeConfig({
    ...defaultChatRuntimeConfig(recentInstance?.id ?? null),
    ...asRecord(payload.runtimeConfig)
  })
  const transaction = project.db.transaction(() => {
    const result = project.db.prepare(`
      INSERT INTO chat_sessions (title, runtime_config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(normalizeName(payload.title ?? '新聊天', '新聊天'), json(runtimeConfig), now, now)
    return Number(result.lastInsertRowid)
  })
  return getChat(transaction())
}

export function updateChat(payload: ChatUpdatePayload): ChatSession {
  const project = ensureProject()
  const chat = getChat(payload.id)
  const now = nowIso()
  project.db.prepare(`
    UPDATE chat_sessions SET title = ?, runtime_config_json = ?, updated_at = ? WHERE id = ?
  `).run(
    payload.title === undefined ? chat.title : normalizeName(payload.title, '新聊天'),
    json(normalizeChatRuntimeConfig(payload.runtimeConfig ?? chat.runtimeConfig)),
    now,
    payload.id
  )
  return getChat(payload.id)
}

export async function deleteChat(id: number): Promise<ProjectSnapshot> {
  const project = ensureProject()
  getChat(id)
  project.db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id)
  return getProjectSnapshot()
}

function nextChatBlockOrder(chatId: number): number {
  const project = ensureProject()
  const row = project.db.prepare('SELECT COALESCE(MAX(order_index), 0) AS value FROM chat_blocks WHERE chat_id = ?').get(chatId) as { value: number }
  return Number(row.value) + 1
}

function renumberChatBlocks(chatId: number): void {
  const project = ensureProject()
  const rows = project.db.prepare('SELECT id FROM chat_blocks WHERE chat_id = ? ORDER BY order_index ASC, id ASC').all(chatId) as { id: number }[]
  const update = project.db.prepare('UPDATE chat_blocks SET order_index = ?, updated_at = ? WHERE id = ?')
  const now = nowIso()
  rows.forEach((row, index) => update.run(index + 1, now, row.id))
}

function chatBlockInsertionOrder(payload: ChatBlockCreatePayload): number {
  const project = ensureProject()
  if (payload.insertRelativeBlockId && payload.insertPlacement) {
    const relative = getChatBlock(payload.insertRelativeBlockId)
    if (relative.chatId !== payload.chatId) throw new Error('插入位置不属于当前聊天。')
    const orderIndex = payload.insertPlacement === 'before'
      ? relative.orderIndex
      : relative.orderIndex + 1
    project.db.prepare(`
      UPDATE chat_blocks SET order_index = order_index + 1 WHERE chat_id = ? AND order_index >= ?
    `).run(payload.chatId, orderIndex)
    return orderIndex
  }

  if (payload.kind === 'system') {
    project.db.prepare('UPDATE chat_blocks SET order_index = order_index + 1 WHERE chat_id = ?').run(payload.chatId)
    return 1
  }

  return nextChatBlockOrder(payload.chatId)
}

export function createChatBlock(payload: ChatBlockCreatePayload): ChatBlock {
  const project = ensureProject()
  getChat(payload.chatId)
  const now = nowIso()
  const orderIndex = chatBlockInsertionOrder(payload)
  const metadata = chatBlockMetadataForStorage(payload.kind, payload.metadata)
  const result = project.db.prepare(`
    INSERT INTO chat_blocks (
      chat_id, kind, enabled, status, order_index,
      content_parts_json, metadata_json, llm_instance_snapshot_json, request_block_ids_json,
      error_text, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payload.chatId,
    payload.kind,
    payload.enabled === false ? 0 : 1,
    'idle',
    orderIndex,
    json(payload.contentParts),
    json(metadata),
    null,
    json([]),
    '',
    now,
    now
  )
  renumberChatBlocks(payload.chatId)
  touchChat(payload.chatId)
  return getChatBlock(Number(result.lastInsertRowid))
}

export function updateChatBlock(payload: ChatBlockUpdatePayload): ChatBlock {
  const project = ensureProject()
  const block = getChatBlock(payload.id)
  const now = nowIso()
  const metadata = payload.metadata === undefined
    ? block.metadata
    : chatBlockMetadataForStorage(block.kind, payload.metadata)
  project.db.prepare(`
    UPDATE chat_blocks
    SET enabled = ?, content_parts_json = ?, metadata_json = ?, status = ?, error_text = ?, updated_at = ?
    WHERE id = ?
  `).run(
    payload.enabled === undefined ? (block.enabled ? 1 : 0) : (payload.enabled ? 1 : 0),
    json(payload.contentParts ?? block.contentParts),
    json(metadata),
    block.status === 'generating' ? block.status : 'idle',
    block.status === 'generating' ? block.errorText : '',
    now,
    payload.id
  )
  touchChat(block.chatId)
  return getChatBlock(payload.id)
}

export async function deleteChatBlock(id: number): Promise<ProjectSnapshot> {
  const project = ensureProject()
  const block = getChatBlock(id)
  project.db.prepare('DELETE FROM chat_blocks WHERE id = ?').run(id)
  renumberChatBlocks(block.chatId)
  touchChat(block.chatId)
  return getProjectSnapshot()
}

export function createAssistantGenerationBlock(chatId: number, llmInstance: LlmInstance, requestBlockIds: number[]): ChatBlock {
  const project = ensureProject()
  getChat(chatId)
  const now = nowIso()
  const result = project.db.prepare(`
    INSERT INTO chat_blocks (
      chat_id, kind, enabled, status, order_index,
      content_parts_json, metadata_json, llm_instance_snapshot_json, request_block_ids_json,
      error_text, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    chatId,
    'assistant',
    0,
    'generating',
    nextChatBlockOrder(chatId),
    json([{ type: 'text', text: '' }]),
    json({ generationStartedAt: now }),
    json(llmInstance),
    json(requestBlockIds),
    '',
    now,
    now
  )
  touchChat(chatId)
  return getChatBlock(Number(result.lastInsertRowid))
}

export function prepareAssistantBlockForRegeneration(id: number, llmInstance: LlmInstance, requestBlockIds: number[]): ChatBlock {
  const project = ensureProject()
  const block = getChatBlock(id)
  if (block.kind !== 'assistant') throw new Error('只能重新生成助手块。')
  const now = nowIso()
  const metadata: JsonRecord = { ...block.metadata, generationStartedAt: now }
  delete metadata.usage
  delete metadata.finishReason
  delete metadata.usageRecordedAt
  delete metadata.generationFinishedAt
  project.db.prepare(`
    UPDATE chat_blocks
    SET enabled = 0, status = 'generating', content_parts_json = ?, llm_instance_snapshot_json = ?,
        request_block_ids_json = ?, metadata_json = ?, error_text = '', updated_at = ?
    WHERE id = ?
  `).run(json([{ type: 'text', text: '' }]), json(llmInstance), json(requestBlockIds), json(metadata), now, id)
  touchChat(block.chatId)
  return getChatBlock(id)
}

export function updateAssistantGenerationBlock(
  id: number,
  contentParts: ChatContentPart[],
  status: 'generating' | 'idle' | 'stopped' | 'error',
  enabled: boolean,
  errorText = '',
  metadataPatch?: JsonRecord
): ChatBlock {
  const project = ensureProject()
  const block = getChatBlock(id)
  const now = nowIso()
  const metadata = metadataPatch === undefined
    ? block.metadata
    : { ...block.metadata, ...metadataPatch }
  project.db.prepare(`
    UPDATE chat_blocks
    SET content_parts_json = ?, metadata_json = ?, status = ?, enabled = ?, error_text = ?, updated_at = ?
    WHERE id = ?
  `).run(
    json(contentParts),
    json(metadata),
    status,
    enabled ? 1 : 0,
    errorText,
    now,
    id
  )
  touchChat(block.chatId)
  return getChatBlock(id)
}
