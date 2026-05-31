import vm from 'node:vm'
import { createRequire } from 'node:module'
import ejs from 'ejs'
import { z } from 'zod'
import type {
  ChatBlock,
  ChatContentPart,
  ChatGenerationPreviewMessage,
  ChatSession,
  CharacterEntry,
  JsonRecord,
  LoreBook,
  PromptTemplateDiagnostic,
  PromptTemplateSettings,
  PromptTemplateVariables,
  WorldEntry
} from '../../shared/types'
import type { InjectionPreviewBlock } from '../../shared/st-prompt-builder'
import { chatBlockTargetRole } from '../../shared/chat-blocks'
import { characterData, characterName, replaceCharacterMacros } from '../../shared/st-regex-scripts'
import { asBoolean, asNumber, asRecord, asString } from '../../shared/value-utils'

const requireModule = createRequire(__filename)
const { jsonrepair } = requireModule('jsonrepair') as { jsonrepair: (text: string) => string }
let fakerPromise: Promise<unknown> | null = null
const directTemplateCompileCache = new Map<string, Function>()
const sandboxTemplateSourceCache = new Map<string, string>()
const JS_IDENTIFIER_RE = /^[a-zA-Z_$][0-9a-zA-Z_$]*$/

function loadFaker(): Promise<unknown> {
  fakerPromise ??= import('@faker-js/faker').then(module => module.faker)
  return fakerPromise
}

function compileTemplate(content: string, options: JsonRecord, cacheKey: string | null, cacheSize: number): Function {
  if (!cacheKey || cacheSize <= 0) return ejs.compile(content, options as any) as Function
  const cached = directTemplateCompileCache.get(cacheKey)
  if (cached) {
    directTemplateCompileCache.delete(cacheKey)
    directTemplateCompileCache.set(cacheKey, cached)
    return cached
  }
  const compiled = ejs.compile(content, options as any) as Function
  directTemplateCompileCache.set(cacheKey, compiled)
  while (directTemplateCompileCache.size > cacheSize) {
    const oldest = directTemplateCompileCache.keys().next().value
    if (!oldest) break
    directTemplateCompileCache.delete(oldest)
  }
  return compiled
}

function compileSandboxTemplateSource(content: string, options: JsonRecord, cacheKey: string | null, cacheSize: number): string {
  if (cacheKey && cacheSize > 0) {
    const cached = sandboxTemplateSourceCache.get(cacheKey)
    if (cached) {
      sandboxTemplateSourceCache.delete(cacheKey)
      sandboxTemplateSourceCache.set(cacheKey, cached)
      return cached
    }
  }

  const Template = (ejs as any).Template
  const template = new Template(content, options)
  template.generateSource()
  const opts = template.opts
  let prepended = '  var __output = "";\n  function __append(s) { if (s !== undefined && s !== null) __output += s }\n'
  let appended = ''

  if (opts.outputFunctionName) {
    if (!JS_IDENTIFIER_RE.test(opts.outputFunctionName)) throw new Error('outputFunctionName is not a valid JS identifier.')
    prepended += `  var ${opts.outputFunctionName} = __append;\n`
  }
  if (opts.localsName && !JS_IDENTIFIER_RE.test(opts.localsName)) throw new Error('localsName is not a valid JS identifier.')
  if (Array.isArray(opts.destructuredLocals) && opts.destructuredLocals.length) {
    let destructuring = `  var __locals = (${opts.localsName} || {}),\n`
    for (let index = 0; index < opts.destructuredLocals.length; index += 1) {
      const name = opts.destructuredLocals[index]
      if (!JS_IDENTIFIER_RE.test(name)) throw new Error(`destructuredLocals[${index}] is not a valid JS identifier.`)
      destructuring += `${index > 0 ? ',\n  ' : '  '}${name} = __locals.${name}`
    }
    prepended += `${destructuring};\n`
  }
  if (opts._with !== false) {
    prepended += `  with (${opts.localsName} || {}) {\n`
    appended += '  }\n'
  }
  appended += '  return __output;\n'

  let source = prepended + template.source + appended
  if (opts.compileDebug) {
    const filename = opts.filename ? JSON.stringify(opts.filename) : 'undefined'
    source = '  var __line = 1\n'
      + `  , __lines = ${JSON.stringify(template.templateText)}\n`
      + `  , __filename = ${filename};\n`
      + 'try {\n'
      + source
      + '} catch (e) {\n'
      + '  rethrow(e, __lines, __filename, __line, escapeFn);\n'
      + '}\n'
  }
  if (opts.strict) source = `"use strict";\n${source}`

  const functionSource = `${opts.async ? 'async ' : ''}function(${opts.localsName}, escapeFn, include, rethrow) {\n${source}\n}`
  if (cacheKey && cacheSize > 0) {
    sandboxTemplateSourceCache.set(cacheKey, functionSource)
    while (sandboxTemplateSourceCache.size > cacheSize) {
      const oldest = sandboxTemplateSourceCache.keys().next().value
      if (!oldest) break
      sandboxTemplateSourceCache.delete(oldest)
    }
  }
  return functionSource
}

type TemplatePhase = PromptTemplateDiagnostic['phase']
type TemplateRole = 'system' | 'user' | 'assistant'
type TemplateRunType = 'generate' | 'render_permanent' | 'render'

export interface RuntimeWorldEntry extends WorldEntry {
  decorators: string[]
  cleanContent: string
}

interface PromptTemplateRuntimeInput {
  chat: ChatSession
  characters: CharacterEntry[]
  loreBooks: LoreBook[]
  worldEntries: WorldEntry[]
  blocks: ChatBlock[]
  settings: PromptTemplateSettings
  globalVariables: JsonRecord
  initialVariables?: JsonRecord
  messageVariablesByBlockId?: Map<number, JsonRecord>
  dryRun?: boolean
}

export interface PromptTemplatePreprocessResult {
  worldEntries: WorldEntry[]
  specialEntries: RuntimeWorldEntry[]
  diagnostics: PromptTemplateDiagnostic[]
  variables: PromptTemplateVariables
  globalVariables: JsonRecord
  localVariables: JsonRecord
  messageVariablesByBlockId: Map<number, JsonRecord>
}

export interface PromptTemplateGenerationResult {
  messages: ChatGenerationPreviewMessage[]
  virtualBlocks: InjectionPreviewBlock[]
  diagnostics: PromptTemplateDiagnostic[]
  variables: PromptTemplateVariables
  globalVariables: JsonRecord
  localVariables: JsonRecord
  messageVariablesByBlockId: Map<number, JsonRecord>
}

export interface PromptTemplateOutputResult {
  contentParts: ChatContentPart[]
  diagnostics: PromptTemplateDiagnostic[]
  variables: PromptTemplateVariables
  globalVariables: JsonRecord
  localVariables: JsonRecord
  messageVariables: JsonRecord
}

export interface PromptTemplateBlockProjectionResult {
  contentParts: ChatContentPart[]
  diagnostics: PromptTemplateDiagnostic[]
  variables: PromptTemplateVariables
}

interface RegexInjection {
  search: string | RegExp
  replace: string | ((substring: string, ...args: string[]) => string)
  scope: 'generate' | 'message'
  role?: TemplateRole
  order: number
  sticky: number
}

interface PromptInjection {
  prompt: string
  order: number
  sticky: number
  uid: string
}

interface VariableMutationOptions {
  scope?: 'global' | 'local' | 'message' | 'cache' | 'initial'
  flags?: 'nx' | 'xx' | 'n' | 'nxs' | 'xxs'
  results?: 'old' | 'new' | 'fullcache'
  index?: number | string
  defaults?: unknown
  merge?: boolean
  clone?: boolean
  dryRun?: boolean
}

interface InjectInstruction {
  type: 'pos' | 'target' | 'regex'
  role: TemplateRole
  content: string
  order: number
  entry: RuntimeWorldEntry
  pos?: number
  target?: TemplateRole
  targetIndex?: number
  targetAt?: 'before' | 'after'
  regex?: string
  regexAt?: 'before' | 'after'
}

const TEMPLATE_MARKER = '<%'
const DEFAULT_USER_NAME = 'User'
const DECORATOR_RE = /^\s*@@([a-zA-Z_][\w-]*)(?:\s+(.*))?\s*$/

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null))
}

function diagnostic(
  level: PromptTemplateDiagnostic['level'],
  phase: TemplatePhase,
  message: string,
  patch: Omit<PromptTemplateDiagnostic, 'level' | 'phase' | 'message'> = {}
): PromptTemplateDiagnostic {
  return { level, phase, message, ...patch }
}

function textContent(content: string | ChatContentPart[]): string {
  if (typeof content === 'string') return content
  return content.map(part => part.type === 'text' ? part.text : '').join('')
}

