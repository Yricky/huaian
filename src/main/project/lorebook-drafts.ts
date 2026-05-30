import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import type {
  CharacterBookEntryData,
  JsonRecord,
  LoreBookDraftApplyPayload,
  LoreBookDraftChange,
  LoreBookDraftSummary,
  ProjectSnapshot,
  WorldEntry
} from '../../shared/types'
import { testWorldEntryActivations } from '../../shared/st-prompt-builder'
import {
  createWorldEntry,
  getLoreBook,
  getProjectSnapshot,
  listLoreBooks,
  listWorldEntriesForBook,
  updateWorldEntry
} from './store'
import { ensureProject } from './state'
import { asRecord, cloneJson, defaultWorldEntry, normalizeWorldEntryData, toBoolean, toNumber, toString } from './normalizers'

interface LoreBookDraftFile {
  toolSessionId: string
  loreBookId: number
  createdAt: string
  updatedAt: string
  entries: WorldEntry[]
}

export interface LoreBookEntryUpsertInput {
  id?: number | null
  title?: string
  order?: number | null
  position?: number | null
  role?: number | string | null
  depth?: number | null
  outletName?: string
  probability?: number | null
  enabled?: boolean
  constant?: boolean
  selective?: boolean
  selectiveLogic?: number | null
  keys?: string[]
  secondaryKeys?: string[]
  content?: string
}

function draftRoot(): string {
  return join(ensureProject().path, 'tmp', 'lorebook')
}

function safeToolSessionId(value: string): string {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120)
  if (!cleaned) throw new Error('世界书工具会话 ID 无效。')
  return cleaned
}

function draftPath(toolSessionId: string): string {
  return join(draftRoot(), `${safeToolSessionId(toolSessionId)}.json`)
}

async function ensureDraftDir(): Promise<void> {
  await mkdir(draftRoot(), { recursive: true })
}

function nowIso(): string {
  return new Date().toISOString()
}

function cloneEntry(entry: WorldEntry): WorldEntry {
  return cloneJson(entry)
}

function entryTitle(entry: WorldEntry): string {
  const comment = toString(entry.stData.comment).trim()
  return comment || `Entry #${entry.id}`
}

function normalizeDraftFile(value: unknown): LoreBookDraftFile | null {
  const record = asRecord(value)
  const toolSessionId = toString(record.toolSessionId)
  const loreBookId = Number(record.loreBookId)
  if (!toolSessionId || !Number.isInteger(loreBookId)) return null
  const entries = Array.isArray(record.entries)
    ? record.entries.map(item => {
        const entry = asRecord(item)
        return {
          id: toNumber(entry.id, 0),
          loreBookId,
          createdAt: toString(entry.createdAt, nowIso()),
          updatedAt: toString(entry.updatedAt, nowIso()),
          stData: normalizeWorldEntryData(entry.stData),
          forgeData: asRecord(entry.forgeData)
        }
      }).filter(entry => entry.id !== 0)
    : []

  return {
    toolSessionId,
    loreBookId,
    createdAt: toString(record.createdAt, nowIso()),
    updatedAt: toString(record.updatedAt, nowIso()),
    entries
  }
}

async function readDraft(toolSessionId: string): Promise<LoreBookDraftFile | null> {
  try {
    const parsed = JSON.parse(await readFile(draftPath(toolSessionId), 'utf-8'))
    return normalizeDraftFile(parsed)
  } catch {
    return null
  }
}

async function writeDraft(draft: LoreBookDraftFile): Promise<void> {
  await ensureDraftDir()
  await writeFile(draftPath(draft.toolSessionId), JSON.stringify(draft, null, 2), 'utf-8')
}

export async function ensureLoreBookDraft(toolSessionId: string, loreBookId: number): Promise<LoreBookDraftFile> {
  getLoreBook(loreBookId)
  const existing = await readDraft(toolSessionId)
  if (existing && existing.loreBookId === loreBookId) return existing

  const now = nowIso()
  const draft: LoreBookDraftFile = {
    toolSessionId: safeToolSessionId(toolSessionId),
    loreBookId,
    createdAt: now,
    updatedAt: now,
    entries: listWorldEntriesForBook(loreBookId).map(cloneEntry)
  }
  await writeDraft(draft)
  return draft
}

function nextDraftEntryId(entries: WorldEntry[]): number {
  const minId = entries.reduce((value, entry) => Math.min(value, entry.id), 0)
  return minId <= 0 ? minId - 1 : -1
}

