import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises'
import { readdirSync, readFileSync, statSync } from 'fs'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import type { JsonRecord, PluginDescriptor, PluginFileEntry, PluginManifest } from '../../shared/types'
import { asRecord, asString } from '../../shared/value-utils'
import { ensureProject, getCurrentProject } from './state'
import { extractZipFile } from './zip'

const PLUGIN_ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const BUILTIN_PLUGIN_IDS = ['silly_tavern_compat', 'character_card_tool_calls', 'st_prompt_template_compat']

function isInDirectory(filePath: string, directoryPath: string): boolean {
  const directoryRelativePath = relative(directoryPath, filePath)
  return directoryRelativePath === '' || (!directoryRelativePath.startsWith('..') && !isAbsolute(directoryRelativePath))
}

function assertPluginId(pluginId: string): void {
  if (pluginId === 'base' || !PLUGIN_ID_RE.test(pluginId)) {
    throw new Error(`插件 id 不合法：${pluginId}`)
  }
}

function normalizePluginManifest(value: unknown): PluginManifest | null {
  const record = asRecord(value)
  const id = asString(record.id).trim()
  if (id === 'base' || !PLUGIN_ID_RE.test(id)) return null
  const entry = asRecord(record.entry)
  return {
    id,
    name: asString(record.name),
    description: asString(record.description),
    versionCode: Number.isInteger(Number(record.versionCode)) ? Number(record.versionCode) : 1,
    dependencies: Array.isArray(record.dependencies)
      ? record.dependencies.map(item => asString(item).trim()).filter(Boolean)
      : [],
    entry: Object.keys(entry).length ? {
      initGlobal: asString(entry.initGlobal) || undefined,
      toolCalls: Array.isArray(entry.toolCalls)
        ? entry.toolCalls.map(item => {
            const toolCall = asRecord(item)
            return {
              name: asString(toolCall.name),
              label: asString(toolCall.label) || undefined,
              prompt: asString(toolCall.prompt) || undefined,
              settingsHtml: asString(toolCall.settingsHtml) || undefined,
              tools: Array.isArray(toolCall.tools)
                ? toolCall.tools.map(tool => {
                    const schema = asRecord(tool)
                    return {
                      name: asString(schema.name),
                      description: asString(schema.description),
                      inputSchema: asRecord(schema.inputSchema)
                    }
                  }).filter(tool => tool.name)
                : []
            }
          }).filter(toolCall => toolCall.name)
        : [],
      settingsHtml: asString(entry.settingsHtml) || undefined,
      chatHtml: asString(entry.chatHtml) || undefined
    } : undefined
  }
}

function pluginRoot(pluginId: string): string {
  assertPluginId(pluginId)
  return resolve(ensureProject().pluginsPath, pluginId)
}

function pluginDataRoot(pluginId: string): string {
  assertPluginId(pluginId)
  return resolve(ensureProject().pluginDataPath, pluginId)
}

function safeChildPath(root: string, childPath = ''): string {
  const normalized = childPath.replace(/\\/g, '/').replace(/^\/+/, '')
  const filePath = resolve(root, normalized)
  if (!isInDirectory(filePath, root)) throw new Error('路径不能离开插件目录。')
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

async function directoryExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isDirectory()
  } catch {
    return false
  }
}

async function readPluginManifest(root: string): Promise<PluginManifest | null> {
  for (const fileName of ['plugin.json', 'manifest.json']) {
    try {
      return normalizePluginManifest(JSON.parse(await readFile(join(root, fileName), 'utf-8')))
    } catch {
      // Try the next supported manifest file name.
    }
  }
  return null
}

function readPluginManifestSync(root: string): PluginManifest | null {
  for (const fileName of ['plugin.json', 'manifest.json']) {
    try {
      return normalizePluginManifest(JSON.parse(readFileSync(join(root, fileName), 'utf-8')))
    } catch {
      // Try the next supported manifest file name.
    }
  }
  return null
}

function builtinPluginZipPath(pluginId: string): string {
  return join(__dirname, 'builtin-plugins', `${pluginId}.zip`)
}

async function installBuiltinPlugin(pluginId: string): Promise<void> {
  const root = pluginRoot(pluginId)
  const rootExists = await directoryExists(root)
  const zipPath = builtinPluginZipPath(pluginId)

  if (!await pathExists(zipPath)) {
    if (rootExists) {
      await mkdir(pluginDataRoot(pluginId), { recursive: true })
      return
    }
    throw new Error(`内置插件资源缺失：${zipPath}。请先运行 pnpm build:plugins。`)
  }

  const project = ensureProject()
  const tempRoot = safeChildPath(project.pluginsPath, `.${pluginId}.installing-${Date.now()}`)
  await rm(tempRoot, { recursive: true, force: true })
  try {
    await extractZipFile(zipPath, tempRoot)
    const bundledManifest = await readPluginManifest(tempRoot)
    if (bundledManifest?.id !== pluginId) throw new Error(`内置插件包 id 不匹配：${pluginId}`)

    const installedManifest = rootExists ? await readPluginManifest(root) : null
    const installedVersion = Number(installedManifest?.versionCode ?? 0)
    const bundledVersion = Number(bundledManifest.versionCode ?? 1)
    if (rootExists && installedVersion >= bundledVersion) {
      await rm(tempRoot, { recursive: true, force: true })
      await mkdir(pluginDataRoot(pluginId), { recursive: true })
      return
    }

    await rm(root, { recursive: true, force: true })
    await rename(tempRoot, root)
    await mkdir(pluginDataRoot(pluginId), { recursive: true })
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true })
    throw error
  }
}