function messageWithContent(message: ChatGenerationPreviewMessage, content: string): ChatGenerationPreviewMessage {
  if (typeof message.content === 'string') return { ...message, content }
  const next = [...message.content]
  const index = next.findIndex(part => part.type === 'text')
  if (index >= 0 && next[index].type === 'text') {
    next[index] = { ...next[index], text: content }
    return { ...message, content: next }
  }
  return { ...message, content: [{ type: 'text', text: content }, ...next] }
}

function blockText(block: Pick<ChatBlock, 'contentParts'>): string {
  return block.contentParts.map(part => {
    if (part.type === 'text') return part.text
    if (part.type !== 'tool_call' || part.sendAsContext !== true) return ''
    return [
      `[Tool call: ${part.toolName}]`,
      `input: ${JSON.stringify(part.input)}`,
      part.status === 'success' ? `output: ${JSON.stringify(part.output ?? null)}` : '',
      part.status === 'error' ? `error: ${part.error ?? ''}` : ''
    ].filter(Boolean).join('\n')
  }).join('')
}

function roleForBlock(block: ChatBlock): TemplateRole {
  if (block.kind === 'tool_definition') return 'system'
  return chatBlockTargetRole(block)
}

function splitPath(path: string | null): Array<string | number> {
  if (path === null || path === '') return []
  const parts: Array<string | number> = []
  const re = /[^.[\]]+|\[(?:(-?\d+)|"([^"]*)"|'([^']*)')\]/g
  let match: RegExpExecArray | null
  while ((match = re.exec(path)) !== null) {
    if (match[1] !== undefined) parts.push(Number(match[1]))
    else parts.push(match[2] ?? match[3] ?? match[0])
  }
  return parts
}

function getPath(value: unknown, path: string | null, fallback?: unknown): unknown {
  const parts = splitPath(path)
  if (!parts.length) return value ?? fallback
  let cursor: any = value
  for (const part of parts) {
    if (cursor === null || cursor === undefined) return fallback
    cursor = cursor[part as any]
  }
  return cursor === undefined ? fallback : cursor
}

function hasPath(value: unknown, path: string | null): boolean {
  const sentinel = Symbol('missing')
  return getPath(value, path, sentinel) !== sentinel
}

function setPath(target: any, path: string | null, value: unknown): unknown {
  const parts = splitPath(path)
  if (!parts.length) return value
  let cursor = target
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index]
    const nextPart = parts[index + 1]
    if (cursor[part as any] === undefined || cursor[part as any] === null || typeof cursor[part as any] !== 'object') {
      cursor[part as any] = typeof nextPart === 'number' ? [] : {}
    }
    cursor = cursor[part as any]
  }
  cursor[parts[parts.length - 1] as any] = value
  return target
}

function unsetPath(target: any, path: string | null): unknown {
  const parts = splitPath(path)
  if (!parts.length) return {}
  let cursor = target
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor = cursor?.[parts[index] as any]
    if (!cursor || typeof cursor !== 'object') return target
  }
  delete cursor[parts[parts.length - 1] as any]
  return target
}

function deepMerge(base: JsonRecord, incoming: unknown): JsonRecord {
  const source = asRecord(incoming)
  for (const [key, value] of Object.entries(source)) {
    const current = base[key]
    if (Array.isArray(current) && Array.isArray(value)) {
      base[key] = [...current, ...value]
    } else if (
      current &&
      typeof current === 'object' &&
      !Array.isArray(current) &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      base[key] = deepMerge(asRecord(current), value)
    } else {
      base[key] = cloneJson(value)
    }
  }
  return base
}

function variableOptions(value: unknown): VariableMutationOptions {
  if (typeof value === 'string') {
    if (value === 'global' || value === 'local' || value === 'message' || value === 'cache' || value === 'initial') {
      return { scope: value }
    }
    if (value === 'nx' || value === 'xx' || value === 'n' || value === 'nxs' || value === 'xxs') return { flags: value }
    if (value === 'old' || value === 'new' || value === 'fullcache') return { results: value }
    return {}
  }
  if (typeof value === 'boolean') return { dryRun: value }
  return asRecord(value) as VariableMutationOptions
}

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&#34;')
    .replace(/'/g, '&#39;')
}

function parseRegex(value: string): RegExp | null {
  if (!value.startsWith('/')) return null
  const lastSlash = value.lastIndexOf('/')
  if (lastSlash <= 0) return null
  const flags = value.slice(lastSlash + 1)
  if (!/^[gimsuy]*$/.test(flags)) return null
  try {
    return new RegExp(value.slice(1, lastSlash), flags)
  } catch {
    return null
  }
}

function normalizeRuntimeEntry(entry: WorldEntry): RuntimeWorldEntry {
  const decorators: string[] = []
  const cleanLines: string[] = []
  for (const line of entry.stData.content.split(/\r?\n/)) {
    const match = line.match(DECORATOR_RE)
    if (match) decorators.push(`@@${match[1]}${match[2] ? ` ${match[2]}` : ''}`)
    else cleanLines.push(line)
  }
  return {
    ...entry,
    decorators,
    cleanContent: cleanLines.join('\n')
  }
}

function decoratorName(value: string): string {
  return value.split(/\s+/)[0]
}

function decoratorArgument(entry: RuntimeWorldEntry, name: string): string {
  const decorator = entry.decorators.find(item => decoratorName(item) === name)
  return decorator ? decorator.slice(name.length).trim() : ''
}

function hasDecorator(entry: RuntimeWorldEntry, name: string): boolean {
  return entry.decorators.some(item => decoratorName(item) === name)
}

function specialEntryKind(entry: RuntimeWorldEntry): 'generate' | 'render' | 'initial' | 'inject' | null {
  const title = asString(entry.stData.comment).trim()
  if (title.startsWith('[GENERATE:') || hasDecorator(entry, '@@generate_before') || hasDecorator(entry, '@@generate_after')) return 'generate'
  if (title.startsWith('[RENDER:') || hasDecorator(entry, '@@render_before') || hasDecorator(entry, '@@render_after')) return 'render'
  if (title.startsWith('[InitialVariables]') || hasDecorator(entry, '@@initial_variables')) return 'initial'
  if (title.startsWith('@INJECT')) return 'inject'
  return null
}

function entryTitle(entry: RuntimeWorldEntry): string {
  return asString(entry.stData.comment, `Entry #${entry.id}`).trim() || `Entry #${entry.id}`
}

function loreBookName(loreBooks: LoreBook[], id: number): string {
  return loreBooks.find(book => book.id === id)?.name ?? `World Book #${id}`
}

function deterministicRoll(seed: string): number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % 10000 / 100
}

function matchKey(haystack: string, rawNeedle: string, entry: RuntimeWorldEntry, character: CharacterEntry | null): boolean {
  const needle = replaceCharacterMacros(rawNeedle, character, { userName: DEFAULT_USER_NAME }).trim()
  if (!needle) return false
  const regex = parseRegex(needle)
  if (regex) return regex.test(haystack)

  const extensions = asRecord(entry.stData.extensions)
  const caseSensitive = entry.stData.case_sensitive ?? asBoolean(extensions.case_sensitive, false)
  const wholeWords = asBoolean(extensions.match_whole_words, false)
  const text = caseSensitive ? haystack : haystack.toLowerCase()
  const key = caseSensitive ? needle : needle.toLowerCase()
  if (!wholeWords) return text.includes(key)
  if (key.split(/\s+/).length > 1) return text.includes(key)
  return new RegExp(`(?:^|\\W)${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\W)`).test(text)
}

class PromptTemplateRun {
  private diagnostics: PromptTemplateDiagnostic[] = []
  private globalVariables: JsonRecord
  private localVariables: JsonRecord
  private initialVariables: JsonRecord = {}
  private cacheVariables: JsonRecord = {}
  private messageVariables: JsonRecord = {}
  private messageVariablesByBlockId = new Map<number, JsonRecord>()
  private regexes = new Map<string, RegexInjection>()
  private promptInjected = new Map<string, Map<string, PromptInjection>>()
  private sharedDefines: JsonRecord = {}
  private runId = 0

  constructor(private input: PromptTemplateRuntimeInput) {
    this.globalVariables = cloneJson(input.globalVariables)
    this.localVariables = cloneJson(input.chat.runtimeConfig.promptTemplateVariables)
    this.initialVariables = cloneJson(input.initialVariables ?? {})
    for (const block of input.blocks) {
      const variables = asRecord(asRecord(block.metadata.promptTemplate).variables)
      if (Object.keys(variables).length) {
        this.messageVariablesByBlockId.set(block.id, cloneJson(variables))
      }
    }
    for (const [blockId, variables] of input.messageVariablesByBlockId ?? []) {
      this.messageVariablesByBlockId.set(blockId, cloneJson(variables))
    }
  }

