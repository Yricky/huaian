import { dialog } from 'electron'
import { copyFile, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import type { CharacterBookEntryData, ExportResult, JsonRecord, WorldEntry } from '../../shared/types'
import { getCharacter, getWorldEntry } from './store'
import { ensureProject } from './state'
import {
  asRecord,
  normalizeCharacterCard,
  normalizeWorldEntryData,
  toBoolean,
  toNumber,
  toString
} from './normalizers'

function sanitizeFileName(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 120)
  return cleaned || fallback
}

function timestampForFileName(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function makeExportPath(baseName: string): string {
  const project = ensureProject()
  const safeBase = sanitizeFileName(baseName.replace(/\.json$/i, ''), 'export')
  return join(project.exportsPath, `${safeBase}-${timestampForFileName()}.json`)
}

async function writeExportFile(baseName: string, data: unknown): Promise<ExportResult> {
  const historyPath = makeExportPath(baseName)
  await writeFile(historyPath, JSON.stringify(data, null, 2), 'utf-8')

  const result = await dialog.showSaveDialog({
    defaultPath: historyPath,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })

  if (!result.canceled && result.filePath) {
    if (resolve(result.filePath) !== resolve(historyPath)) {
      await copyFile(historyPath, result.filePath)
    }
    return { historyPath, savedPath: result.filePath }
  }

  return { historyPath }
}

function embeddedBookEntry(entry: WorldEntry, id: number): CharacterBookEntryData {
  const data = normalizeWorldEntryData(entry.stData)
  data.id = id
  data.extensions = {
    ...data.extensions,
    display_index: id
  }
  return data
}

export async function exportCharacter(id: number): Promise<ExportResult> {
  const character = getCharacter(id)
  const card = normalizeCharacterCard(character.stData)
  const data = asRecord(card.data)
  const existingBook = asRecord(data.character_book)
  const existingEntries = Array.isArray(existingBook.entries) ? existingBook.entries : []
  const selectedWorldEntries = character.forgeData.worldEntryIds.map(getWorldEntry)
  const embeddedEntries = selectedWorldEntries.map((entry, index) => embeddedBookEntry(entry, existingEntries.length + index))

  if (existingEntries.length || embeddedEntries.length) {
    data.character_book = {
      ...existingBook,
      name: character.forgeData.characterBookName || toString(existingBook.name, `${toString(data.name, 'Character')}'s Lorebook`),
      extensions: asRecord(existingBook.extensions),
      entries: [...existingEntries, ...embeddedEntries]
    }
  }

  card.data = data
  const baseName = character.forgeData.exportFileName || toString(data.name, 'character-card')
  return writeExportFile(baseName, card)
}

function worldInfoEntry(entry: WorldEntry, uid: number): JsonRecord {
  const data = normalizeWorldEntryData(entry.stData)
  const extensions = asRecord(data.extensions)
  const position = toNumber(extensions.position, data.position === 'after_char' ? 1 : 0)

  return {
    uid,
    key: data.keys,
    keysecondary: data.secondary_keys || [],
    comment: data.comment || '',
    content: data.content,
    constant: !!data.constant,
    vectorized: toBoolean(extensions.vectorized, false),
    selective: !!data.selective,
    selectiveLogic: toNumber(extensions.selectiveLogic, 0),
    addMemo: !!data.comment,
    order: data.insertion_order,
    position,
    disable: !data.enabled,
    ignoreBudget: toBoolean(extensions.ignore_budget, false),
    excludeRecursion: toBoolean(extensions.exclude_recursion, false),
    preventRecursion: toBoolean(extensions.prevent_recursion, false),
    matchPersonaDescription: toBoolean(extensions.match_persona_description, false),
    matchCharacterDescription: toBoolean(extensions.match_character_description, false),
    matchCharacterPersonality: toBoolean(extensions.match_character_personality, false),
    matchCharacterDepthPrompt: toBoolean(extensions.match_character_depth_prompt, false),
    matchScenario: toBoolean(extensions.match_scenario, false),
    matchCreatorNotes: toBoolean(extensions.match_creator_notes, false),
    delayUntilRecursion: toNumber(extensions.delay_until_recursion, 0),
    probability: toNumber(extensions.probability, 100),
    useProbability: toBoolean(extensions.useProbability, true),
    depth: toNumber(extensions.depth, 4),
    outletName: toString(extensions.outlet_name),
    group: toString(extensions.group),
    groupOverride: toBoolean(extensions.group_override, false),
    groupWeight: toNumber(extensions.group_weight, 100),
    scanDepth: extensions.scan_depth ?? null,
    caseSensitive: extensions.case_sensitive ?? null,
    matchWholeWords: extensions.match_whole_words ?? null,
    useGroupScoring: extensions.use_group_scoring ?? null,
    automationId: toString(extensions.automation_id),
    role: extensions.role ?? null,
    sticky: extensions.sticky ?? null,
    cooldown: extensions.cooldown ?? null,
    delay: extensions.delay ?? null,
    displayIndex: uid,
    triggers: Array.isArray(extensions.triggers) ? extensions.triggers : []
  }
}

export async function exportWorldBook(id: string): Promise<ExportResult> {
  const project = ensureProject()
  const config = project.config.worldBookExports.find(item => item.id === id)
  if (!config) throw new Error('世界书导出配置不存在。')

  const entries = Object.fromEntries(
    config.worldEntryIds.map((entryId, index) => [String(index), worldInfoEntry(getWorldEntry(entryId), index)])
  )

  return writeExportFile(config.exportFileName || config.name, {
    name: config.name,
    extensions: {},
    entries
  })
}
