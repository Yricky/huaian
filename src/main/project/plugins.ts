import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises'
import { readdirSync, readFileSync, statSync } from 'fs'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import type { JsonRecord, PluginDescriptor, PluginFileEntry, PluginManifest } from '../../shared/types'
import { asRecord, asString } from '../../shared/value-utils'
import { BUILTIN_PLUGINS } from './builtin-plugins'
import { ensureProject, getCurrentProject } from './state'

const PLUGIN_ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

const sampleCharacter = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: 'Mira',
    description: 'Mira is a careful and curious archivist.',
    personality: 'Patient, observant, dryly funny.',
    scenario: 'Mira is helping test the plugin-based chat runtime.',
    first_mes: 'Hello. I have the files open and the tea cooling beside them.',
    mes_example: '',
    system_prompt: 'Write {{char}}\'s next reply in a fictional chat between {{char}} and {{user}}.',
    post_history_instructions: '',
    alternate_greetings: [],
    tags: ['sample'],
    extensions: {
      depth_prompt: {
        prompt: '',
        depth: 4,
        role: 'system'
      }
    }
  }
}

const sampleWorldBook = {
  name: 'Sample WorldBook',
  entries: [
    {
      id: 1,
      keys: ['archive'],
      secondary_keys: [],
      comment: 'Archive',
      content: 'Mira keeps a meticulous archive of conversations and discoveries.',
      constant: false,
      selective: false,
      insertion_order: 100,
      enabled: true,
      position: 'before_char',
      extensions: {
        position: 0,
        depth: 4,
        role: 0,
        probability: 100,
        useProbability: true,
        selectiveLogic: 0
      }
    }
  ]
}

const samplePromptTemplateConfig = {
  enabled: true,
  renderMessages: true,
  globalVariables: {}
}

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
      initChat: asString(entry.initChat) || undefined,
      chatBlockProcessor: asString(entry.chatBlockProcessor) || undefined,
      toolCalls: Array.isArray(entry.toolCalls)
        ? entry.toolCalls.map(item => {
            const toolCall = asRecord(item)
            return {
              name: asString(toolCall.name),
              label: asString(toolCall.label) || undefined,
              handler: asString(toolCall.handler) || undefined,
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

async function writeIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await stat(filePath)
  } catch {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, content, 'utf-8')
  }
}

async function ensureBuiltinPluginData(): Promise<void> {
  const sillyTavernRoot = pluginDataRoot('silly_tavern_compat')
  const promptTemplateRoot = pluginDataRoot('st_prompt_template_compat')
  await Promise.all([
    writeIfMissing(join(sillyTavernRoot, 'characters', 'mira.json'), `${JSON.stringify(sampleCharacter, null, 2)}\n`),
    writeIfMissing(join(sillyTavernRoot, 'worldbooks', 'sample_worldbook.json'), `${JSON.stringify(sampleWorldBook, null, 2)}\n`),
    writeIfMissing(join(promptTemplateRoot, 'config.json'), `${JSON.stringify(samplePromptTemplateConfig, null, 2)}\n`)
  ])
}

export async function ensureProjectPlugins(): Promise<void> {
  const project = ensureProject()
  await Promise.all([
    mkdir(project.pluginsPath, { recursive: true }),
    mkdir(project.pluginDataPath, { recursive: true })
  ])

  for (const plugin of BUILTIN_PLUGINS) {
    const root = pluginRoot(plugin.id)
    await mkdir(root, { recursive: true })
    for (const file of plugin.files) {
      await writeIfMissing(safeChildPath(root, file.path), file.content)
    }
    await mkdir(pluginDataRoot(plugin.id), { recursive: true })
  }
  await ensureBuiltinPluginData()
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
      const manifest = normalizePluginManifest(JSON.parse(await readFile(join(root, 'plugin.json'), 'utf-8')))
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
        const manifest = normalizePluginManifest(JSON.parse(readFileSync(join(root, 'plugin.json'), 'utf-8')))
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

export async function writePluginDataFile(pluginId: string, path: string, content: string): Promise<void> {
  const filePath = safeChildPath(pluginDataRoot(pluginId), path)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf-8')
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
  return entries
    .map(entry => {
      const relativePath = [path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''), entry.name].filter(Boolean).join('/')
      return {
        name: entry.name,
        path: relativePath,
        isDirectory: entry.isDirectory()
      }
    })
    .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name))
}

export function pluginAssetPath(pluginId: string, path: string): string {
  return safeChildPath(pluginRoot(pluginId), path)
}