  snapshotVariables(): PromptTemplateVariables {
    return {
      global: cloneJson(this.globalVariables),
      local: cloneJson(this.localVariables),
      message: cloneJson(this.messageVariables),
      initial: cloneJson(this.initialVariables),
      cache: cloneJson(this.cacheVariables)
    }
  }

  getGlobalVariables(): JsonRecord {
    return cloneJson(this.globalVariables)
  }

  getLocalVariables(): JsonRecord {
    return cloneJson(this.localVariables)
  }

  getMessageVariablesByBlockId(): Map<number, JsonRecord> {
    return new Map([...this.messageVariablesByBlockId].map(([key, value]) => [key, cloneJson(value)]))
  }

  getDiagnostics(): PromptTemplateDiagnostic[] {
    return [...this.diagnostics]
  }

  private addDiagnostic(item: PromptTemplateDiagnostic): void {
    this.diagnostics.push(item)
    if (this.input.settings.debugEnabled) {
      console.debug(`[Prompt Template] ${item.level}: ${item.message}`, item)
    }
  }

  private selectedCharacter(): CharacterEntry | null {
    return this.input.characters.find(item => item.id === this.input.chat.runtimeConfig.characterId) ?? null
  }

  private activeLoreBookIds(): number[] {
    const character = this.selectedCharacter()
    const characterLoreBookId = character?.forgeData.loreBookId
    return [...new Set([
      ...(characterLoreBookId === null || characterLoreBookId === undefined ? [] : [characterLoreBookId]),
      ...this.input.chat.runtimeConfig.loreBookIds
    ])]
  }

  private activeRuntimeEntries(): RuntimeWorldEntry[] {
    const ids = new Set(this.activeLoreBookIds())
    return this.input.worldEntries
      .filter(entry => ids.has(entry.loreBookId))
      .map(normalizeRuntimeEntry)
  }

  private resetCache(currentBlockId?: number | null): void {
    this.messageVariables = {}
    for (const block of this.input.blocks) {
      if (currentBlockId !== undefined && currentBlockId !== null && block.id > currentBlockId) continue
      deepMerge(this.messageVariables, this.messageVariablesByBlockId.get(block.id) ?? {})
    }
    this.cacheVariables = deepMerge(
      deepMerge(
        deepMerge(cloneJson(this.globalVariables), this.initialVariables),
        this.localVariables
      ),
      this.messageVariables
    )
    setPath(this.cacheVariables, '_trace_id', this.runId++)
    setPath(this.cacheVariables, '_modify_id', asNumber(getPath(this.cacheVariables, '_modify_id'), 0))
  }

  private setVariable(key: string | null, value: unknown, rawOptions: unknown = {}): unknown {
    const options = variableOptions(rawOptions)
    if (this.input.dryRun && !options.dryRun) return undefined

    const scope = options.scope ?? 'message'
    const scopedTarget = this.targetForScope(scope)
    const existsInCache = hasPath(this.cacheVariables, key)
    const existsInScope = hasPath(scopedTarget, key)
    if (options.flags === 'nx' && existsInCache) return undefined
    if (options.flags === 'xx' && !existsInCache) return undefined
    if (options.flags === 'nxs' && existsInScope) return undefined
    if (options.flags === 'xxs' && !existsInScope) return undefined

    const oldValue = getPath(scopedTarget, key)
    let nextValue = value
    if (options.merge) {
      if (Array.isArray(oldValue) && Array.isArray(value)) {
        nextValue = [...oldValue, ...value]
      } else if (oldValue && typeof oldValue === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
        nextValue = deepMerge(cloneJson(asRecord(oldValue)), value)
      }
    }

    if (options.index !== undefined && key !== null) {
      const container = cloneJson(asRecord(getPath(scopedTarget, key, {})))
      setPath(container, String(options.index), nextValue)
      nextValue = container
    }

    if (nextValue === undefined) unsetPath(scopedTarget, key)
    else setPath(scopedTarget, key, cloneJson(nextValue))

    if (scope !== 'cache') {
      if (nextValue === undefined) unsetPath(this.cacheVariables, key)
      else setPath(this.cacheVariables, key, cloneJson(nextValue))
    }
    setPath(this.cacheVariables, '_modify_id', asNumber(getPath(this.cacheVariables, '_modify_id'), 0) + 1)

    if (options.results === 'old') return oldValue
    if (options.results === 'fullcache') return this.cacheVariables
    return nextValue
  }

  private getVariable(key: string | null, rawOptions: unknown = {}): unknown {
    const options = variableOptions(rawOptions)
    const target = this.targetForScope(options.scope ?? 'cache')
    const value = options.index === undefined
      ? getPath(target, key, options.defaults)
      : getPath(getPath(target, key, {}), String(options.index), options.defaults)
    return options.clone ? cloneJson(value) : value
  }

  private targetForScope(scope: NonNullable<VariableMutationOptions['scope']>): JsonRecord {
    if (scope === 'global') return this.globalVariables
    if (scope === 'local') return this.localVariables
    if (scope === 'message') return this.messageVariables
    if (scope === 'initial') return this.initialVariables
    return this.cacheVariables
  }

  private increaseVariable(key: string, value = 1, rawOptions: unknown = {}): unknown {
    const options = variableOptions(rawOptions)
    const current = Number(this.getVariable(key, { ...options, scope: (options as any).inscope ?? options.scope ?? 'cache', defaults: (options as any).defaults ?? 0 }))
    const next = current + Number(value)
    return this.setVariable(key, next, { ...options, scope: (options as any).outscope ?? options.scope ?? 'message' })
  }

  private deleteVariable(key: string | null, index: unknown = undefined, rawOptions: unknown = {}): unknown {
    if (index === undefined) return this.setVariable(key, undefined, rawOptions)
    const current = cloneJson(this.getVariable(key, rawOptions))
    if (Array.isArray(current)) {
      const itemIndex = current.indexOf(index)
      if (itemIndex >= 0) current.splice(itemIndex, 1)
      return this.setVariable(key, current, rawOptions)
    }
    if (current && typeof current === 'object') {
      delete (current as any)[String(index)]
      return this.setVariable(key, current, rawOptions)
    }
    return undefined
  }

  private insertVariable(key: string, value: unknown, index: unknown = undefined, rawOptions: unknown = {}): unknown {
    const current = cloneJson(this.getVariable(key, { ...variableOptions(rawOptions), defaults: [] }))
    if (Array.isArray(current)) {
      if (index === undefined) current.push(value)
      else current.splice(Number(index), 0, value)
      return this.setVariable(key, current, rawOptions)
    }
    if (current && typeof current === 'object' && index !== undefined) {
      ;(current as any)[String(index)] = value
      return this.setVariable(key, current, rawOptions)
    }
    return undefined
  }