function normalizeRole(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  if (value === 'system') return 0
  if (value === 'user') return 1
  if (value === 'assistant') return 2
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(2, Math.trunc(number))) : null
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value.map(item => String(item).trim()).filter(Boolean)
}

function applyUpsertInput(data: CharacterBookEntryData, input: LoreBookEntryUpsertInput): CharacterBookEntryData {
  const next = normalizeWorldEntryData(data)
  const extensions = asRecord(next.extensions)

  if (input.title !== undefined) next.comment = String(input.title)
  if (input.content !== undefined) next.content = String(input.content)
  if (input.enabled !== undefined) next.enabled = toBoolean(input.enabled, true)
  if (input.constant !== undefined) next.constant = toBoolean(input.constant, false)
  if (input.selective !== undefined) next.selective = toBoolean(input.selective, false)
  if (input.order !== undefined && input.order !== null) next.insertion_order = toNumber(input.order, next.insertion_order)

  const keys = stringArray(input.keys)
  if (keys) next.keys = keys
  const secondaryKeys = stringArray(input.secondaryKeys)
  if (secondaryKeys) next.secondary_keys = secondaryKeys

  if (input.position !== undefined && input.position !== null) {
    const position = toNumber(input.position, toNumber(extensions.position, 0))
    extensions.position = position
    next.position = position === 1 ? 'after_char' : 'before_char'
  }
  const role = normalizeRole(input.role)
  if (role !== null) extensions.role = role
  if (input.depth !== undefined && input.depth !== null) extensions.depth = Math.max(0, toNumber(input.depth, 4))
  if (input.outletName !== undefined) extensions.outlet_name = String(input.outletName)
  if (input.probability !== undefined && input.probability !== null) {
    extensions.probability = Math.max(0, Math.min(100, toNumber(input.probability, 100)))
  }
  if (input.selectiveLogic !== undefined && input.selectiveLogic !== null) {
    extensions.selectiveLogic = Math.max(0, Math.min(3, toNumber(input.selectiveLogic, 0)))
  }

  next.extensions = extensions
  return normalizeWorldEntryData(next)
}

export async function listLoreBookDraftEntries(toolSessionId: string, loreBookId: number): Promise<Array<[number, string]>> {
  const draft = await ensureLoreBookDraft(toolSessionId, loreBookId)
  return draft.entries
    .sort((a, b) => a.stData.insertion_order - b.stData.insertion_order || a.id - b.id)
    .map(entry => [entry.id, entryTitle(entry)])
}

export async function getLoreBookDraftEntriesJson(
  toolSessionId: string,
  loreBookId: number,
  ids: number[]
): Promise<WorldEntry[]> {
  const draft = await ensureLoreBookDraft(toolSessionId, loreBookId)
  const entryById = new Map(draft.entries.map(entry => [entry.id, entry]))
  return ids
    .map(id => entryById.get(Number(id)))
    .filter((entry): entry is WorldEntry => Boolean(entry))
    .map(cloneEntry)
}

export async function testLoreBookDraftTrigger(toolSessionId: string, loreBookId: number, example: string) {
  const draft = await ensureLoreBookDraft(toolSessionId, loreBookId)
  return testWorldEntryActivations(draft.entries, example)
}

export async function upsertLoreBookDraftEntry(
  toolSessionId: string,
  loreBookId: number,
  input: LoreBookEntryUpsertInput
): Promise<{ success: true; id: number; title: string }> {
  const draft = await ensureLoreBookDraft(toolSessionId, loreBookId)
  const now = nowIso()
  const requestedId = input.id === null || input.id === undefined ? null : Number(input.id)
  const existingIndex = Number.isInteger(requestedId)
    ? draft.entries.findIndex(entry => entry.id === requestedId)
    : -1

  if (existingIndex >= 0) {
    const existing = draft.entries[existingIndex]
    const stData = applyUpsertInput(existing.stData, input)
    draft.entries[existingIndex] = { ...existing, stData, updatedAt: now }
    draft.updatedAt = now
    await writeDraft(draft)
    return { success: true, id: existing.id, title: entryTitle(draft.entries[existingIndex]) }
  }

  const stData = applyUpsertInput(defaultWorldEntry(), {
    ...input,
    order: input.order ?? draft.entries.length + 1
  })
  const entry: WorldEntry = {
    id: nextDraftEntryId(draft.entries),
    loreBookId,
    createdAt: now,
    updatedAt: now,
    stData,
    forgeData: {}
  }
  draft.entries.push(entry)
  draft.updatedAt = now
  await writeDraft(draft)
  return { success: true, id: entry.id, title: entryTitle(entry) }
}

