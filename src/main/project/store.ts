import { access, mkdir, readFile, readdir, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import type {
  ChatBlock,
  ChatBlockCreatePayload,
  ChatBlockUpdatePayload,
  ChatContentPart,
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
  PromptSnippet,
  PromptSnippetUpdatePayload,
  PromptTag,
  PromptTagCreatePayload,
  PromptTagUpdatePayload,
  ProviderModelCacheItem,
  ProjectConfig,
  ProjectSnapshot,
  LoreBook,
  LoreBookUpdatePayload,
  WorldEntry,
  WorldEntryOrderPayload,
  WorldEntryUpdatePayload
} from '../../shared/types'
import { readConfig, saveConfig } from './app-config'
import { DATABASE_FILE, EXPORTS_DIR, PROJECT_FILE } from './constants'
import {
  initDatabase,
  rowToCharacter,
  rowToChatBlock,
  rowToChatSession,
  rowToLlmInstance,
  rowToLlmProvider,
  rowToPromptSnippet,
  rowToPromptTag,
  rowToLoreBook,
  rowToWorldEntry
} from './database'
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

export function listPromptTags(): PromptTag[] {
  const project = ensureProject()
  return project.db.prepare('SELECT * FROM prompt_tags ORDER BY name ASC, id ASC').all().map(rowToPromptTag)
}

function listPromptTagsForSnippet(promptId: number): PromptTag[] {
  const project = ensureProject()
  return project.db.prepare(`
    SELECT prompt_tags.*
    FROM prompt_tags
    JOIN prompt_snippet_tags ON prompt_snippet_tags.tag_id = prompt_tags.id
    WHERE prompt_snippet_tags.prompt_id = ?
    ORDER BY prompt_tags.name ASC, prompt_tags.id ASC
  `).all(promptId).map(rowToPromptTag)
}

export function listPromptSnippets(): PromptSnippet[] {
  const project = ensureProject()
  return project.db.prepare('SELECT * FROM prompt_snippets ORDER BY updated_at DESC, id DESC')
    .all()
    .map((row: any) => rowToPromptSnippet(row, listPromptTagsForSnippet(row.id)))
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

export function getPromptTag(id: number): PromptTag {
  const project = ensureProject()
  const row = project.db.prepare('SELECT * FROM prompt_tags WHERE id = ?').get(id)
  if (!row) throw new Error('标签不存在。')
  return rowToPromptTag(row)
}

function getPromptTagByName(name: string): PromptTag | null {
  const project = ensureProject()
  const row = project.db.prepare('SELECT * FROM prompt_tags WHERE name = ?').get(name)
  return row ? rowToPromptTag(row) : null
}

export function getPromptSnippet(id: number): PromptSnippet {
  const project = ensureProject()
  const row = project.db.prepare('SELECT * FROM prompt_snippets WHERE id = ?').get(id)
  if (!row) throw new Error('提示词不存在。')
  return rowToPromptSnippet(row, listPromptTagsForSnippet(id))
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
    chatBlocks: listChatBlocks(),
    promptTags: listPromptTags(),
    promptSnippets: listPromptSnippets()
  }
}

export function createCharacter(): CharacterEntry {
  const project = ensureProject()
  const now = new Date().toISOString()
  const result = project.db.prepare(`
    INSERT INTO character_entries (created_at, updated_at, st_data, forge_data)
    VALUES (?, ?, ?, ?)
  `).run(now, now, JSON.stringify(defaultCharacterCard()), JSON.stringify({
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
  project.db.prepare('DELETE FROM character_entries WHERE id = ?').run(id)
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

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function normalizeName(value: string, fallback: string): string {
  return value.trim() || fallback
}

function normalizePromptTitle(value: string): string {
  const title = value.trim()
  if (!title) throw new Error('提示词标题不能为空。')
  return title
}

function normalizePromptTagName(value: string): string {
  const name = value.trim()
  if (!name) throw new Error('标签名称不能为空。')
  if (Array.from(name).length > 20) throw new Error('标签不得超过 20 个字符。')
  return name
}

function normalizePromptTagIds(tagIds: number[]): number[] {
  const ids = [...new Set(tagIds.map(Number).filter(Number.isFinite))]
  ids.forEach(id => getPromptTag(id))
  return ids
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
    project.db.prepare('UPDATE chat_sessions SET llm_instance_id = NULL, updated_at = ? WHERE llm_instance_id = ?').run(now, id)
    project.db.prepare('DELETE FROM llm_instances WHERE id = ?').run(id)
  })
  transaction()
  return getProjectSnapshot()
}

function touchChat(chatId: number): void {
  const project = ensureProject()
  project.db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(nowIso(), chatId)
}

export function createChat(): ChatSession {
  const project = ensureProject()
  const now = nowIso()
  const recentInstance = listLlmInstances()[0] ?? null
  const transaction = project.db.transaction(() => {
    const result = project.db.prepare(`
      INSERT INTO chat_sessions (title, llm_instance_id, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run('新聊天', recentInstance?.id ?? null, now, now)
    const chatId = Number(result.lastInsertRowid)
    project.db.prepare(`
      INSERT INTO chat_blocks (
        chat_id, kind, target_role, enabled, status, order_index, title, summary,
        content_parts_json, metadata_json, llm_instance_snapshot_json, request_block_ids_json,
        error_text, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      chatId,
      'system',
      'system',
      1,
      'idle',
      1,
      '系统提示词',
      '',
      json([{ type: 'text', text: '' }]),
      json({}),
      null,
      json([]),
      '',
      now,
      now
    )
    return chatId
  })
  return getChat(transaction())
}

export function updateChat(payload: ChatUpdatePayload): ChatSession {
  const project = ensureProject()
  const chat = getChat(payload.id)
  const now = nowIso()
  project.db.prepare(`
    UPDATE chat_sessions SET title = ?, llm_instance_id = ?, updated_at = ? WHERE id = ?
  `).run(
    payload.title === undefined ? chat.title : normalizeName(payload.title, '新聊天'),
    payload.llmInstanceId === undefined ? chat.llmInstanceId : payload.llmInstanceId,
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

export function createChatBlock(payload: ChatBlockCreatePayload): ChatBlock {
  const project = ensureProject()
  getChat(payload.chatId)
  const now = nowIso()
  const orderIndex = payload.kind === 'system'
    ? 1
    : nextChatBlockOrder(payload.chatId)
  if (payload.kind === 'system') {
    project.db.prepare('UPDATE chat_blocks SET order_index = order_index + 1 WHERE chat_id = ?').run(payload.chatId)
  }
  const result = project.db.prepare(`
    INSERT INTO chat_blocks (
      chat_id, kind, target_role, enabled, status, order_index, title, summary,
      content_parts_json, metadata_json, llm_instance_snapshot_json, request_block_ids_json,
      error_text, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payload.chatId,
    payload.kind,
    payload.targetRole ?? (payload.kind === 'injection' ? 'system' : payload.kind),
    payload.enabled === false ? 0 : 1,
    'idle',
    orderIndex,
    payload.title ?? '',
    payload.summary ?? '',
    json(payload.contentParts),
    json(asRecord(payload.metadata)),
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
  project.db.prepare(`
    UPDATE chat_blocks
    SET enabled = ?, target_role = ?, title = ?, summary = ?, content_parts_json = ?, metadata_json = ?, status = ?, error_text = ?, updated_at = ?
    WHERE id = ?
  `).run(
    payload.enabled === undefined ? (block.enabled ? 1 : 0) : (payload.enabled ? 1 : 0),
    payload.targetRole ?? block.targetRole,
    payload.title ?? block.title,
    payload.summary ?? block.summary,
    json(payload.contentParts ?? block.contentParts),
    json(asRecord(payload.metadata ?? block.metadata)),
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

export function createPromptSnippet(): PromptSnippet {
  const project = ensureProject()
  const now = nowIso()
  const result = project.db.prepare(`
    INSERT INTO prompt_snippets (title, content, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `).run('新提示词', '', now, now)
  return getPromptSnippet(Number(result.lastInsertRowid))
}

export function updatePromptSnippet(payload: PromptSnippetUpdatePayload): PromptSnippet {
  const project = ensureProject()
  getPromptSnippet(payload.id)
  const title = normalizePromptTitle(payload.title)
  const tagIds = normalizePromptTagIds(payload.tagIds)
  const now = nowIso()
  const transaction = project.db.transaction(() => {
    project.db.prepare(`
      UPDATE prompt_snippets SET title = ?, content = ?, updated_at = ? WHERE id = ?
    `).run(title, payload.content ?? '', now, payload.id)
    project.db.prepare('DELETE FROM prompt_snippet_tags WHERE prompt_id = ?').run(payload.id)
    const insert = project.db.prepare(`
      INSERT INTO prompt_snippet_tags (prompt_id, tag_id, created_at)
      VALUES (?, ?, ?)
    `)
    tagIds.forEach(tagId => insert.run(payload.id, tagId, now))
  })
  transaction()
  return getPromptSnippet(payload.id)
}

export async function deletePromptSnippet(id: number): Promise<ProjectSnapshot> {
  const project = ensureProject()
  getPromptSnippet(id)
  project.db.prepare('DELETE FROM prompt_snippets WHERE id = ?').run(id)
  return getProjectSnapshot()
}

export function createPromptTag(payload: PromptTagCreatePayload): PromptTag {
  const project = ensureProject()
  const name = normalizePromptTagName(payload.name)
  const existing = getPromptTagByName(name)
  if (existing) return existing
  const now = nowIso()
  const result = project.db.prepare(`
    INSERT INTO prompt_tags (name, created_at, updated_at)
    VALUES (?, ?, ?)
  `).run(name, now, now)
  return getPromptTag(Number(result.lastInsertRowid))
}

export function updatePromptTag(payload: PromptTagUpdatePayload): ProjectSnapshot {
  const project = ensureProject()
  getPromptTag(payload.id)
  const name = normalizePromptTagName(payload.name)
  const existing = getPromptTagByName(name)
  if (existing && existing.id !== payload.id) throw new Error('标签已存在。')
  project.db.prepare('UPDATE prompt_tags SET name = ?, updated_at = ? WHERE id = ?').run(name, nowIso(), payload.id)
  return getProjectSnapshot()
}

export async function deletePromptTag(id: number): Promise<ProjectSnapshot> {
  const project = ensureProject()
  getPromptTag(id)
  project.db.prepare('DELETE FROM prompt_tags WHERE id = ?').run(id)
  return getProjectSnapshot()
}

export function createAssistantGenerationBlock(chatId: number, llmInstance: LlmInstance, requestBlockIds: number[]): ChatBlock {
  const project = ensureProject()
  getChat(chatId)
  const now = nowIso()
  const result = project.db.prepare(`
    INSERT INTO chat_blocks (
      chat_id, kind, target_role, enabled, status, order_index, title, summary,
      content_parts_json, metadata_json, llm_instance_snapshot_json, request_block_ids_json,
      error_text, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    chatId,
    'assistant',
    'assistant',
    0,
    'generating',
    nextChatBlockOrder(chatId),
    '助手回复',
    '',
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