  private async buildEnv(runType: TemplateRunType, extra: JsonRecord = {}, currentBlockId?: number | null): Promise<JsonRecord> {
    this.resetCache(currentBlockId)
    const character = this.selectedCharacter()
    const allBlocks = this.input.blocks
    const roleBlocks = allBlocks.filter(block => block.kind !== 'tool_definition')
    const getLastByRole = (role: TemplateRole) => {
      const block = [...roleBlocks].reverse().find(item => roleForBlock(item) === role)
      return block ? blockText(block) : ''
    }
    const getLastIdByRole = (role: TemplateRole) => {
      const index = [...roleBlocks].map(roleForBlock).lastIndexOf(role)
      return index
    }
    const env: JsonRecord = {
      _,
      z,
      faker: await loadFaker(),
      console,
      runType,
      runID: this.runId,
      isDryRun: this.input.dryRun === true,
      userName: DEFAULT_USER_NAME,
      assistantName: characterName(character),
      charName: characterName(character),
      characterId: character?.id ?? null,
      chatId: String(this.input.chat.id),
      charLoreBook: character?.forgeData.loreBookId ? loreBookName(this.input.loreBooks, character.forgeData.loreBookId) : '',
      userLoreBook: '',
      chatLoreBook: this.activeLoreBookIds().map(id => loreBookName(this.input.loreBooks, id)).join(', '),
      groupId: null,
      groups: [],
      charAvatar: character?.assetPath ?? '',
      userAvatar: '',
      model: '',
      generateType: runType === 'generate' ? 'normal' : '',
      lastUserMessage: getLastByRole('user'),
      lastCharMessage: getLastByRole('assistant'),
      lastUserMessageId: getLastIdByRole('user'),
      lastCharMessageId: getLastIdByRole('assistant'),
      lastMessageId: roleBlocks.length - 1,
      variables: this.cacheVariables,
      ...extra
    }

    Object.assign(env, {
      setvar: (key: string | null, value: unknown, options?: unknown) => this.setVariable(key, value, options),
      setLocalVar: (key: string | null, value: unknown, options: unknown = {}) => this.setVariable(key, value, { ...variableOptions(options), scope: 'local' }),
      setGlobalVar: (key: string | null, value: unknown, options: unknown = {}) => this.setVariable(key, value, { ...variableOptions(options), scope: 'global' }),
      setMessageVar: (key: string | null, value: unknown, options: unknown = {}) => this.setVariable(key, value, { ...variableOptions(options), scope: 'message' }),
      getvar: (key: string | null, options?: unknown) => this.getVariable(key, options),
      getLocalVar: (key: string | null, options: unknown = {}) => this.getVariable(key, { ...variableOptions(options), scope: 'local' }),
      getGlobalVar: (key: string | null, options: unknown = {}) => this.getVariable(key, { ...variableOptions(options), scope: 'global' }),
      getMessageVar: (key: string | null, options: unknown = {}) => this.getVariable(key, { ...variableOptions(options), scope: 'message' }),
      incvar: (key: string, value = 1, options?: unknown) => this.increaseVariable(key, value, options),
      incLocalVar: (key: string, value = 1, options: unknown = {}) => this.increaseVariable(key, value, { ...variableOptions(options), outscope: 'local' }),
      incGlobalVar: (key: string, value = 1, options: unknown = {}) => this.increaseVariable(key, value, { ...variableOptions(options), outscope: 'global' }),
      incMessageVar: (key: string, value = 1, options: unknown = {}) => this.increaseVariable(key, value, { ...variableOptions(options), outscope: 'message' }),
      decvar: (key: string, value = 1, options?: unknown) => this.increaseVariable(key, -Number(value), options),
      decLocalVar: (key: string, value = 1, options: unknown = {}) => this.increaseVariable(key, -Number(value), { ...variableOptions(options), outscope: 'local' }),
      decGlobalVar: (key: string, value = 1, options: unknown = {}) => this.increaseVariable(key, -Number(value), { ...variableOptions(options), outscope: 'global' }),
      decMessageVar: (key: string, value = 1, options: unknown = {}) => this.increaseVariable(key, -Number(value), { ...variableOptions(options), outscope: 'message' }),
      delvar: (key: string | null, index?: unknown, options?: unknown) => this.deleteVariable(key, index, options),
      delLocalVar: (key: string | null, index?: unknown, options: unknown = {}) => this.deleteVariable(key, index, { ...variableOptions(options), scope: 'local' }),
      delGlobalVar: (key: string | null, index?: unknown, options: unknown = {}) => this.deleteVariable(key, index, { ...variableOptions(options), scope: 'global' }),
      delMessageVar: (key: string | null, index?: unknown, options: unknown = {}) => this.deleteVariable(key, index, { ...variableOptions(options), scope: 'message' }),
      insvar: (key: string, value: unknown, index?: unknown, options?: unknown) => this.insertVariable(key, value, index, options),
      insertLocalVar: (key: string, value: unknown, index?: unknown, options: unknown = {}) => this.insertVariable(key, value, index, { ...variableOptions(options), scope: 'local' }),
      insertGlobalVar: (key: string, value: unknown, index?: unknown, options: unknown = {}) => this.insertVariable(key, value, index, { ...variableOptions(options), scope: 'global' }),
      insertMessageVar: (key: string, value: unknown, index?: unknown, options: unknown = {}) => this.insertVariable(key, value, index, { ...variableOptions(options), scope: 'message' }),
      patchVariables: (key: string | null, change: any[], options?: unknown) => this.setVariable(key, applyJsonPatch(cloneJson(this.getVariable(key, options) ?? {}), change), options),
      parseJSON: (text: string) => parseLooseJson(text),
      jsonPatch: (target: unknown, change: any[]) => applyJsonPatch(cloneJson(target), change),
      getwi: async (bookOrTitle: string | number | RegExp, titleOrData?: string | number | RegExp | JsonRecord, data: JsonRecord = {}) => this.getWorldInfoText(bookOrTitle, titleOrData, data, env),
      getWorldInfo: async (bookOrTitle: string | number | RegExp, titleOrData?: string | number | RegExp | JsonRecord, data: JsonRecord = {}) => this.getWorldInfoText(bookOrTitle, titleOrData, data, env),
      getWorldInfoData: (name?: string | number) => this.getWorldInfoData(name),
      getEnabledWorldInfoEntries: () => this.activeRuntimeEntries(),
      getWorldInfoActivatedData: (name: string | number, keywords: string | string[]) => this.getWorldInfoData(name).filter(entry => this.entryMatches(entry, Array.isArray(keywords) ? keywords.join('\n') : keywords)),
      getchar: async (name?: string | number | RegExp, template?: string, data?: JsonRecord) => this.getCharacterText(name, template, data, env),
      getChara: async (name?: string | number | RegExp, template?: string, data?: JsonRecord) => this.getCharacterText(name, template, data, env),
      getCharData: (name?: string | number | RegExp) => this.getCharacterRecord(name),
      getpreset: () => '',
      getPresetPrompt: () => '',
      getqr: () => '',
      getQuickReply: () => '',
      getQuickReplyData: () => null,
      getChatMessage: (index: number, role?: TemplateRole) => this.getChatMessage(index, role),
      getChatMessages: (...args: unknown[]) => this.getChatMessages(args),
      matchChatMessages: (pattern: string | RegExp | Array<string | RegExp>, options: JsonRecord = {}) => this.matchChatMessages(pattern, options),
      define: (name: string, value: unknown, merge = false) => {
        const oldValue = getPath(this.sharedDefines, name)
        if (merge && oldValue && typeof oldValue === 'object' && value && typeof value === 'object') {
          setPath(this.sharedDefines, name, deepMerge(cloneJson(asRecord(oldValue)), value))
        } else {
          setPath(this.sharedDefines, name, value)
        }
        setPath(env, name, getPath(this.sharedDefines, name))
        return oldValue
      },
      evalTemplate: async (content: string, data: JsonRecord = {}, options: JsonRecord = {}) => this.renderTemplate(content, { ...env, ...data }, 'generate', 'evalTemplate', options),
      activateRegex: (pattern: string | RegExp, replace: string | ((substring: string, ...args: string[]) => string), options: JsonRecord = {}) => this.activateRegex(pattern, replace, options),
      injectPrompt: (key: string, prompt: string, order = 100, sticky = 0, uid = '') => this.injectPrompt(key, prompt, order, sticky, uid),
      getPromptsInjected: (key: string, postprocess: Array<{ search: string | RegExp; replace: string }> = []) => this.getPromptsInjected(key, postprocess),
      hasPromptsInjected: (key: string) => this.promptInjected.has(key),
      activewi: async (bookOrTitle: string | number | RegExp, titleOrForce?: string | number | RegExp | boolean, force?: boolean) => this.activateWorldInfo(bookOrTitle, titleOrForce, force),
      activateWorldInfo: async (bookOrTitle: string | number | RegExp, titleOrForce?: string | number | RegExp | boolean, force?: boolean) => this.activateWorldInfo(bookOrTitle, titleOrForce, force),
      activateWorldInfoByKeywords: (keywords: string | string[]) => this.activeRuntimeEntries().filter(entry => this.entryMatches(entry, Array.isArray(keywords) ? keywords.join('\n') : keywords)),
      print: (...args: unknown[]) => args.map(arg => String(arg ?? '')).join(''),
      execute: async () => ''
    })

    for (const [key, value] of Object.entries(this.sharedDefines)) {
      env[key] = typeof value === 'function' ? value.bind(env) : value
    }
    return env
  }