function comparableEntryData(value: CharacterBookEntryData): JsonRecord {
  const data = normalizeWorldEntryData(value)
  return {
    comment: data.comment ?? '',
    keys: data.keys,
    secondary_keys: data.secondary_keys ?? [],
    content: data.content,
    constant: !!data.constant,
    selective: !!data.selective,
    insertion_order: data.insertion_order,
    enabled: data.enabled,
    position: data.position,
    extensions: {
      position: asRecord(data.extensions).position,
      role: asRecord(data.extensions).role,
      depth: asRecord(data.extensions).depth,
      outlet_name: asRecord(data.extensions).outlet_name,
      probability: asRecord(data.extensions).probability,
      selectiveLogic: asRecord(data.extensions).selectiveLogic
    }
  }
}

function changed(original: CharacterBookEntryData, draft: CharacterBookEntryData): boolean {
  return JSON.stringify(comparableEntryData(original)) !== JSON.stringify(comparableEntryData(draft))
}

function draftChanges(draft: LoreBookDraftFile): LoreBookDraftChange[] {
  const originals = new Map(listWorldEntriesForBook(draft.loreBookId).map(entry => [entry.id, entry]))
  return draft.entries
    .map((entry): LoreBookDraftChange | null => {
      const original = originals.get(entry.id)
      if (!original) {
        return {
          id: entry.id,
          kind: 'created' as const,
          title: entryTitle(entry),
          original: null,
          draft: normalizeWorldEntryData(entry.stData)
        }
      }
      if (!changed(original.stData, entry.stData)) return null
      return {
        id: entry.id,
        kind: 'updated' as const,
        title: entryTitle(entry),
        original: normalizeWorldEntryData(original.stData),
        draft: normalizeWorldEntryData(entry.stData)
      }
    })
    .filter((change): change is LoreBookDraftChange => change !== null)
}

function draftSummary(draft: LoreBookDraftFile): LoreBookDraftSummary | null {
  const loreBook = listLoreBooks().find(book => book.id === draft.loreBookId)
  if (!loreBook) return null
  const changes = draftChanges(draft)
  return {
    toolSessionId: draft.toolSessionId,
    loreBookId: draft.loreBookId,
    loreBookName: loreBook.name,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    changes
  }
}

export async function listLoreBookDrafts(): Promise<LoreBookDraftSummary[]> {
  await ensureDraftDir()
  const files = await readdir(draftRoot()).catch(() => [])
  const drafts = await Promise.all(
    files
      .filter(file => file.endsWith('.json'))
      .map(async file => {
        try {
          const parsed = JSON.parse(await readFile(join(draftRoot(), file), 'utf-8'))
          return normalizeDraftFile(parsed)
        } catch {
          return null
        }
      })
  )
  return drafts
    .filter((draft): draft is LoreBookDraftFile => draft !== null)
    .map(draftSummary)
    .filter((summary): summary is LoreBookDraftSummary => summary !== null)
    .filter(summary => summary.changes.length > 0)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function applyLoreBookDraft(payload: LoreBookDraftApplyPayload): Promise<ProjectSnapshot> {
  const draft = await readDraft(payload.toolSessionId)
  if (!draft) throw new Error('世界书副本不存在。')
  getLoreBook(draft.loreBookId)
  const selected = new Set(payload.entryIds.map(Number).filter(Number.isInteger))
  const originals = new Map(listWorldEntriesForBook(draft.loreBookId).map(entry => [entry.id, entry]))

  for (const entry of draft.entries) {
    if (!selected.has(entry.id)) continue
    const original = originals.get(entry.id)
    if (original) {
      updateWorldEntry({
        id: original.id,
        loreBookId: draft.loreBookId,
        stData: entry.stData,
        forgeData: original.forgeData
      })
      continue
    }

    const created = createWorldEntry(draft.loreBookId)
    updateWorldEntry({
      id: created.id,
      loreBookId: draft.loreBookId,
      stData: entry.stData,
      forgeData: {}
    })
  }

  await discardLoreBookDraft(payload.toolSessionId)
  return getProjectSnapshot()
}

export async function discardLoreBookDraft(toolSessionId: string): Promise<void> {
  await rm(draftPath(toolSessionId), { force: true })
}
