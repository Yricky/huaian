import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises'
import { readdirSync, readFileSync, statSync } from 'fs'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import type {
  AppDescriptor,
  AppFileEntry,
  AppManifest,
  AppStorageDeleteOptions,
  AppStorageKind,
  JsonRecordValue
} from '../../shared/types'
import { asRecord, asString } from '@huaian/app-api/value-utils'
import { ensureProject, getCurrentProject } from './state'
import { extractZipFile } from './zip'

const APP_ID_RE = /^[A-Za-z0-9_.-]+$/

function isInDirectory(filePath: string, directoryPath: string): boolean {
  const directoryRelativePath = relative(directoryPath, filePath)
  return directoryRelativePath === '' || (!directoryRelativePath.startsWith('..') && !isAbsolute(directoryRelativePath))
}

export function assertAppId(appId: string): void {
  if (!APP_ID_RE.test(appId) || appId === '.' || appId === '..') {
    throw new Error(`应用 id 不合法：${appId}`)
  }
}

function normalizeAppManifest(value: JsonRecordValue): AppManifest | null {
  const record = asRecord(value)
  const id = asString(record.id).trim()
  const version = Number(record.version)
  if (!APP_ID_RE.test(id) || id === '.' || id === '..' || !Number.isInteger(version)) return null
  return {
    id,
    name: asString(record.name),
    description: asString(record.description),
    version,
    icon: asString(record.icon) || undefined
  }
}

export function appRoot(appId: string): string {
  assertAppId(appId)
  return resolve(ensureProject().appPath, appId)
}

export function appDataRoot(appId: string): string {
  assertAppId(appId)
  return resolve(ensureProject().appDataPath, appId)
}

export function appSaveRoot(appId: string): string {
  assertAppId(appId)
  return resolve(ensureProject().appSavePath, appId)
}

export function appSessionSaveRoot(appId: string, appSessionId: number): string {
  assertAppId(appId)
  if (!Number.isInteger(appSessionId) || appSessionId < 0) throw new Error('存档 id 不合法。')
  return resolve(appSaveRoot(appId), String(appSessionId))
}

function safeChildPath(root: string, childPath = ''): string {
  const normalized = childPath.replace(/\\/g, '/').replace(/^\/+/, '')
  const filePath = resolve(root, normalized)
  if (!isInDirectory(filePath, root)) throw new Error('路径不能离开应用目录。')
  return filePath
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

async function readAppManifest(root: string): Promise<AppManifest | null> {
  try {
    return normalizeAppManifest(JSON.parse(await readFile(join(root, 'app.json'), 'utf-8')))
  } catch {
    return null
  }
}

function readAppManifestSync(root: string): AppManifest | null {
  try {
    return normalizeAppManifest(JSON.parse(readFileSync(join(root, 'app.json'), 'utf-8')))
  } catch {
    return null
  }
}

export async function ensureProjectApps(): Promise<void> {
  const project = ensureProject()
  await Promise.all([
    mkdir(project.appPath, { recursive: true }),
    mkdir(project.appDataPath, { recursive: true }),
    mkdir(project.appSavePath, { recursive: true })
  ])
}

export async function listProjectApps(): Promise<AppDescriptor[]> {
  const project = getCurrentProject()
  if (!project) return []
  await ensureProjectApps()
  const names = await readdir(project.appPath).catch(() => [])
  const manifests = await Promise.all(names.map(async name => {
    try {
      const root = safeChildPath(project.appPath, name)
      const stats = await stat(root)
      if (!stats.isDirectory()) return null
      const manifest = await readAppManifest(root)
      return manifest ? { manifest, source: 'project' as const } : null
    } catch {
      return null
    }
  }))
  return manifests
    .filter((item): item is AppDescriptor => item !== null)
    .sort((a, b) => a.manifest.name?.localeCompare(b.manifest.name ?? '') || a.manifest.id.localeCompare(b.manifest.id))
}

export function listProjectAppsSync(): AppDescriptor[] {
  const project = getCurrentProject()
  if (!project) return []
  try {
    return readdirSync(project.appPath).map(name => {
      try {
        const root = safeChildPath(project.appPath, name)
        if (!statSync(root).isDirectory()) return null
        const manifest = readAppManifestSync(root)
        return manifest ? { manifest, source: 'project' as const } : null
      } catch {
        return null
      }
    }).filter((item): item is AppDescriptor => item !== null)
      .sort((a, b) => a.manifest.name?.localeCompare(b.manifest.name ?? '') || a.manifest.id.localeCompare(b.manifest.id))
  } catch {
    return []
  }
}

export async function installAppZip(zipPath: string): Promise<AppDescriptor> {
  const project = ensureProject()
  await ensureProjectApps()
  const tempRoot = safeChildPath(project.appPath, `.installing-${Date.now()}`)
  await rm(tempRoot, { recursive: true, force: true })
  try {
    await extractZipFile(zipPath, tempRoot)
    const manifest = await readAppManifest(tempRoot)
    if (!manifest) throw new Error('应用包缺少有效的 app.json。')
    if (!await pathExists(join(tempRoot, 'index.html'))) throw new Error('应用包根目录缺少 index.html。')

    const root = appRoot(manifest.id)
    await rm(root, { recursive: true, force: true })
    await rename(tempRoot, root)
    await Promise.all([
      mkdir(appDataRoot(manifest.id), { recursive: true }),
      mkdir(appSaveRoot(manifest.id), { recursive: true })
    ])
    return { manifest, source: 'project' }
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true })
    throw error
  }
}