  async preprocessWorldEntries(): Promise<PromptTemplatePreprocessResult> {
    if (!this.input.settings.enabled) {
      return {
        worldEntries: this.input.worldEntries,
        specialEntries: [],
        diagnostics: [],
        variables: this.snapshotVariables(),
        globalVariables: this.getGlobalVariables(),
        localVariables: this.getLocalVariables(),
        messageVariablesByBlockId: this.getMessageVariablesByBlockId()
      }
    }

    const character = this.selectedCharacter()
    const activeIds = new Set(this.activeLoreBookIds())
    const env = await this.buildEnv('generate')
    const nextEntries: WorldEntry[] = []
    const specialEntries: RuntimeWorldEntry[] = []

    for (const rawEntry of this.input.worldEntries) {
      if (!activeIds.has(rawEntry.loreBookId)) {
        nextEntries.push(rawEntry)
        continue
      }
      const entry = normalizeRuntimeEntry(rawEntry)
      const kind = specialEntryKind(entry)
      if (kind) {
        specialEntries.push(entry)
        continue
      }

      if (hasDecorator(entry, '@@dont_activate') || hasDecorator(entry, '@@only_preload')) {
        continue
      }

      let stData = { ...entry.stData, content: entry.cleanContent }
      if (hasDecorator(entry, '@@activate')) {
        stData = { ...stData, enabled: true, constant: true }
      }

      if (hasDecorator(entry, '@@if')) {
        const expr = decoratorArgument(entry, '@@if')
        const result = await this.renderTemplate(`<%- Boolean(${expr}) %>`, env, 'preprocess', `${entryTitle(entry)} @@if`, {
          entryId: entry.id,
          loreBookId: entry.loreBookId
        })
        if (result.trim() !== 'true') continue
      }

      if (hasDecorator(entry, '@@preprocessing')) {
        const scopedEnv = { ...env, world_info: entry }
        stData = {
          ...stData,
          content: await this.renderTemplate(replaceCharacterMacros(stData.content, character, { userName: DEFAULT_USER_NAME }), scopedEnv, 'preprocess', entryTitle(entry), {
            entryId: entry.id,
            loreBookId: entry.loreBookId
          }),
          keys: await Promise.all(stData.keys.map(async key => (
            await this.renderTemplate(key, scopedEnv, 'preprocess', `${entryTitle(entry)} key`, {
              entryId: entry.id,
              loreBookId: entry.loreBookId
            })
          ))),
          secondary_keys: await Promise.all((stData.secondary_keys ?? []).map(async key => (
            await this.renderTemplate(key, scopedEnv, 'preprocess', `${entryTitle(entry)} secondary key`, {
              entryId: entry.id,
              loreBookId: entry.loreBookId
            })
          )))
        }
      }

      if (hasDecorator(entry, '@@private')) {
        stData = { ...stData, content: '' }
        this.addDiagnostic(diagnostic('info', 'preprocess', '@@private entry was executed as a private/no-output entry.', {
          entryId: entry.id,
          loreBookId: entry.loreBookId,
          source: entryTitle(entry)
        }))
      }

      nextEntries.push({ ...rawEntry, stData })
    }

    await this.loadInitialVariables(specialEntries, env)
    return {
      worldEntries: nextEntries,
      specialEntries,
      diagnostics: this.getDiagnostics(),
      variables: this.snapshotVariables(),
      globalVariables: this.getGlobalVariables(),
      localVariables: this.getLocalVariables(),
      messageVariablesByBlockId: this.getMessageVariablesByBlockId()
    }
  }

  async processMessages(
    messages: ChatGenerationPreviewMessage[],
    baseVirtualBlocks: InjectionPreviewBlock[],
    specialEntries: RuntimeWorldEntry[]
  ): Promise<PromptTemplateGenerationResult> {
    if (!this.input.settings.enabled || !this.input.settings.generateEnabled) {
      return {
        messages,
        virtualBlocks: baseVirtualBlocks,
        diagnostics: this.getDiagnostics(),
        variables: this.snapshotVariables(),
        globalVariables: this.getGlobalVariables(),
        localVariables: this.getLocalVariables(),
        messageVariablesByBlockId: this.getMessageVariablesByBlockId()
      }
    }

    let nextMessages = [...messages]
    const virtualBlocks = [...baseVirtualBlocks]
    let virtualId = Math.min(-1, ...virtualBlocks.map(block => block.id)) - 1
    const env = await this.buildEnv('generate')
    let buffer = ''

    if (this.input.settings.generateLoaderEnabled) {
      const before = await this.evaluateSpecialEntries(specialEntries, '[GENERATE:BEFORE]', '@@generate_before', '', env, buffer)
      if (before.trim() && nextMessages[0]) {
        nextMessages[0] = messageWithContent(nextMessages[0], before + textContent(nextMessages[0].content))
        virtualBlocks.push(this.virtualBlock(virtualId--, 'system', before, 'generate', '生成前注入', specialEntries, 'start'))
      }
    }

    for (let index = 0; index < nextMessages.length; index += 1) {
      const message = nextMessages[index]
      const rawText = textContent(message.content)
      const before = this.input.settings.generateLoaderEnabled
        ? await this.evaluateSpecialEntries(specialEntries, `[GENERATE:${index}:BEFORE]`, `@@generate_before ${index}`, rawText, env, buffer)
        : ''
      let rendered = await this.renderTemplate(
        this.applyRegex(rawText, 'generate', message.role),
        env,
        'generate',
        `message #${index}(${message.role})`
      )
      const regexBefore = await this.evaluateGenerateRegexEntries(specialEntries, rendered, env, buffer)
      const after = this.input.settings.generateLoaderEnabled
        ? await this.evaluateSpecialEntries(specialEntries, `[GENERATE:${index}:AFTER]`, `@@generate_after ${index}`, rendered, env, buffer + before + rendered)
        : ''
      rendered = regexBefore + before + rendered + after
      nextMessages[index] = messageWithContent(message, rendered)
      buffer += rendered
    }

    if (this.input.settings.generateLoaderEnabled && nextMessages.length > 0) {
      const after = await this.evaluateSpecialEntries(specialEntries, '[GENERATE:AFTER]', '@@generate_after', buffer, env, buffer)
      if (after.trim()) {
        const lastIndex = nextMessages.length - 1
        nextMessages[lastIndex] = messageWithContent(nextMessages[lastIndex], textContent(nextMessages[lastIndex].content) + after)
        virtualBlocks.push(this.virtualBlock(virtualId--, nextMessages[lastIndex].role, after, 'generate', '生成后注入', specialEntries, 'end'))
      }
    }

    if (this.input.settings.injectLoaderEnabled) {
      const injected = await this.applyInjectEntries(nextMessages, specialEntries, env, virtualId)
      nextMessages = injected.messages
      virtualBlocks.push(...injected.virtualBlocks)
      virtualId = injected.nextVirtualId
    }

    return {
      messages: nextMessages,
      virtualBlocks,
      diagnostics: this.getDiagnostics(),
      variables: this.snapshotVariables(),
      globalVariables: this.getGlobalVariables(),
      localVariables: this.getLocalVariables(),
      messageVariablesByBlockId: this.getMessageVariablesByBlockId()
    }
  }

  async processOutput(block: ChatBlock, contentParts: ChatContentPart[], specialEntries: RuntimeWorldEntry[]): Promise<PromptTemplateOutputResult> {
    if (!this.input.settings.enabled || !this.input.settings.renderEnabled || !this.input.settings.rawMessageEvaluationEnabled) {
      return {
        contentParts,
        diagnostics: this.getDiagnostics(),
        variables: this.snapshotVariables(),
        globalVariables: this.getGlobalVariables(),
        localVariables: this.getLocalVariables(),
        messageVariables: asRecord(asRecord(block.metadata.promptTemplate).variables)
      }
    }

    this.messageVariables = cloneJson(asRecord(asRecord(block.metadata.promptTemplate).variables))
    const env = await this.buildEnv('render_permanent', {
      message_id: this.input.blocks.length,
      swipe_id: 0,
      is_last: true,
      is_user: false,
      is_system: false,
      name: characterName(this.selectedCharacter())
    }, block.id)

    const nextParts: ChatContentPart[] = []
    for (const part of contentParts) {
      if (part.type !== 'text') {
        nextParts.push(part)
        continue
      }
      const text = await this.renderTemplate(
        this.applyRegex(part.text, 'message', 'assistant'),
        env,
        'render',
        `assistant output #${block.id}`,
        { blockId: block.id }
      )
      nextParts.push({ ...part, text })
    }

    const before = this.input.settings.renderLoaderEnabled
      ? await this.evaluateSpecialEntries(specialEntries, '[RENDER:BEFORE]', '@@render_before', textContent(nextParts), env, '')
      : ''
    const after = this.input.settings.renderLoaderEnabled
      ? await this.evaluateSpecialEntries(specialEntries, '[RENDER:AFTER]', '@@render_after', textContent(nextParts), env, textContent(nextParts))
      : ''
    const firstPart = nextParts[0]
    if ((before || after) && firstPart?.type === 'text') {
      nextParts[0] = { ...firstPart, text: before + firstPart.text }
      let lastTextIndex = -1
      for (let index = nextParts.length - 1; index >= 0; index -= 1) {
        if (nextParts[index].type === 'text') {
          lastTextIndex = index
          break
        }
      }
      const lastTextPart = nextParts[lastTextIndex]
      if (lastTextIndex >= 0 && lastTextPart?.type === 'text') {
        nextParts[lastTextIndex] = { ...lastTextPart, text: lastTextPart.text + after }
      }
    }

    this.messageVariablesByBlockId.set(block.id, cloneJson(this.messageVariables))
    return {
      contentParts: nextParts,
      diagnostics: this.getDiagnostics(),
      variables: this.snapshotVariables(),
      globalVariables: this.getGlobalVariables(),
      localVariables: this.getLocalVariables(),
      messageVariables: cloneJson(this.messageVariables)
    }
  }

