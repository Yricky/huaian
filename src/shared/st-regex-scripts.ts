import type { CharacterEntry, JsonRecord } from './types'
import { asBoolean, asNumberOrNull, asRecord, asString } from './value-utils'

export const REGEX_PLACEMENT = {
  MD_DISPLAY: 0,
  USER_INPUT: 1,
  AI_OUTPUT: 2,
  SLASH_COMMAND: 3,
  WORLD_INFO: 5,
  REASONING: 6
} as const

export type RegexPlacement = typeof REGEX_PLACEMENT[keyof typeof REGEX_PLACEMENT]

export const SUBSTITUTE_FIND_REGEX = {
  NONE: 0,
  RAW: 1,
  ESCAPED: 2
} as const

export interface RegexScriptData {
  id?: string
  scriptName?: string
  findRegex?: string
  replaceString?: string
  trimStrings?: string[]
  placement?: number[]
  disabled?: boolean
  markdownOnly?: boolean
  promptOnly?: boolean
  runOnEdit?: boolean
  substituteRegex?: number
  minDepth?: number | null
  maxDepth?: number | null
}

export interface RegexMacroContext {
  character: CharacterEntry | null
  characterOverride?: string
  userName?: string
}

export interface RegexApplyOptions extends RegexMacroContext {
  enabled?: boolean
  isMarkdown?: boolean
  isPrompt?: boolean
  isEdit?: boolean
  depth?: number
}

const DEFAULT_USER_NAME = 'User'
const DEFAULT_ASSISTANT_NAME = 'Assistant'
const ALL_ACTIVE_PLACEMENTS = [
  REGEX_PLACEMENT.USER_INPUT,
  REGEX_PLACEMENT.AI_OUTPUT,
  REGEX_PLACEMENT.SLASH_COMMAND,
  REGEX_PLACEMENT.WORLD_INFO,
  REGEX_PLACEMENT.REASONING
]

export function characterData(character: CharacterEntry | null): JsonRecord {
  return asRecord(character?.stData?.data)
}

export function characterName(character: CharacterEntry | null): string {
  return asString(characterData(character).name, DEFAULT_ASSISTANT_NAME).trim() || DEFAULT_ASSISTANT_NAME
}

export function replaceCharacterMacros(
  value: string,
  character: CharacterEntry | null,
  options: { characterOverride?: string; userName?: string; transform?: (value: string) => string } = {}
): string {
  const transform = options.transform ?? ((text: string) => text)
  const char = options.characterOverride?.trim() || characterName(character)
  const user = options.userName?.trim() || DEFAULT_USER_NAME
  const macros: Record<string, string> = {
    char,
    user,
    charIfNotGroup: char
  }

  return value.replace(/\{\{([^{}]+)\}\}/g, (match, rawName: string) => {
    const key = rawName.trim()
    const canonicalKey = Object.keys(macros).find(name => name.toLowerCase() === key.toLowerCase())
    return canonicalKey ? transform(macros[canonicalKey]) : match
  })
}

function sanitizeRegexMacro(value: string): string {
  return value.replace(/[\n\r\t\v\f\0.^$*+?{}[\]\\/|()]/gs, (match) => {
    switch (match) {
      case '\n':
        return '\\n'
      case '\r':
        return '\\r'
      case '\t':
        return '\\t'
      case '\v':
        return '\\v'
      case '\f':
        return '\\f'
      case '\0':
        return '\\0'
      default:
        return `\\${match}`
    }
  })
}

function regexFromString(input: string): RegExp | null {
  try {
    const match = input.match(/(\/?)(.+)\1([a-z]*)/i)
    if (!match) return null
    const flags = match[3] ?? ''
    if (flags && !/^(?!.*?(.).*?\1)[gimsuy]+$/.test(flags)) {
      return new RegExp(input)
    }
    return new RegExp(match[2], flags)
  } catch {
    return null
  }
}

class RegexProvider {
  private cache = new Map<string, RegExp>()
  private maxSize = 1000

  get(regexString: string): RegExp | null {
    const cached = this.cache.get(regexString)
    const regex = cached ?? regexFromString(regexString)
    if (!regex) return null

    if (cached) {
      this.cache.delete(regexString)
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) this.cache.delete(firstKey)
    }
    this.cache.set(regexString, regex)

    if (regex.global || regex.sticky) regex.lastIndex = 0
    return regex
  }
}

const regexProvider = new RegexProvider()

function normalizePlacement(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.map(item => Number(item)).filter(Number.isFinite)
}

function normalizeScript(value: unknown): RegexScriptData | null {
  const raw = asRecord(value)
  const placement = normalizePlacement(raw.placement)
  const hasMdDisplay = placement.includes(REGEX_PLACEMENT.MD_DISPLAY)
  const nextPlacement = hasMdDisplay
    ? placement.length === 1
      ? ALL_ACTIVE_PLACEMENTS
      : placement.filter(item => item !== REGEX_PLACEMENT.MD_DISPLAY)
    : placement

  return {
    id: asString(raw.id),
    scriptName: asString(raw.scriptName),
    findRegex: asString(raw.findRegex),
    replaceString: asString(raw.replaceString),
    trimStrings: Array.isArray(raw.trimStrings) ? raw.trimStrings.map(item => String(item)) : [],
    placement: nextPlacement,
    disabled: asBoolean(raw.disabled, false),
    markdownOnly: hasMdDisplay ? true : asBoolean(raw.markdownOnly, false),
    promptOnly: hasMdDisplay ? true : asBoolean(raw.promptOnly, false),
    runOnEdit: asBoolean(raw.runOnEdit, false),
    substituteRegex: Number(raw.substituteRegex ?? SUBSTITUTE_FIND_REGEX.NONE),
    minDepth: asNumberOrNull(raw.minDepth),
    maxDepth: asNumberOrNull(raw.maxDepth)
  }
}

