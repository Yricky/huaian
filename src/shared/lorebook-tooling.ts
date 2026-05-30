import type { JsonRecord, LoreBook } from './types'

export const LOREBOOK_EDIT_TOOL_GROUP = 'lorebook_edit'

export const LOREBOOK_EDIT_TOOL_NAMES = [
  'list_lorebook_entries',
  'get_lorebook_entries_json',
  'test_lorebook_trigger',
  'upsert_lorebook_entry'
] as const

export type LoreBookEditToolName = typeof LOREBOOK_EDIT_TOOL_NAMES[number]

export const loreBookToolFieldHints = {
  title: '标题/Memo：世界书条目的显示标题或备忘，不作为触发关键词本身。',
  order: 'Order：世界书条目的注入排序；可拖拽条目调整。同一插入位置下，Order 会影响内容进入提示词的先后。',
  position: 'Position：条目内容触发后插入到哪里。只有 At Depth 会使用 Role / Depth；Outlet 需要填写 Outlet 名称并通过宏引用。',
  role: 'Role：仅在 Position 为 At Depth 时生效，决定这段世界书内容以 system、user 还是 assistant 身份插入聊天。',
  depth: 'Depth：仅在 At Depth 时控制插入位置；0 最靠近下一次回复，1 在最新上下文消息前。它不是关键词扫描深度。',
  outletName: 'Outlet 名称：仅在 Position 为 Outlet 时使用。条目不会自动进提示词，需要在提示词中写 {{outlet::名称}} 来放置内容。',
  probability: 'Trigger %：主/次关键词条件命中后，再按这个概率决定是否插入；100 表示每次命中都插入。',
  enabled: '启用：切换世界书条目的激活状态。',
  constant: '常驻：不依赖关键词，条目会直接参与激活；仍会受启用状态、概率和预算等规则影响。',
  selective: '启用次关键词过滤：主关键词命中后，还会用次关键词和下面的逻辑继续判断。',
  selectiveLogic: '次关键词逻辑：AND ANY 任一命中；AND ALL 全部命中；NOT ALL 至少一个未命中；NOT ANY 全部未命中。',
  keys: '主关键词：扫描上下文时用于触发此条目的关键词或正则。任意一个主关键词命中后，才会检查次关键词。',
  secondaryKeys: '次关键词：主关键词命中后的附加过滤条件；为空时不会参与判断。',
  content: '内容：世界书条目触发后插入到提示词中的正文。'
} as const

export function defaultLoreBookEditPrompt(loreBook: LoreBook | null = null): string {
  const target = loreBook ? `当前绑定世界书：${loreBook.name}（ID ${loreBook.id}）。` : '当前工具定义块尚未绑定世界书。'
  return [
    '你可以使用世界书编辑工具组来查看、测试、更新或新建当前绑定世界书的条目草稿。',
    target,
    '',
    '重要规则：',
    '- 这些工具只会编辑临时副本，不会直接修改原版世界书。',
    '- 当用户要求整理、沉淀、修订世界书设定时，优先使用工具；闲聊、解释或普通润色时不要调用工具。',
    '- 更新条目前先用 list_lorebook_entries 查看现有条目，避免重复创建。',
    '- 需要查看现有条目完整内容时，用 get_lorebook_entries_json 传入 id 列表读取完整条目 JSON。',
    '- 不确定触发效果时，用 test_lorebook_trigger 传入例句验证。',
    '- upsert_lorebook_entry 传入 id 时会尝试更新该条目；不传 id 或 id 不存在时会新建条目，并返回新条目 id。',
    '- 不要声称已修改原版世界书；对话结束后用户会审阅 diff 并决定是否应用。',
    '',
    '可编辑字段说明：',
    `- title：${loreBookToolFieldHints.title}`,
    `- order：${loreBookToolFieldHints.order}`,
    `- position：${loreBookToolFieldHints.position}`,
    `- role：${loreBookToolFieldHints.role}`,
    `- depth：${loreBookToolFieldHints.depth}`,
    `- outletName：${loreBookToolFieldHints.outletName}`,
    `- probability：${loreBookToolFieldHints.probability}`,
    `- enabled：${loreBookToolFieldHints.enabled}`,
    `- constant：${loreBookToolFieldHints.constant}`,
    `- selective：${loreBookToolFieldHints.selective}`,
    `- selectiveLogic：${loreBookToolFieldHints.selectiveLogic}`,
    `- keys：${loreBookToolFieldHints.keys}`,
    `- secondaryKeys：${loreBookToolFieldHints.secondaryKeys}`,
    `- content：${loreBookToolFieldHints.content}`
  ].join('\n')
}

export function asToolDefinition(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}