  async processBlockRender(block: ChatBlock, contentParts: ChatContentPart[], specialEntries: RuntimeWorldEntry[]): Promise<PromptTemplateBlockProjectionResult> {
    if (!this.input.settings.enabled || !this.input.settings.renderEnabled) {
      return {
        contentParts,
        diagnostics: this.getDiagnostics(),
        variables: this.snapshotVariables()
      }
    }

    const role = roleForBlock(block)
    const blockIndex = this.input.blocks.findIndex(item => item.id === block.id)
    this.messageVariables = cloneJson(asRecord(asRecord(block.metadata.promptTemplate).variables))
    const env = await this.buildEnv('render', {
      message_id: blockIndex < 0 ? this.input.blocks.length : blockIndex,
      swipe_id: 0,
      is_last: blockIndex === this.input.blocks.length - 1,
      is_user: role === 'user',
      is_system: role === 'system',
      name: role === 'assistant' ? characterName(this.selectedCharacter()) : DEFAULT_USER_NAME
    }, block.id)

    const nextParts: ChatContentPart[] = []
    for (const part of contentParts) {
      if (part.type !== 'text') {
        nextParts.push(part)
        continue
      }
      const text = await this.renderTemplate(
        this.applyRegex(part.text, 'message', role),
        env,
        'render',
        `block #${block.id}`,
        { blockId: block.id }
      )
      nextParts.push({ ...part, text })
    }

    const before = this.input.settings.renderLoaderEnabled
      ? await this.evaluateSpecialEntries(specialEntries, '[RENDER:BEFORE]', '@@render_before', textContent(nextParts), env, '')
      : ''
    const after = this.input.settings.renderLoaderEnabled
      ? await this.evaluateSpecialEntries(specialEntries, '[RENDER:AFTER]', '@@render_after', textContent(nextParts), env, textContent(nextParts))
      : ''
    const firstPart = nextParts[0]
    if ((before || after) && firstPart?.type === 'text') {
      nextParts[0] = { ...firstPart, text: before + firstPart.text }
      let lastTextIndex = -1
      for (let index = nextParts.length - 1; index >= 0; index -= 1) {
        if (nextParts[index].type === 'text') {
          lastTextIndex = index
          break
        }
      }
      const lastTextPart = nextParts[lastTextIndex]
      if (lastTextIndex >= 0 && lastTextPart?.type === 'text') {
        nextParts[lastTextIndex] = { ...lastTextPart, text: lastTextPart.text + after }
      }
    }

    return {
      contentParts: nextParts,
      diagnostics: this.getDiagnostics(),
      variables: this.snapshotVariables()
    }
  }