export async function ensureProjectPlugins(): Promise<void> {
  const project = ensureProject()
  await Promise.all([
    mkdir(project.pluginsPath, { recursive: true }),
    mkdir(project.pluginDataPath, { recursive: true })
  ])

  for (const pluginId of BUILTIN_PLUGIN_IDS) {
    await installBuiltinPlugin(pluginId)
  }
}

export async function listProjectPlugins(): Promise<PluginDescriptor[]> {
  const project = getCurrentProject()
  if (!project) return []
  await ensureProjectPlugins()
  const names = await readdir(project.pluginsPath).catch(() => [])
  const manifests = await Promise.all(names.map(async name => {
    try {
      const root = safeChildPath(project.pluginsPath, name)
      const stats = await stat(root)
      if (!stats.isDirectory()) return null
      const manifest = await readPluginManifest(root)
      return manifest ? { manifest, source: 'project' as const } : null
    } catch {
      return null
    }
  }))
  return sortPluginsByDependencies(manifests.filter((item): item is PluginDescriptor => item !== null))
}

export function listProjectPluginsSync(): PluginDescriptor[] {
  const project = getCurrentProject()
  if (!project) return []
  try {
    const plugins = readdirSync(project.pluginsPath).map(name => {
      try {
        const root = safeChildPath(project.pluginsPath, name)
        if (!statSync(root).isDirectory()) return null
        const manifest = readPluginManifestSync(root)
        return manifest ? { manifest, source: 'project' as const } : null
      } catch {
        return null
      }
    }).filter((item): item is PluginDescriptor => item !== null)
    return sortPluginsByDependencies(plugins)
  } catch {
    return []
  }
}

export function sortPluginsByDependencies(plugins: PluginDescriptor[]): PluginDescriptor[] {
  const byId = new Map(plugins.map(plugin => [plugin.manifest.id, plugin]))
  const permanent = new Set<string>()
  const temporary = new Set<string>()
  const sorted: PluginDescriptor[] = []

  function visit(id: string, chain: string[]): void {
    if (permanent.has(id)) return
    if (temporary.has(id)) throw new Error(`插件存在循环依赖：${[...chain, id].join(' -> ')}`)
    const plugin = byId.get(id)
    if (!plugin) return
    temporary.add(id)
    for (const dependencyId of plugin.manifest.dependencies ?? []) {
      visit(dependencyId, [...chain, id])
    }
    temporary.delete(id)
    permanent.add(id)
    sorted.push(plugin)
  }

  for (const plugin of plugins) visit(plugin.manifest.id, [])
  return sorted
}

export async function readPluginFile(pluginId: string, path: string): Promise<string> {
  return readFile(safeChildPath(pluginRoot(pluginId), path), 'utf-8')
}

export async function readPluginDataFile(pluginId: string, path: string): Promise<string> {
  try {
    return await readFile(safeChildPath(pluginDataRoot(pluginId), path), 'utf-8')
  } catch (error) {
    if (asRecord(error).code === 'ENOENT') return ''
    throw error
  }
}

export async function readPluginDataFileBase64(pluginId: string, path: string): Promise<string> {
  try {
    return (await readFile(safeChildPath(pluginDataRoot(pluginId), path))).toString('base64')
  } catch (error) {
    if (asRecord(error).code === 'ENOENT') return ''
    throw error
  }
}

export async function writePluginDataFile(pluginId: string, path: string, content: string): Promise<void> {
  const filePath = safeChildPath(pluginDataRoot(pluginId), path)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf-8')
}

export async function writePluginDataFileBase64(pluginId: string, path: string, content: string): Promise<void> {
  const filePath = safeChildPath(pluginDataRoot(pluginId), path)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, Buffer.from(content, 'base64'))
}

export async function deletePluginDataFile(pluginId: string, path: string): Promise<void> {
  await rm(safeChildPath(pluginDataRoot(pluginId), path), { force: true })
}

export async function readPluginDataJson(pluginId: string, path: string, fallback: JsonRecord = {}): Promise<JsonRecord> {
  try {
    return asRecord(JSON.parse(await readPluginDataFile(pluginId, path)))
  } catch {
    return fallback
  }
}

export async function writePluginDataJson(pluginId: string, path: string, value: unknown): Promise<void> {
  await writePluginDataFile(pluginId, path, `${JSON.stringify(value, null, 2)}\n`)
}

export async function listPluginDataFiles(pluginId: string, path = ''): Promise<PluginFileEntry[]> {
  const root = pluginDataRoot(pluginId)
  const directoryPath = safeChildPath(root, path)
  await mkdir(directoryPath, { recursive: true })
  const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => [])
  const files = await Promise.all(entries.map(async entry => {
      const relativePath = [path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''), entry.name].filter(Boolean).join('/')
      const entryStats = await stat(safeChildPath(root, relativePath)).catch(() => null)
      return {
        name: entry.name,
        path: relativePath,
        isDirectory: entry.isDirectory(),
        size: entryStats?.size
      }
    }))
  return files
    .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name))
}

export function pluginAssetPath(pluginId: string, path: string): string {
  return safeChildPath(pluginRoot(pluginId), path)
}

export function pluginAssetRoot(pluginId: string): string {
  return pluginRoot(pluginId)
}
