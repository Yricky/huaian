import type {
  JsonRecord,
  PluginGlobalRegistry,
  PluginRuntimeContext,
  PluginToolCallRequest,
  PluginToolHandler
} from '@st-forge/plugin-api'
import { asRecord, asString } from '@st-forge/plugin-api'

interface SillyTavernCompatApi {
  applyToolInput(entry: JsonRecord, input: JsonRecord): JsonRecord
  entryTitle(entry: unknown): string
  normalizeWorldEntry(value: unknown, id: number, loreBookId: number): unknown
  testWorldEntryActivations(entries: unknown[], example: string): unknown
}

function sillyTavernCompatApi(plugins: PluginGlobalRegistry): SillyTavernCompatApi {
  const api = asRecord(plugins.get('silly_tavern_compat')?.exports) as unknown as Partial<SillyTavernCompatApi>
  if (
    typeof api.applyToolInput !== 'function' ||
    typeof api.entryTitle !== 'function' ||
    typeof api.normalizeWorldEntry !== 'function' ||
    typeof api.testWorldEntryActivations !== 'function'
  ) {
    throw new Error('silly_tavern_compat 未暴露世界书工具 API。')
  }
  return api as SillyTavernCompatApi
}

function entriesFromBook(book: JsonRecord): JsonRecord[] {
  return Array.isArray(book.entries) ? book.entries.map(asRecord) : []
}

export default function handler(context: PluginRuntimeContext, plugins: PluginGlobalRegistry): PluginToolHandler {
  return {
    async handle(request: PluginToolCallRequest) {
      const compat = sillyTavernCompatApi(plugins)
      const worldBookFile = asString(request.commonArgs.worldBookFile)
      if (!worldBookFile) throw new Error('工具通参缺少 worldBookFile。')
      const path = `worldbooks/${worldBookFile}`
      const book = asRecord(JSON.parse(await context.haExtApi.storage.readTextFor('silly_tavern_compat', path)))
      const entries = entriesFromBook(book)
      const normalizedEntries = entries.map((entry, index) => (
        compat.normalizeWorldEntry(entry, Number(entry.id ?? index + 1), 1)
      ))

      if (request.toolName === 'list_lorebook_entries') {
        return normalizedEntries
          .map(entry => asRecord(entry))
          .sort((a, b) => {
            const left = asRecord(a.stData)
            const right = asRecord(b.stData)
            return Number(left.insertion_order ?? 100) - Number(right.insertion_order ?? 100) || Number(a.id) - Number(b.id)
          })
          .map(entry => [entry.id, compat.entryTitle(entry)])
      }
      if (request.toolName === 'get_lorebook_entries_json') {
        const ids = new Set(Array.isArray(request.input.ids) ? request.input.ids.map(Number) : [])
        return entries.filter((entry, index) => ids.has(Number(entry.id ?? index + 1)))
      }
      if (request.toolName === 'test_lorebook_trigger') {
        return compat.testWorldEntryActivations(normalizedEntries, asString(request.input.example))
      }
      if (request.toolName === 'upsert_lorebook_entry') {
        const requestedId = request.input.id === undefined || request.input.id === null ? null : Number(request.input.id)
        const index = requestedId === null ? -1 : entries.findIndex((entry, entryIndex) => Number(entry.id ?? entryIndex + 1) === requestedId)
        if (index >= 0) {
          entries[index] = compat.applyToolInput(entries[index], request.input)
          book.entries = entries
          await context.haExtApi.storage.writeTextFor('silly_tavern_compat', path, `${JSON.stringify(book, null, 2)}\n`)
          return { success: true, id: requestedId, title: asString(entries[index].comment, `Entry #${requestedId}`) }
        }
        const nextId = Math.max(0, ...entries.map((entry, entryIndex) => Number(entry.id ?? entryIndex + 1)).filter(Number.isFinite)) + 1
        const created = compat.applyToolInput({
          id: nextId,
          keys: [],
          secondary_keys: [],
          comment: '',
          content: '',
          constant: false,
          selective: false,
          insertion_order: entries.length + 1,
          enabled: true,
          position: 'before_char',
          extensions: { position: 0, depth: 4, role: 0, probability: 100, useProbability: true, selectiveLogic: 0 }
        }, request.input)
        created.id = nextId
        entries.push(created)
        book.entries = entries
        await context.haExtApi.storage.writeTextFor('silly_tavern_compat', path, `${JSON.stringify(book, null, 2)}\n`)
        return { success: true, id: nextId, title: asString(created.comment, `Entry #${nextId}`) }
      }
      throw new Error(`未知世界书工具：${request.toolName}`)
    }
  }
}