  private async loadInitialVariables(specialEntries: RuntimeWorldEntry[], env: JsonRecord): Promise<void> {
    for (const entry of specialEntries.filter(item => specialEntryKind(item) === 'initial' && this.specialEntryEnabled(item))) {
      const rendered = await this.renderTemplate(entry.cleanContent, { ...env, world_info: entry }, 'variables', entryTitle(entry), {
        entryId: entry.id,
        loreBookId: entry.loreBookId
      })
      try {
        const parsed = JSON.parse(rendered)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          this.addDiagnostic(diagnostic('warning', 'variables', '[InitialVariables] content must be a JSON object.', {
            entryId: entry.id,
            loreBookId: entry.loreBookId,
            source: entryTitle(entry)
          }))
          continue
        }
        deepMerge(this.initialVariables, parsed)
      } catch (error) {
        this.addDiagnostic(diagnostic('error', 'variables', `Failed to parse [InitialVariables]: ${error instanceof Error ? error.message : String(error)}`, {
          entryId: entry.id,
          loreBookId: entry.loreBookId,
          source: entryTitle(entry)
        }))
      }
    }
  }

  private specialEntryEnabled(entry: RuntimeWorldEntry): boolean {
    if (hasDecorator(entry, '@@always_enabled')) return true
    return entry.stData.enabled !== this.input.settings.invertEnabled
  }

  private entryMatches(entry: RuntimeWorldEntry, content: string): boolean {
    if (entry.stData.constant) return true
    const keys = entry.stData.keys ?? []
    if (!keys.length) return false
    const character = this.selectedCharacter()
    if (!keys.some(key => matchKey(content, key, entry, character))) return false
    if (!entry.stData.selective || !(entry.stData.secondary_keys ?? []).length) return true
    const secondary = entry.stData.secondary_keys ?? []
    const matches = secondary.map(key => matchKey(content, key, entry, character))
    const any = matches.some(Boolean)
    const all = matches.every(Boolean)
    const logic = asNumber(asRecord(entry.stData.extensions).selectiveLogic, 0)
    if (logic === 1) return !all
    if (logic === 2) return !any
    if (logic === 3) return all
    return any
  }

  private entryProbabilityPasses(entry: RuntimeWorldEntry, seed: string): boolean {
    const extensions = asRecord(entry.stData.extensions)
    const useProbability = asBoolean(extensions.useProbability, true)
    const probability = asNumber(extensions.probability, 100)
    if (!useProbability || probability >= 100) return true
    const roll = this.input.dryRun ? deterministicRoll(`${entry.id}:${entry.updatedAt}:${seed}`) : Math.random() * 100
    return roll <= probability
  }

  private async evaluateSpecialEntries(
    entries: RuntimeWorldEntry[],
    comment: string,
    decorator: string,
    content: string,
    env: JsonRecord,
    buffer: string
  ): Promise<string> {
    const matched = entries
      .filter(entry => (
        this.specialEntryEnabled(entry) &&
        (entryTitle(entry).startsWith(comment) || entry.decorators.some(item => item.startsWith(decorator))) &&
        this.entryMatches(entry, content || buffer) &&
        this.entryProbabilityPasses(entry, content || buffer)
      ))
      .sort((a, b) => a.stData.insertion_order - b.stData.insertion_order || a.id - b.id)
    let result = ''
    for (const entry of matched) {
      const rendered = await this.renderTemplate(entry.cleanContent, {
        ...env,
        world_info: entry,
        generateBuffer: buffer
      }, comment.startsWith('[RENDER') ? 'render' : 'generate', entryTitle(entry), {
        entryId: entry.id,
        loreBookId: entry.loreBookId
      })
      result += rendered
      this.addDiagnostic(diagnostic('info', comment.startsWith('[RENDER') ? 'render' : 'generate', `Applied ${comment} entry: ${entryTitle(entry)}`, {
        entryId: entry.id,
        loreBookId: entry.loreBookId,
        source: entryTitle(entry)
      }))
    }
    return result
  }

  private async evaluateGenerateRegexEntries(entries: RuntimeWorldEntry[], content: string, env: JsonRecord, buffer: string): Promise<string> {
    let result = ''
    for (const entry of entries.filter(item => this.specialEntryEnabled(item) && entryTitle(item).startsWith('[GENERATE:REGEX:'))) {
      const pattern = entryTitle(entry).replace(/^\[GENERATE:REGEX:/, '').replace(/\]$/, '')
      try {
        if (!new RegExp(pattern, 'i').test(content)) continue
      } catch {
        this.addDiagnostic(diagnostic('warning', 'generate', `Invalid GENERATE regex: ${pattern}`, {
          entryId: entry.id,
          loreBookId: entry.loreBookId,
          source: entryTitle(entry)
        }))
        continue
      }
      result += await this.renderTemplate(entry.cleanContent, {
        ...env,
        world_info: entry,
        generateBuffer: buffer,
        matched_message: content
      }, 'generate', entryTitle(entry), {
        entryId: entry.id,
        loreBookId: entry.loreBookId
      })
    }
    return result
  }

  private async applyInjectEntries(
    messages: ChatGenerationPreviewMessage[],
    entries: RuntimeWorldEntry[],
    env: JsonRecord,
    initialVirtualId: number
  ): Promise<{ messages: ChatGenerationPreviewMessage[]; virtualBlocks: InjectionPreviewBlock[]; nextVirtualId: number }> {
    const instructions: InjectInstruction[] = []
    for (const entry of entries.filter(item => specialEntryKind(item) === 'inject' && this.specialEntryEnabled(item) && this.entryProbabilityPasses(item, textContent(messages.map(m => textContent(m.content)).join('\n'))))) {
      const instruction = await this.parseInjectInstruction(entry, env)
      if (instruction) instructions.push(instruction)
    }
    if (!instructions.length) return { messages, virtualBlocks: [], nextVirtualId: initialVirtualId }

    const roleCounts = new Map<TemplateRole, number>()
    const indexed = messages.map((message, index) => {
      const count = (roleCounts.get(message.role) ?? 0) + 1
      roleCounts.set(message.role, count)
      return { message, index, roleIndex: count }
    })
    const queue: Array<{ finalPos: number; instruction: InjectInstruction }> = []
    const typePriority = { pos: 0, target: 1, regex: 2 }

    for (const instruction of instructions) {
      if (instruction.type === 'pos') {
        let pos = instruction.pos ?? 1
        if (pos < 0) pos = messages.length + pos + 1
        queue.push({ finalPos: Math.max(0, Math.min(messages.length, pos === 0 ? 0 : pos - 1)), instruction })
      } else if (instruction.type === 'target') {
        const target = instruction.target ?? 'user'
        const total = indexed.filter(item => item.message.role === target).length
        let targetIndex = instruction.targetIndex ?? 1
        if (targetIndex < 0) targetIndex = total + targetIndex + 1
        const found = indexed.find(item => item.message.role === target && item.roleIndex === targetIndex)
        if (found) queue.push({ finalPos: instruction.targetAt === 'after' ? found.index + 1 : found.index, instruction })
      } else if (instruction.regex) {
        let regex: RegExp | null = null
        try {
          regex = new RegExp(instruction.regex, 'i')
        } catch {
          this.addDiagnostic(diagnostic('warning', 'inject', `Invalid @INJECT regex: ${instruction.regex}`, {
            entryId: instruction.entry.id,
            loreBookId: instruction.entry.loreBookId,
            source: entryTitle(instruction.entry)
          }))
        }
        if (!regex) continue
        const found = indexed.find(item => regex!.test(textContent(item.message.content)))
        if (found) queue.push({ finalPos: instruction.regexAt === 'after' ? found.index + 1 : found.index, instruction })
      }
    }

    queue.sort((a, b) => (
      a.finalPos - b.finalPos ||
      a.instruction.order - b.instruction.order ||
      typePriority[a.instruction.type] - typePriority[b.instruction.type]
    ))

    const injectionsByPosition = new Map<number, InjectInstruction[]>()
    for (const item of queue) {
      const list = injectionsByPosition.get(item.finalPos) ?? []
      list.push(item.instruction)
      injectionsByPosition.set(item.finalPos, list)
    }

    const result: ChatGenerationPreviewMessage[] = []
    const virtualBlocks: InjectionPreviewBlock[] = []
    let virtualId = initialVirtualId
    for (let index = 0; index <= messages.length; index += 1) {
      for (const instruction of injectionsByPosition.get(index) ?? []) {
        const blockId = virtualId--
        result.push({ role: instruction.role, content: instruction.content, blockId })
        virtualBlocks.push(this.virtualBlock(blockId, instruction.role, instruction.content, 'inject', `@INJECT ${instruction.type}`, [instruction.entry]))
      }
      if (messages[index]) result.push(messages[index])
    }

    return { messages: result, virtualBlocks, nextVirtualId: virtualId }
  }

  private async parseInjectInstruction(entry: RuntimeWorldEntry, env: JsonRecord): Promise<InjectInstruction | null> {
    const title = entryTitle(entry)
    const params = new Map<string, string>()
    const re = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^,\s]+))/g
    let match: RegExpExecArray | null
    while ((match = re.exec(title)) !== null) {
      params.set(match[1], match[2] ?? match[3] ?? match[4] ?? '')
    }
    const role = this.roleFromString(params.get('role')) ?? 'system'
    const content = (await this.renderTemplate(entry.cleanContent, { ...env, world_info: entry }, 'inject', title, {
      entryId: entry.id,
      loreBookId: entry.loreBookId
    })).trim()
    if (!content) return null

    const base = {
      role,
      content,
      order: asNumber(entry.stData.insertion_order, 100),
      entry
    }
    if (params.has('pos')) {
      return { ...base, type: 'pos', pos: Number(params.get('pos')) }
    }
    if (params.has('target')) {
      return {
        ...base,
        type: 'target',
        target: this.roleFromString(params.get('target')) ?? 'user',
        targetIndex: params.has('index') ? Number(params.get('index')) : 1,
        targetAt: params.get('at') === 'after' ? 'after' : 'before'
      }
    }
    if (params.has('regex')) {
      return {
        ...base,
        type: 'regex',
        regex: params.get('regex') ?? '',
        regexAt: params.get('at') === 'after' ? 'after' : 'before'
      }
    }
    this.addDiagnostic(diagnostic('warning', 'inject', `Invalid @INJECT instruction: ${title}`, {
      entryId: entry.id,
      loreBookId: entry.loreBookId,
      source: title
    }))
    return null
  }

  private roleFromString(value: unknown): TemplateRole | null {
    return value === 'system' || value === 'user' || value === 'assistant' ? value : null
  }

  private virtualBlock(
    id: number,
    role: TemplateRole,
    content: string,
    source: 'generate' | 'inject',
    reason: string,
    entries: RuntimeWorldEntry[],
    displaySlot?: 'start' | 'end'
  ): InjectionPreviewBlock {
    return {
      id,
      chatId: this.input.chat.id,
      kind: 'injection',
      enabled: true,
      status: 'idle',
      orderIndex: id,
      contentParts: [{ type: 'text', text: content }],
      metadata: {
        virtual: true,
        targetRole: role,
        source: 'worldInfo',
        activatedEntryIds: entries.map(entry => entry.id),
        loreBookIds: [...new Set(entries.map(entry => entry.loreBookId))],
        injectionDetails: entries.map(entry => ({
          title: entryTitle(entry),
          source: 'worldInfo',
          sourceName: `世界书：${loreBookName(this.input.loreBooks, entry.loreBookId)}`,
          reason,
          content,
          entryId: entry.id,
          loreBookId: entry.loreBookId
        })),
        displaySlot,
        promptTemplate: { source }
      },
      llmInstanceSnapshot: null,
      requestBlockIds: [],
      errorText: '',
      createdAt: this.input.chat.updatedAt,
      updatedAt: this.input.chat.updatedAt
    }
  }

  private async renderTemplate(
    content: string,
    env: JsonRecord,
    phase: TemplatePhase,
    source: string,
    metadata: JsonRecord = {}
  ): Promise<string> {
    if (!content.includes(TEMPLATE_MARKER)) return content
    const options = {
      async: true,
      client: true,
      outputFunctionName: 'print',
      _with: !this.input.settings.withContextDisabled,
      localsName: 'locals',
      strict: false,
      rmWhitespace: false
    }

    try {
      const cacheMode = this.input.settings.cacheEnabled
      const shouldCache = cacheMode === 1 || (cacheMode === 2 && metadata.entryId !== undefined)
      const cacheKey = shouldCache
        ? JSON.stringify([content, this.input.settings.withContextDisabled, this.input.settings.sandbox])
        : null
      const compiled = compileTemplate(content, options, cacheKey, this.input.settings.cacheSize)
      if (!this.input.settings.sandbox) {
        return await compiled.call(env, env, escapeXml, () => '', rethrow)
      }
      const functionSource = compileSandboxTemplateSource(content, options, cacheKey, this.input.settings.cacheSize)
      const sandbox = vm.createContext({
        console,
        Promise,
        JSON,
        Math,
        Date,
        RegExp,
        String,
        Number,
        Boolean,
        Array,
        Object,
        Set,
        Map,
        URL,
        encodeURIComponent,
        decodeURIComponent
      })
      const fn = new vm.Script(`(${functionSource})`).runInContext(sandbox, { timeout: 1000 }) as Function
      return await fn.call(env, env, escapeXml, () => '', rethrow)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.addDiagnostic(diagnostic('error', phase, `Template error in ${source}: ${message}`, {
        ...metadata,
        source
      }))
      return content
    }
  }

  private applyRegex(content: string, scope: 'generate' | 'message', role: TemplateRole): string {
    let result = content
    for (const regex of [...this.regexes.values()]
      .filter(item => item.scope === scope && (!item.role || item.role === role))
      .sort((a, b) => a.order - b.order)) {
      result = result.replace(regex.search as any, typeof regex.replace === 'function' ? regex.replace.bind(this.cacheVariables) as any : regex.replace)
    }
    return result
  }

  private activateRegex(pattern: string | RegExp, replace: string | ((substring: string, ...args: string[]) => string), options: JsonRecord = {}): void {
    const uuid = asString(options.uuid, `${String(pattern)}:${String(replace)}`)
    this.regexes.set(uuid, {
      search: pattern,
      replace,
      scope: options.message === true ? 'message' : 'generate',
      role: this.roleFromString(options.role) ?? undefined,
      order: asNumber(options.order, 100),
      sticky: asNumber(options.sticky, 0)
    })
  }

  private injectPrompt(key: string, prompt: string, order = 100, sticky = 0, uid = ''): void {
    const group = this.promptInjected.get(key) ?? new Map<string, PromptInjection>()
    const id = uid || `${key}:${prompt}`
    group.set(id, { prompt, order, sticky, uid: id })
    this.promptInjected.set(key, group)
  }

  private getPromptsInjected(key: string, postprocess: Array<{ search: string | RegExp; replace: string }> = []): string {
    const group = this.promptInjected.get(key)
    if (!group) return ''
    let result = [...group.values()].sort((a, b) => a.order - b.order).map(item => item.prompt).join('\n')
    for (const item of postprocess) result = result.replace(item.search as any, item.replace)
    return result
  }

  private getWorldInfoData(name?: string | number): RuntimeWorldEntry[] {
    const ids = new Set(this.activeLoreBookIds())
    const byName = new Map(this.input.loreBooks.map(book => [book.name, book.id]))
    const loreBookId = name === undefined ? null : typeof name === 'number' ? name : byName.get(String(name)) ?? null
    return this.input.worldEntries
      .filter(entry => loreBookId === null ? ids.has(entry.loreBookId) : entry.loreBookId === loreBookId)
      .map(normalizeRuntimeEntry)
  }

  private async getWorldInfoText(bookOrTitle: string | number | RegExp, titleOrData?: string | number | RegExp | JsonRecord, data: JsonRecord = {}, env?: JsonRecord): Promise<string> {
    let entries: RuntimeWorldEntry[]
    let title: string | number | RegExp
    if (typeof titleOrData === 'string' || typeof titleOrData === 'number' || titleOrData instanceof RegExp) {
      entries = this.getWorldInfoData(bookOrTitle as string | number)
      title = titleOrData
    } else {
      entries = this.getWorldInfoData()
      title = bookOrTitle
      data = asRecord(titleOrData)
    }
    const entry = entries.find(item => (
      item.id === title ||
      asNumber(item.stData.id, Number.NaN) === title ||
      entryTitle(item) === title ||
      (title instanceof RegExp && title.test(entryTitle(item)))
    ))
    if (!entry) return ''
    const scopedEnv = { ...(env ?? await this.buildEnv('generate')), ...data, world_info: entry }
    return this.renderTemplate(entry.cleanContent, scopedEnv, 'generate', entryTitle(entry), {
      entryId: entry.id,
      loreBookId: entry.loreBookId
    })
  }

  private getCharacterRecord(name?: string | number | RegExp): JsonRecord | null {
    const character = name === undefined
      ? this.selectedCharacter()
      : this.input.characters.find(item => (
        item.id === name ||
        characterName(item) === name ||
        (name instanceof RegExp && name.test(characterName(item)))
      )) ?? null
    return character ? asRecord(character.stData.data) : null
  }

  private async getCharacterText(name?: string | number | RegExp, template?: string, data: JsonRecord = {}, env?: JsonRecord): Promise<string> {
    const record = this.getCharacterRecord(name)
    if (!record) return ''
    const defaultTemplate = [
      '<% if (name) { %><<%- name %>>',
      '<% if (system_prompt) { %>System: <%- system_prompt %><% } %>',
      '<% if (personality) { %>personality: <%- personality %><% } %>',
      '<% if (description) { %>description: <%- description %><% } %>',
      '<% if (scenario) { %>scenario: <%- scenario %><% } %>',
      '</<%- name %>><% } %>'
    ].join('\n')
    return this.renderTemplate(template ?? defaultTemplate, { ...(env ?? await this.buildEnv('generate')), ...record, ...data }, 'generate', asString(record.name, 'character'))
  }

  private getChatMessage(index: number, role?: TemplateRole): string {
    const blocks = role ? this.input.blocks.filter(block => roleForBlock(block) === role) : this.input.blocks
    const block = blocks[index < 0 ? blocks.length + index : index]
    return block ? blockText(block) : ''
  }

  private getChatMessages(args: unknown[]): string[] {
    if (args.length <= 0) return []
    const role = this.roleFromString(args.at(-1))
    const numbers = args.filter(item => typeof item === 'number') as number[]
    const blocks = role ? this.input.blocks.filter(block => roleForBlock(block) === role) : this.input.blocks
    if (numbers.length === 1) return blocks.slice(-numbers[0]).map(blockText)
    const start = numbers[0] ?? 0
    const end = numbers[1] ?? blocks.length
    return blocks.slice(start, end).map(blockText)
  }

  private matchChatMessages(pattern: string | RegExp | Array<string | RegExp>, options: JsonRecord = {}): boolean {
    const text = this.getChatMessages([
      asNumber(options.start, -2),
      options.end === undefined ? this.input.blocks.length : asNumber(options.end, this.input.blocks.length),
      this.roleFromString(options.role)
    ]).join('\n')
    const patterns = Array.isArray(pattern) ? pattern : [pattern]
    const matches = patterns.map(item => typeof item === 'string' ? text.includes(item) : item.test(text))
    return options.and === true ? matches.every(Boolean) : matches.some(Boolean)
  }

  private async activateWorldInfo(bookOrTitle: string | number | RegExp, titleOrForce?: string | number | RegExp | boolean, force?: boolean): Promise<RuntimeWorldEntry | null> {
    let entry: RuntimeWorldEntry | undefined
    if (typeof titleOrForce === 'boolean' || titleOrForce === undefined) {
      entry = this.getWorldInfoData().find(item => entryTitle(item) === bookOrTitle || item.id === bookOrTitle || (bookOrTitle instanceof RegExp && bookOrTitle.test(entryTitle(item))))
      force = titleOrForce
    } else {
      entry = this.getWorldInfoData(bookOrTitle as string | number).find(item => entryTitle(item) === titleOrForce || item.id === titleOrForce || (titleOrForce instanceof RegExp && titleOrForce.test(entryTitle(item))))
    }
    if (!entry) return null
    if (force) {
      entry.stData.enabled = true
      entry.stData.constant = true
    }
    return entry
  }
}

