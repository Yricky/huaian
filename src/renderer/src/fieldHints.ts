export const characterFieldHints = {
  name: '角色名称：在聊天、宏替换和提示词中标识这个角色。',
  version: '角色卡版本：用于追踪角色卡迭代，属于创作者元数据。',
  creator: '作者：角色制作者姓名或联系方式，属于创作者元数据，不随 AI 提示词发送。',
  exportFileName: '导出文件名：导出角色卡 JSON 时使用的文件名；留空时默认使用角色名。',
  characterBookName: '内嵌世界书名：导出角色卡内嵌世界书时使用的名称；留空时使用关联世界书名称。',
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
  depthPrompt: 'Depth Prompt：角色备注，会按指定身份插入到聊天中的指定深度。',
  depth: 'Depth：插入深度。0 表示最后一条消息之后，1 表示最后一条消息之前，依此类推。',
  role: 'Role：Depth Prompt 插入聊天时使用的身份，通常为 system、user 或 assistant。',
  advancedJson: '高级 JSON：直接编辑角色卡 stData。仅在需要处理未暴露字段或批量调整时使用。'
} as const

export const worldEntryFieldHints = {
  comment: '标题/Memo：世界书条目的显示标题或备忘，不作为触发关键词本身。',
  order: 'Order：世界书条目的注入排序；同位置下按顺序决定进入提示词的先后。',
  position: 'Position：条目内容插入位置。SillyTavern 中可插入到角色定义前后、示例消息前后、作者注释前后或指定深度。',
  role: 'Role：当条目按指定深度插入聊天时使用的身份。',
  depth: 'Depth：指定深度插入时使用；0 表示最后一条消息之后，1 表示最后一条消息之前，依此类推。',
  probability: 'Trigger %：条目触发后的插入概率，100 表示每次触发都插入。',
  enabled: '启用：切换世界书条目的激活状态。',
  constant: '常驻：不依赖关键词，条目会持续作为激活内容参与提示词。',
  selective: '次关键词逻辑：主关键词命中后，还需要次关键词参与判断。',
  keys: '主关键词：扫描上下文时用于触发此条目的关键词，以逗号分隔。',
  secondaryKeys: '次关键词：选择性触发时使用的辅助关键词，以逗号分隔。',
  content: '内容：世界书条目触发后插入到提示词中的正文。',
  advancedJson: '高级 JSON：直接编辑世界书条目原始数据。仅在需要处理未暴露字段时使用。'
} as const

export const loreBookFieldHints = {
  name: '名称：世界书的显示名称，也会作为导出 JSON 中的世界书名称。'
} as const