export function getCharacterRegexScripts(character: CharacterEntry | null): RegexScriptData[] {
  const extensions = asRecord(characterData(character).extensions)
  const scripts = extensions.regex_scripts
  if (!Array.isArray(scripts)) return []
  return scripts.map(normalizeScript).filter((script): script is RegexScriptData => script !== null)
}

export function characterHasRegexScripts(character: CharacterEntry | null): boolean {
  return getCharacterRegexScripts(character).length > 0
}

function scriptAppliesToMode(script: RegexScriptData, options: RegexApplyOptions): boolean {
  return Boolean(
    script.markdownOnly && options.isMarkdown ||
    script.promptOnly && options.isPrompt ||
    !script.markdownOnly && !script.promptOnly && !options.isMarkdown && !options.isPrompt
  )
}

function scriptAppliesToDepth(script: RegexScriptData, depth: number | undefined): boolean {
  if (typeof depth !== 'number') return true
  const minDepth = script.minDepth
  if (minDepth !== null && minDepth !== undefined && !Number.isNaN(minDepth) && minDepth >= -1 && depth < minDepth) {
    return false
  }
  const maxDepth = script.maxDepth
  if (maxDepth !== null && maxDepth !== undefined && !Number.isNaN(maxDepth) && maxDepth >= 0 && depth > maxDepth) {
    return false
  }
  return true
}

function findRegexString(script: RegexScriptData, options: RegexMacroContext): string {
  const findRegex = script.findRegex ?? ''
  switch (Number(script.substituteRegex)) {
    case SUBSTITUTE_FIND_REGEX.NONE:
      return findRegex
    case SUBSTITUTE_FIND_REGEX.RAW:
      return replaceCharacterMacros(findRegex, options.character, options)
    case SUBSTITUTE_FIND_REGEX.ESCAPED:
      return replaceCharacterMacros(findRegex, options.character, {
        ...options,
        transform: sanitizeRegexMacro
      })
    default:
      return findRegex
  }
}

function filterString(rawString: string, trimStrings: string[], options: RegexMacroContext): string {
  let finalString = rawString
  for (const trimString of trimStrings) {
    const subTrimString = replaceCharacterMacros(trimString, options.character, options)
    if (!subTrimString) continue
    finalString = finalString.split(subTrimString).join('')
  }
  return finalString
}

function runRegexScript(script: RegexScriptData, rawString: string, options: RegexMacroContext): string {
  if (script.disabled || !script.findRegex || !rawString) return rawString
  const findRegex = regexProvider.get(findRegexString(script, options))
  if (!findRegex) return rawString

  return rawString.replace(findRegex, (...args) => {
    const replaceString = (script.replaceString ?? '').replace(/{{match}}/gi, '$0')
    const replaceWithGroups = replaceString.replace(/\$(\d+)|\$<([^>]+)>/g, (_placeholder, num: string, groupName: string) => {
      const groups = args[args.length - 1]
      const match = num
        ? args[Number(num)]
        : groups && typeof groups === 'object'
          ? groups[groupName]
          : undefined

      if (!match) return ''
      return filterString(String(match), script.trimStrings ?? [], options)
    })

    return replaceCharacterMacros(replaceWithGroups, options.character, options)
  })
}

export function getRegexedString(rawString: string, placement: RegexPlacement, options: RegexApplyOptions): string {
  if (typeof rawString !== 'string') return ''
  if (options.enabled === false || !rawString) return rawString

  let finalString = rawString
  for (const script of getCharacterRegexScripts(options.character)) {
    if (!scriptAppliesToMode(script, options)) continue
    if (!scriptAppliesToDepth(script, options.depth)) continue
    if (!script.placement?.includes(placement)) continue
    finalString = runRegexScript(script, finalString, options)
  }
  return finalString
}

function getProjectedRegexedString(
  rawString: string,
  placement: RegexPlacement,
  options: RegexApplyOptions,
  projection: 'prompt' | 'markdown'
): string {
  if (typeof rawString !== 'string') return ''
  if (options.enabled === false || !rawString) return rawString

  const normalized = getRegexedString(rawString, placement, {
    ...options,
    isMarkdown: false,
    isPrompt: false,
    isEdit: false
  })
  return getRegexedString(normalized, placement, {
    ...options,
    isMarkdown: projection === 'markdown',
    isPrompt: projection === 'prompt',
    isEdit: false
  })
}

export function getRegexedPromptString(rawString: string, placement: RegexPlacement, options: RegexApplyOptions): string {
  return getProjectedRegexedString(rawString, placement, options, 'prompt')
}

export function getRegexedMarkdownString(rawString: string, placement: RegexPlacement, options: RegexApplyOptions): string {
  return getProjectedRegexedString(rawString, placement, options, 'markdown')
}