const _ = {
  get: getPath,
  set: setPath,
  unset: unsetPath,
  merge: deepMerge,
  cloneDeep: cloneJson,
  isArray: Array.isArray,
  isPlainObject: (value: unknown) => Boolean(value && typeof value === 'object' && !Array.isArray(value)),
  castArray: (value: unknown) => Array.isArray(value) ? value : [value],
  compact: <T>(value: T[]) => value.filter(Boolean),
  entries: Object.entries,
  random: (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min,
  sum: (values: number[]) => values.reduce((sum, value) => sum + value, 0),
  escapeRegExp: (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function rethrow(error: Error): never {
  throw error
}

function parseLooseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return JSON.parse(jsonrepair(text))
  }
}

function applyJsonPatch(target: any, patch: Array<{ op: string; path: string; value?: unknown; from?: string }>): unknown {
  for (const operation of patch) {
    const path = operation.path.replace(/^\//, '').replace(/\//g, '.')
    if (operation.op === 'add' || operation.op === 'replace') {
      setPath(target, path, operation.value)
    } else if (operation.op === 'remove') {
      unsetPath(target, path)
    } else if (operation.op === 'copy' && operation.from) {
      setPath(target, path, cloneJson(getPath(target, operation.from.replace(/^\//, '').replace(/\//g, '.'))))
    } else if (operation.op === 'move' && operation.from) {
      const fromPath = operation.from.replace(/^\//, '').replace(/\//g, '.')
      setPath(target, path, cloneJson(getPath(target, fromPath)))
      unsetPath(target, fromPath)
    }
  }
  return target
}

export function filterPromptTemplateMessageBlocks(settings: PromptTemplateSettings, blocks: ChatBlock[]): ChatBlock[] {
  if (!settings.enabled || !settings.filterMessageEnabled) return blocks
  return blocks.map(block => {
    if (block.kind !== 'user' && block.kind !== 'assistant') return block
    return {
      ...block,
      contentParts: block.contentParts.map(part => part.type === 'text'
        ? { ...part, text: part.text.replace(/<%[\s\S]*?%>/g, '') }
        : part)
    }
  })
}

export async function preprocessPromptTemplate(input: PromptTemplateRuntimeInput): Promise<PromptTemplatePreprocessResult> {
  return new PromptTemplateRun(input).preprocessWorldEntries()
}

export async function processPromptTemplateGeneration(
  input: PromptTemplateRuntimeInput & {
    messages: ChatGenerationPreviewMessage[]
    virtualBlocks: InjectionPreviewBlock[]
    specialEntries: RuntimeWorldEntry[]
  }
): Promise<PromptTemplateGenerationResult> {
  const run = new PromptTemplateRun(input)
  return run.processMessages(input.messages, input.virtualBlocks, input.specialEntries)
}

export async function processPromptTemplateOutput(
  input: PromptTemplateRuntimeInput & {
    block: ChatBlock
    contentParts: ChatContentPart[]
    specialEntries: RuntimeWorldEntry[]
  }
): Promise<PromptTemplateOutputResult> {
  const run = new PromptTemplateRun(input)
  return run.processOutput(input.block, input.contentParts, input.specialEntries)
}

export async function processPromptTemplateBlockRender(
  input: PromptTemplateRuntimeInput & {
    block: ChatBlock
    contentParts: ChatContentPart[]
    specialEntries: RuntimeWorldEntry[]
  }
): Promise<PromptTemplateBlockProjectionResult> {
  const run = new PromptTemplateRun({ ...input, dryRun: true })
  return run.processBlockRender(input.block, input.contentParts, input.specialEntries)
}
