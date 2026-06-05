import { access, mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'
import type {
  AppSessionCreatePayload,
  AppSessionRecord,
  AppSessionUpdatePayload,
  JsonRecord,
  LlmInstance,
  LlmInstanceCreatePayload,
  LlmInstanceUpdatePayload,
  LlmProvider,
  LlmProviderCreatePayload,
  LlmProviderUpdatePayload,
  ProviderModelCacheItem,
  ProjectConfig,
  ProjectConfigUpdatePayload,
  ProjectSnapshot,
  RecentProject
} from '../../shared/types'
import { readConfig, saveConfig } from './app-config'
import { APP_DATA_DIR, APP_DIR, APP_SAVE_DIR, ASSETS_DIR, DATABASE_FILE, DEFAULT_PROJECT_DIR, EXPORTS_DIR, PROJECT_FILE } from './constants'
import {
  initDatabase,
  rowToAppSession,
  rowToLlmInstance,
  rowToLlmProvider
} from './database'
import {
  asRecord,
  defaultProjectConfig,
  normalizeProjectConfig
} from './normalizers'
import { appSessionSaveRoot, appSaveRoot, ensureProjectApps, listProjectAppsSync } from './apps'
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
  const appPath = join(projectPath, APP_DIR)
  const appDataPath = join(projectPath, APP_DATA_DIR)
  const appSavePath = join(projectPath, APP_SAVE_DIR)

  if (!await isValidProject(projectPath)) {
    if (!await isEmptyDirectory(projectPath)) {
      throw new Error('请选择空目录，或已包含 forge.db 与 forge.project.json 的项目目录。')
    }
    await Promise.all([
      mkdir(exportsPath, { recursive: true }),
      mkdir(assetsPath, { recursive: true }),
      mkdir(appPath, { recursive: true }),
      mkdir(appDataPath, { recursive: true }),
      mkdir(appSavePath, { recursive: true })
    ])
    await writeFile(configPath, JSON.stringify(defaultProjectConfig(), null, 2), 'utf-8')
  }

  await Promise.all([
    mkdir(exportsPath, { recursive: true }),
    mkdir(assetsPath, { recursive: true }),
    mkdir(appPath, { recursive: true }),
    mkdir(appDataPath, { recursive: true }),
    mkdir(appSavePath, { recursive: true })
  ])

  const project: ProjectContext = {
    path: projectPath,
    dbPath,
    configPath,
    exportsPath,
    assetsPath,
    appPath,
    appDataPath,
    appSavePath,
    db: initDatabase(dbPath),
    config: await readProjectConfig(configPath)
  }

  setCurrentProject(project)
  await ensureProjectApps()
  await writeProjectConfig(project)
  await rememberProjectPath(projectPath)
  return getProjectSnapshot()
}

export function listLlmProviders(): LlmProvider[] {
  const project = ensureProject()
  return project.db.prepare('SELECT * FROM llm_providers ORDER BY updated_at DESC, id DESC').all().map(rowToLlmProvider)
}

export function listLlmInstances(): LlmInstance[] {
  const project = ensureProject()
  return project.db.prepare('SELECT * FROM llm_instances ORDER BY order_index ASC, id ASC').all().map(rowToLlmInstance)
}

export function listAppSessions(): AppSessionRecord[] {
  const project = ensureProject()
  return project.db.prepare('SELECT * FROM app_sessions ORDER BY last_opened_at DESC, app_id ASC, id DESC').all().map(rowToAppSession)
}

export function listAppSessionsForApp(appId: string): AppSessionRecord[] {
  const project = ensureProject()
  return project.db.prepare('SELECT * FROM app_sessions WHERE app_id = ? ORDER BY last_opened_at DESC, id DESC').all(appId).map(rowToAppSession)
}