export async function uninstallApp(appId: string, options: { deleteConfigData: boolean; deleteAllSaves: boolean }): Promise<void> {
  await rm(appRoot(appId), { recursive: true, force: true })
  if (options.deleteConfigData) await rm(appDataRoot(appId), { recursive: true, force: true })
  if (options.deleteAllSaves) await rm(appSaveRoot(appId), { recursive: true, force: true })
}

export function appAssetRoot(appId: string): string {
  return appRoot(appId)
}

export function appAssetPath(appId: string, path: string): string {
  return safeChildPath(appRoot(appId), path || 'index.html')
}

function storageRoot(kind: AppStorageKind, appId: string, appSessionId: number | null): string {
  return kind === 'appData'
    ? appDataRoot(appId)
    : appSessionSaveRoot(appId, Number(appSessionId))
}

async function ensureStorageRoot(kind: AppStorageKind, appId: string, appSessionId: number | null): Promise<string> {
  const root = storageRoot(kind, appId, appSessionId)
  await mkdir(root, { recursive: true })
  return root
}

export async function listAppStorageFiles(
  kind: AppStorageKind,
  appId: string,
  appSessionId: number | null,
  path = ''
): Promise<AppFileEntry[]> {
  const root = await ensureStorageRoot(kind, appId, appSessionId)
  const directory = safeChildPath(root, path)
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  return Promise.all(entries.map(async entry => {
    const childPath = path ? `${path.replace(/\\/g, '/').replace(/\/+$/, '')}/${entry.name}` : entry.name
    const filePath = safeChildPath(root, childPath)
    const stats = await stat(filePath).catch(() => null)
    return {
      name: entry.name,
      path: childPath,
      isDirectory: entry.isDirectory(),
      size: stats?.isFile() ? stats.size : undefined
    }
  }))
}

export async function makeAppStorageDirectory(
  kind: AppStorageKind,
  appId: string,
  appSessionId: number | null,
  path: string
): Promise<void> {
  const root = await ensureStorageRoot(kind, appId, appSessionId)
  await mkdir(safeChildPath(root, path), { recursive: true })
}

export async function readAppStorageFile(
  kind: AppStorageKind,
  appId: string,
  appSessionId: number | null,
  path: string
): Promise<string> {
  try {
    return await readFile(safeChildPath(await ensureStorageRoot(kind, appId, appSessionId), path), 'utf-8')
  } catch (error) {
    if (asRecord(error).code === 'ENOENT') return ''
    throw error
  }
}

export async function readAppStorageFileBytes(
  kind: AppStorageKind,
  appId: string,
  appSessionId: number | null,
  path: string
): Promise<ArrayBuffer> {
  try {
    const bytes = await readFile(safeChildPath(await ensureStorageRoot(kind, appId, appSessionId), path))
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  } catch (error) {
    if (asRecord(error).code === 'ENOENT') return new ArrayBuffer(0)
    throw error
  }
}

export async function writeAppStorageFile(
  kind: AppStorageKind,
  appId: string,
  appSessionId: number | null,
  path: string,
  content: string
): Promise<void> {
  const filePath = safeChildPath(await ensureStorageRoot(kind, appId, appSessionId), path)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf-8')
}

export async function writeAppStorageFileBytes(
  kind: AppStorageKind,
  appId: string,
  appSessionId: number | null,
  path: string,
  content: ArrayBuffer
): Promise<void> {
  const filePath = safeChildPath(await ensureStorageRoot(kind, appId, appSessionId), path)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, Buffer.from(content))
}

export async function deleteAppStoragePath(
  kind: AppStorageKind,
  appId: string,
  appSessionId: number | null,
  path: string,
  options: AppStorageDeleteOptions = {}
): Promise<void> {
  const root = await ensureStorageRoot(kind, appId, appSessionId)
  await rm(safeChildPath(root, path), { force: true, recursive: options.recursive === true })
}
