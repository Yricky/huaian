import type {
  JsonRecord,
  PluginRuntimeContext,
  PluginToolCallRequest,
  PluginToolHandler
} from '@huaian/plugin-api'
import { asRecord, asString } from '@huaian/plugin-api'
import { applyToolInput, entryTitle, normalizeWorldEntry } from './data'
import { testWorldEntryActivations } from './st-prompt-builder'

function entriesFromBook(book: JsonRecord): JsonRecord[] {
  return Array.isArray(book.entries) ? book.entries.map(asRecord) : []
}

export function worldbookEditToolHandler(context: PluginRuntimeContext): PluginToolHandler {
  return {
    name: 'lorebook_edit',
    label: '世界书编辑工具组',
    settingsHtml: 'toolSettings.html',
    prompt: '你可以使用世界书编辑工具组来查看、测试、更新或新建当前绑定世界书的条目草稿。\n重要规则：这些工具只会编辑插件数据目录中的世界书 JSON，不会直接修改聊天内容。\n更新条目前先列出条目，避免重复创建；不确定触发效果时先测试触发。',
    tools: [
      {
        name: 'list_lorebook_entries',
        description: '获取绑定世界书中的所有条目，只返回 [id, title] 二元组。',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false
        }
      },
      {
        name: 'get_lorebook_entries_json',
        description: '按 id 列表读取绑定世界书中的完整条目 JSON。',
        inputSchema: {
          type: 'object',
          properties: {
            ids: {
              type: 'array',
              items: { type: 'number' },
              description: '要读取完整 JSON 的世界书条目 id 列表。'
            }
          },
          required: ['ids'],
          additionalProperties: false
        }
      },
      {
        name: 'test_lorebook_trigger',
        description: '用一条例句测试绑定世界书会触发哪些条目。',
        inputSchema: {
          type: 'object',
          properties: {
            example: {
              type: 'string',
              description: '用于测试世界书触发的例句。'
            }
          },
          required: ['example'],
          additionalProperties: false
        }
      },
      {
        name: 'upsert_lorebook_entry',
        description: '更新或新建绑定世界书中的条目。',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'number', description: '要更新的世界书条目 id；不传时新建。' },
            title: { type: 'string', description: '世界书条目的显示标题或备忘。' },
            order: { type: 'number', description: '条目注入排序。' },
            position: {
              type: 'number',
              enum: [0, 1, 4, 5, 6],
              description: '0=角色定义前，1=角色定义后，4=At Depth，5/6=示例对话。'
            },
            role: {
              anyOf: [
                { type: 'number', enum: [0, 1, 2] },
                { type: 'string', enum: ['system', 'user', 'assistant'] }
              ],
              description: 'At Depth 使用的角色。0/system，1/user，2/assistant。'
            },
            depth: { type: 'number', description: 'At Depth 插入深度。' },
            probability: { type: 'number', minimum: 0, maximum: 100, description: '触发概率。' },
            enabled: { type: 'boolean', description: '是否启用。' },
            constant: { type: 'boolean', description: '是否常驻。' },
            selective: { type: 'boolean', description: '是否启用次关键词。' },
            selectiveLogic: { type: 'number', enum: [0, 1, 2, 3], description: '0=AND ANY，3=AND ALL，1=NOT ALL，2=NOT ANY。' },
            keys: { type: 'array', items: { type: 'string' }, description: '主关键词。' },
            secondaryKeys: { type: 'array', items: { type: 'string' }, description: '次关键词。' },
            content: { type: 'string', description: '条目触发后插入提示词中的正文。' }
          },
          additionalProperties: false
        }
      }
    ],
    async handle(request: PluginToolCallRequest) {
      const worldBookFile = asString(request.commonArgs.worldBookFile)
      if (!worldBookFile) throw new Error('工具通参缺少 worldBookFile。')
      const path = `worldbooks/${worldBookFile}`
      const book = asRecord(JSON.parse(await context.haExtApi.storage.readText(path)))
      const entries = entriesFromBook(book)
      const normalizedEntries = entries.map((entry, index) => (
        normalizeWorldEntry(entry, Number(entry.id ?? index + 1), 1)
      ))

      if (request.toolName === 'list_lorebook_entries') {
        return normalizedEntries
          .map(entry => asRecord(entry))
          .sort((a, b) => {
            const left = asRecord(a.stData)
            const right = asRecord(b.stData)
            return Number(left.insertion_order ?? 100) - Number(right.insertion_order ?? 100) || Number(a.id) - Number(b.id)
          })
          .map(entry => [entry.id, entryTitle(entry)])
      }

      if (request.toolName === 'get_lorebook_entries_json') {
        const ids = new Set(Array.isArray(request.input.ids) ? request.input.ids.map(Number) : [])
        return entries.filter((entry, index) => ids.has(Number(entry.id ?? index + 1)))
      }

      if (request.toolName === 'test_lorebook_trigger') {
        return testWorldEntryActivations(normalizedEntries, asString(request.input.example))
      }

      if (request.toolName === 'upsert_lorebook_entry') {
        const requestedId = request.input.id === undefined || request.input.id === null ? null : Number(request.input.id)
        const index = requestedId === null ? -1 : entries.findIndex((entry, entryIndex) => Number(entry.id ?? entryIndex + 1) === requestedId)
        if (index >= 0) {
          entries[index] = applyToolInput(entries[index], request.input)
          book.entries = entries
          await context.haExtApi.storage.writeText(path, `${JSON.stringify(book, null, 2)}\n`)
          return { success: true, id: requestedId, title: asString(entries[index].comment, `Entry #${requestedId}`) }
        }

        const nextId = Math.max(0, ...entries.map((entry, entryIndex) => Number(entry.id ?? entryIndex + 1)).filter(Number.isFinite)) + 1
        const created = applyToolInput({
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
        await context.haExtApi.storage.writeText(path, `${JSON.stringify(book, null, 2)}\n`)
        return { success: true, id: nextId, title: asString(created.comment, `Entry #${nextId}`) }
      }

      throw new Error(`未知世界书工具：${request.toolName}`)
    }
  }
}