export function getProjectSnapshot(): ProjectSnapshot {
  const project = ensureProject()
  const appIds = new Set(listProjectAppsSync().map(item => item.manifest.id))
  return {
    path: project.path,
    config: project.config,
    apps: listProjectAppsSync(),
    appSessions: listAppSessions().filter(session => appIds.has(session.appId)),
    llmProviders: listLlmProviders(),
    llmInstances: listLlmInstances()
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

function json<T>(value: T): string {
  return JSON.stringify(value ?? null)
}

function normalizeName(value: string, fallback: string): string {
  return value.trim() || fallback
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

export async function deleteLlmProvider(id: number): Promise<ProjectSnapshot> {
  const project = ensureProject()
  getLlmProvider(id)
  project.db.prepare('UPDATE llm_instances SET provider_id = NULL WHERE provider_id = ?').run(id)
  project.db.prepare('DELETE FROM llm_providers WHERE id = ?').run(id)
  return getProjectSnapshot()
}

export function createLlmInstance(payload: LlmInstanceCreatePayload): LlmInstance {
  const project = ensureProject()
  if (payload.providerId !== null && payload.providerId !== undefined) getLlmProvider(payload.providerId)
  const now = nowIso()
  const orderRow = project.db.prepare('SELECT COALESCE(MAX(order_index), -1) + 1 AS next_order FROM llm_instances').get() as {
    next_order: number
  }
  const result = project.db.prepare(`
    INSERT INTO llm_instances (name, provider_id, model_id, extra_json, order_index, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    normalizeName(payload.name, '新实例'),
    payload.providerId ?? null,
    payload.modelId ?? '',
    json(asRecord(payload.extra)),
    Number(orderRow.next_order ?? 0),
    now,
    now
  )
  return getLlmInstance(Number(result.lastInsertRowid))
}

export function updateLlmInstance(payload: LlmInstanceUpdatePayload): LlmInstance {
  const project = ensureProject()
  getLlmInstance(payload.id)
  const provider = payload.providerId === null || payload.providerId === undefined ? null : getLlmProvider(payload.providerId)
  const now = nowIso()
  project.db.prepare(`
    UPDATE llm_instances
    SET name = ?, provider_id = ?, model_id = ?, extra_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    normalizeName(payload.name, '新实例'),
    provider?.id ?? null,
    payload.modelId ?? '',
    json(asRecord(payload.extra)),
    now,
    payload.id
  )
  return getLlmInstance(payload.id)
}

export async function deleteLlmInstance(id: number): Promise<ProjectSnapshot> {
  const project = ensureProject()
  getLlmInstance(id)
  project.db.prepare('DELETE FROM llm_instances WHERE id = ?').run(id)
  return getProjectSnapshot()
}

export function reorderLlmInstances(ids: number[]): ProjectSnapshot {
  const project = ensureProject()
  const currentIds = listLlmInstances().map(instance => instance.id)
  const uniqueIds = [...new Set(ids.map(id => Number(id)).filter(id => Number.isInteger(id)))]
  const expected = [...currentIds].sort((a, b) => a - b).join(',')
  const received = [...uniqueIds].sort((a, b) => a - b).join(',')
  if (expected !== received) {
    throw new Error('LLM 实例排序列表与当前数据不一致，请刷新后重试。')
  }

  const update = project.db.prepare('UPDATE llm_instances SET order_index = ?, updated_at = ? WHERE id = ?')
  const now = nowIso()
  project.db.transaction(() => {
    uniqueIds.forEach((id, index) => update.run(index, now, id))
  })()
  return getProjectSnapshot()
}

export function getAppSession(appId: string, id: number): AppSessionRecord {
  const project = ensureProject()
  const row = project.db.prepare('SELECT * FROM app_sessions WHERE app_id = ? AND id = ?').get(appId, id)
  if (!row) throw new Error('存档不存在。')
  return rowToAppSession(row)
}

function nextAppSessionId(appId: string): number {
  const project = ensureProject()
  const row = project.db.prepare('SELECT MAX(id) AS max_id FROM app_sessions WHERE app_id = ?').get(appId) as { max_id?: number | null }
  return Number(row?.max_id ?? -1) + 1
}

function appVersion(appId: string): number {
  const app = listProjectAppsSync().find(item => item.manifest.id === appId)
  if (!app) throw new Error('应用不存在。')
  return app.manifest.version
}

export async function createAppSession(payload: AppSessionCreatePayload): Promise<AppSessionRecord> {
  const project = ensureProject()
  const id = nextAppSessionId(payload.appId)
  const version = appVersion(payload.appId)
  const now = nowIso()
  const title = normalizeName(payload.title ?? '', `存档 ${id}`)
  project.db.prepare(`
    INSERT INTO app_sessions (app_id, id, title, version, created_at, updated_at, last_opened_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(payload.appId, id, title, version, now, now, now)
  await mkdir(appSessionSaveRoot(payload.appId, id), { recursive: true })
  return getAppSession(payload.appId, id)
}

export async function updateAppSession(payload: AppSessionUpdatePayload): Promise<AppSessionRecord> {
  const project = ensureProject()
  getAppSession(payload.appId, payload.id)
  const now = nowIso()
  project.db.prepare(`
    UPDATE app_sessions SET title = ?, updated_at = ? WHERE app_id = ? AND id = ?
  `).run(normalizeName(payload.title, `存档 ${payload.id}`), now, payload.appId, payload.id)
  return getAppSession(payload.appId, payload.id)
}

export async function touchAppSession(appId: string, id: number): Promise<AppSessionRecord> {
  const project = ensureProject()
  getAppSession(appId, id)
  const now = nowIso()
  project.db.prepare(`
    UPDATE app_sessions SET last_opened_at = ?, updated_at = ? WHERE app_id = ? AND id = ?
  `).run(now, now, appId, id)
  return getAppSession(appId, id)
}

export async function deleteAppSession(appId: string, id: number): Promise<ProjectSnapshot> {
  const project = ensureProject()
  getAppSession(appId, id)
  project.db.prepare('DELETE FROM app_sessions WHERE app_id = ? AND id = ?').run(appId, id)
  await rm(appSessionSaveRoot(appId, id), { recursive: true, force: true })
  return getProjectSnapshot()
}

export async function deleteAppSessionsForApp(appId: string): Promise<void> {
  const project = ensureProject()
  project.db.prepare('DELETE FROM app_sessions WHERE app_id = ?').run(appId)
  await rm(appSaveRoot(appId), { recursive: true, force: true })
}
