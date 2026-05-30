export const characterFieldHints = {
  name: '角色名称：在聊天、宏替换和提示词中标识这个角色。',
  version: '角色卡版本：用于追踪角色卡迭代，属于创作者元数据。',
  creator: '作者：角色制作者姓名或联系方式，属于创作者元数据，不随 AI 提示词发送。',
  exportFileName: '导出文件名：导出角色卡 JSON 时使用的文件名；留空时默认使用角色名。',
  characterBookName: '内嵌世界书名：导出角色卡并写入关联世界书时使用的书名；留空时优先使用关联世界书名称。',
  talkativeness: '发言频率：参考 SillyTavern Talkativeness，控制角色在群聊中主动发言的频率。',
  description: '角色描述：角色的核心设定和背景，通常会进入角色定义提示词。',
  personality: '角色设定摘要：角色性格的简要描述。',
  scenario: '情景：角色与用户互动时所处的情况、背景和上下文。',
  firstMessage: '首条消息：新聊天开始时角色发出的第一条消息。',
  examples: '示例对话：用于定义角色的说话风格；SillyTavern 建议每段示例从新行的 START 开始。',
  creatorNotes: '作者备注：描述角色、使用技巧或测试模型；显示在角色列表中，不随 AI 提示词发送。',
  systemPrompt: 'System Prompt：替换此角色使用的默认主提示词。（v2: system_prompt）',
  postHistoryInstructions: 'Post-History Instructions：替换此角色使用的默认历史后置指令。（v2: post_history_instructions）',
  tags: '标签：以逗号分隔，会嵌入角色卡元数据，用于分类和检索。',
  alternateGreetings: '备用开场：额外的首条消息候选；本工具中用单独一行 --- 分隔多个开场。',
  depthPrompt: 'Depth Prompt：角色专属备注，会和下面的 Depth / Role 一起作为聊天内注入发送。',
  depth: 'Depth：Depth Prompt 的插入深度。0 最靠近下一次回复，1 在最新上下文消息前，数字越大越靠前。',
  role: 'Role：Depth Prompt 插入聊天时使用的消息身份；system 通常最像旁白/规则，user/assistant 会模拟对应发言方。',
  advancedJson: '高级 JSON：直接编辑角色卡 stData。仅在需要处理未暴露字段或批量调整时使用。'
} as const

export const worldEntryFieldHints = {
  comment: '标题/Memo：世界书条目的显示标题或备忘，不作为触发关键词本身。',
  order: 'Order：世界书条目的注入排序；可拖拽条目调整。同一插入位置下，Order 会影响内容进入提示词的先后。',
  position: 'Position：条目内容触发后插入到哪里。只有 At Depth 会使用 Role / Depth；Outlet 需要填写 Outlet 名称并通过宏引用。',
  role: 'Role：仅在 Position 为 At Depth 时生效，决定这段世界书内容以 system、user 还是 assistant 身份插入聊天。',
  depth: 'Depth：仅在 At Depth 时控制插入位置；0 最靠近下一次回复，1 在最新上下文消息前。它不是关键词扫描深度。',
  outletName: 'Outlet 名称：仅在 Position 为 Outlet 时使用。条目不会自动进提示词，需要在提示词中写 {{outlet::名称}} 来放置内容。',
  probability: 'Trigger %：主/次关键词条件命中后，再按这个概率决定是否插入；100 表示每次命中都插入。',
  scanDepth: '扫描深度：覆盖此条目用于关键词匹配的聊天消息数量；留空使用全局默认值，范围 0-1000。它不是 At Depth 的插入深度。',
  enabled: '启用：切换世界书条目的激活状态。',
  constant: '常驻：不依赖关键词，条目会直接参与激活；仍会受启用状态、概率和预算等规则影响。',
  selective: '启用次关键词过滤：主关键词命中后，还会用次关键词和下面的逻辑继续判断。',
  selectiveLogic: '次关键词逻辑：AND ANY 任一命中；AND ALL 全部命中；NOT ALL 至少一个未命中；NOT ANY 全部未命中。',
  keys: '主关键词：扫描上下文时用于触发此条目的关键词或正则。任意一个主关键词命中后，才会检查次关键词。',
  secondaryKeys: '次关键词：主关键词命中后的附加过滤条件；为空时不会参与判断。',
  content: '内容：世界书条目触发后插入到提示词中的正文。',
  advancedJson: '高级 JSON：直接编辑世界书条目原始数据。仅在需要处理未暴露字段时使用。'
} as const

export const loreBookFieldHints = {
  name: '名称：世界书的显示名称，也会作为导出 JSON 中的世界书名称。'
} as const
