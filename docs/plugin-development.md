# Huaian 应用开发文档

本文描述 Huaian 当前的应用开发模型。应用是一个运行在 iframe 中的网页。这个网页在开发时集成 `@huaian/app-api`，从而访问 Huaian 提供的存储、存档、chatSession、LLM 回复和工具调用能力。

## 1. 核心模型

Huaian 是面向角色扮演的 AI 应用运行平台。每个 app 本质上是一个单页网页应用：

- app 被打包为 zip。
- zip 根目录必须包含 `app.json` 和 `index.html`。
- app 安装后会被解压到当前项目目录的 `app/<appId>`。
- app 被打开时，Huaian 会创建或打开一个 appSession，并把 app 的 `index.html` 放到 iframe 中运行。
- app 通过 `@huaian/app-api` 和宿主通信，不直接访问 Electron、Node、项目路径或其他 app 的数据。

项目内与 app 相关的目录如下：

```text
app/<appId>                         # app 包文件，类似部署后的静态网页根目录
appData/<appId>                     # app 全局配置/数据目录
appSave/<appId>/<appSessionId>      # 某个 appSession 的存档目录
forge.db                            # 项目数据库，保存 appSession 元数据和 LLM 配置
forge.project.json                  # 项目配置
```

`appData` 和 `appSave` 的区别：

- `appData/<appId>`：同一个 app 的全局数据，例如默认设置、素材索引、全局解锁状态。
- `appSave/<appId>/<appSessionId>`：某个存档的数据，例如剧情进度、角色状态、app 自己持久化的 chatSession 列表。

Huaian 宿主只保存 appSession 元数据，不会落盘保存 app 内部的 chatSession。app 如果希望下次打开存档时恢复聊天状态，需要自行写入 `ha.save`。

## 2. app 包结构

最小 app 包：

```text
my-app.zip
├── app.json
├── index.html
└── assets/
    └── main.js
```

要求：

- `app.json` 必须在 zip 根目录。
- `index.html` 必须在 zip 根目录。
- 不支持 zip 中多套一层目录。
- app 入口固定为 `index.html`。
- app 应实现为单页应用。允许 hash 路由和 `history.pushState`，但 iframe 顶层 reload 或跳到其他 HTML 会被视为 appSession 关闭。
- 静态资源使用相对路径即可，例如 `./assets/main.js`、`./assets/style.css`。

## 3. app.json

示例：

```json
{
  "id": "roleplay.studio-demo",
  "name": "角色扮演 Demo",
  "description": "一个演示 Huaian app SDK 的最小角色扮演应用。",
  "version": 1,
  "icon": "icon.png"
}
```

字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 是 | appId。只能包含大小写字母、数字、下划线、短横线和英文句号。 |
| `name` | `string` | 否 | UI 显示名称。为空时显示 `id`。 |
| `description` | `string` | 否 | UI 显示说明。 |
| `version` | `number` | 是 | 整数版本号。创建 appSession 时会记录当时版本。 |
| `icon` | `string` | 否 | app 包内相对路径。没有时宿主显示默认图标。 |

安装同 id 的 app 会覆盖 `app/<appId>`，但不会删除 `appData/<appId>`、`appSave/<appId>` 或已有 appSession 元数据。运行中的 app 暂不允许更新或卸载，需要先关闭对应 appSession。

## 4. 开发环境

app 可以用任意前端工具开发。Huaian SDK 包名为 `@huaian/app-api`。

在本仓库内开发示例 app 时，可以直接引用 workspace 包：

```bash
pnpm add @huaian/app-api
```

如果 app 在独立仓库开发，可以先把 SDK 作为本地依赖、workspace 依赖或发布后的 npm 依赖接入。最终产物只需要是普通静态网页文件，不需要 Node 运行时。

一个 Vite app 的典型构建产物：

```text
dist/
├── app.json
├── index.html
└── assets/
    ├── index.js
    └── index.css
```

打包：

```bash
cd dist
zip -r ../roleplay.studio-demo.zip .
```

注意 `zip` 命令要在产物根目录内执行，保证 `app.json` 和 `index.html` 位于 zip 根目录。

## 5. 安装 SDK

app 页面不会自动注入全局 API。你需要在 app 代码中安装客户端：

```ts
import { ensureHuaianAppApi } from '@huaian/app-api'

const ha = ensureHuaianAppApi()
```

`ensureHuaianAppApi()` 会复用已有 API，并把 API 暴露到 `window.huaian`：

```ts
const ha = window.huaian
```

SDK 调用会等待宿主通过 `MessagePort` 建立连接。因此你可以在页面初始化时立即创建 API 对象，随后 `await` 具体方法。

推荐在初始 HTML 中尽早加载一个预连接模块：

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <script type="module" src="/src/ensureConnect.ts"></script>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/ensureConnect.ts`：

```ts
import { ensureHuaianAppApi } from '@huaian/app-api'

ensureHuaianAppApi()
```

不要给这个脚本添加 `async`，也不要等到 `window.load`、框架组件 `mounted` / `effect` 或用户交互后再调用。宿主会在 iframe `load` 后发送连接消息；初始模块脚本会在 `load` 前执行，因此这种写法可以避免错过宿主连接。

## 6. 运行上下文

获取当前运行上下文：

```ts
const context = await ha.context()
```

返回：

```ts
interface AppFrameContext {
  appId: string
  appVersion: number
  appSessionId: number
  appSessionTitle: string
}
```

说明：

- `appId`：当前 app 的 id。
- `appVersion`：当前安装 app 的版本。
- `appSessionId`：当前存档 id。每个 app 内从 `0` 开始自增。
- `appSessionTitle`：用户在宿主中看到的存档名称。

Huaian 不向 app 暴露项目路径。

## 7. 存储 API

SDK 提供两个隔离的存储命名空间：

```ts
ha.appData
ha.save
```

二者 API 相同：

```ts
interface AppStorageApi {
  list(path?: string): Promise<AppFileEntry[]>
  mkdir(path: string): Promise<void>
  readText(path: string): Promise<string>
  readBytes(path: string): Promise<ArrayBuffer>
  writeText(path: string, content: string): Promise<void>
  writeBytes(path: string, content: ArrayBuffer): Promise<void>
  delete(path: string, options?: { recursive?: boolean }): Promise<void>
  readJson(path: string, fallback?: unknown): Promise<unknown>
  writeJson(path: string, value: unknown): Promise<void>
}
```

文件列表项：

```ts
interface AppFileEntry {
  name: string
  path: string
  isDirectory: boolean
  size?: number
}
```

示例：

```ts
await ha.appData.mkdir('settings')
await ha.appData.writeJson('settings/global.json', {
  textSpeed: 1,
  theme: 'dark'
})

const settings = await ha.appData.readJson('settings/global.json', {
  textSpeed: 1,
  theme: 'default'
})

await ha.save.mkdir('state')
await ha.save.writeJson('state/progress.json', {
  chapter: 3,
  flags: ['met_alice']
})

const files = await ha.save.list('state')
```

路径规则：

- 路径使用 `/` 分隔。
- 不能通过 `../` 离开当前 app 的目录。
- app 只能访问自己的 `appData` 和当前 appSession 的 `save`。
- `readText` 读取不存在的文件时返回空字符串。
- `readBytes` 读取不存在的文件时返回空 `ArrayBuffer`。
- `readJson` 读取失败或 JSON 解析失败时返回传入的 `fallback`。
- 删除目录时需要传 `{ recursive: true }`。

```ts
await ha.save.delete('cache', { recursive: true })
```

## 8. chatSession 模型

chatSession 是 appSession 内的运行时对象，由 app 创建和管理。Huaian 宿主负责渲染聊天面板、接收用户输入、触发 LLM、展示流式回复，但不会把 chatSession 自动写入数据库。

chatSession 状态：

```ts
interface AppChatSessionState {
  id: number
  title: string
  messages: AppChatMessage[]
  tools: AppToolDefinition[]
  llmInstanceId: number | null
  allowUserReply: boolean
  options: string[]
  status: 'idle' | 'generating' | 'stopped' | 'error'
  errorText: string
}
```

消息：

```ts
interface AppChatMessage {
  id: number
  role: 'system' | 'user' | 'assistant'
  contentParts: AppChatContentPart[]
  status: 'idle' | 'generating' | 'stopped' | 'error'
  metadata: Record<string, unknown>
  errorText: string
  createdAt: string
  updatedAt: string
}
```

内容片段：

```ts
type AppChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string; sendAsContext?: boolean }
  | {
      type: 'tool_call'
      toolCallId: string
      toolName: string
      status: 'pending' | 'success' | 'error'
      input: Record<string, unknown>
      output?: unknown
      error?: string
      createdAt: string
      updatedAt: string
      extensions?: Record<string, unknown>
    }
```

工具定义：

```ts
interface AppToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}
```

`llmInstanceId` 如果不传，宿主会默认使用项目里的第一个 LLM 实例。项目没有可用 LLM 实例时，触发 LLM 回复会报错。

## 9. chatSession API

```ts
interface AppChatApi {
  createSession(payload?: AppChatSessionCreatePayload): Promise<AppChatSessionState>
  listSessions(): Promise<AppChatSessionState[]>
  getSession(chatSessionId: number): Promise<AppChatSessionState>
  updateSession(chatSessionId: number, patch: AppChatSessionUpdatePayload): Promise<AppChatSessionState>
  deleteSession(chatSessionId: number): Promise<AppChatSessionState[]>
  appendMessage(chatSessionId: number, payload: AppChatMessageCreatePayload): Promise<AppChatMessage>
  updateMessage(chatSessionId: number, messageId: number, patch: AppChatMessageUpdatePayload): Promise<AppChatMessage>
  deleteMessage(chatSessionId: number, messageId: number): Promise<AppChatSessionState>
  registerTool(chatSessionId: number, tool: AppToolDefinition, handler: AppToolHandler): Promise<AppChatSessionState>
  triggerLlmReply(chatSessionId: number): Promise<AppChatSessionState>
  stopLlmReply(chatSessionId: number): Promise<void>
}
```

创建一个 chatSession：

```ts
const session = await ha.chat.createSession({
  title: '主线剧情',
  allowUserReply: true,
  options: ['观察四周', '询问艾琳', '离开房间'],
  messages: [
    {
      id: 0,
      role: 'system',
      status: 'idle',
      contentParts: [{ type: 'text', text: '你是一个奇幻 RPG 的叙事主持人。' }],
      metadata: {},
      errorText: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ]
})
```

更常见的写法是让宿主分配 message id：

```ts
const session = await ha.chat.createSession({ title: '主线剧情' })

await ha.chat.appendMessage(session.id, {
  role: 'system',
  content: '你是一个奇幻 RPG 的叙事主持人。'
})
```

用户是否可以输入由 `allowUserReply` 控制：

```ts
await ha.chat.updateSession(session.id, {
  allowUserReply: false,
  options: ['继续', '查看背包']
})
```

`options` 是字符串数组。用户点击某个选项时，效果等同于用户输入该字符串并发送。宿主会自动清空当前 `options`，app 收到事件后可以再写入新的选项。

生成中的 chatSession 不能被 app 修改。也就是说，在 `status === 'generating'` 期间，`updateSession`、`appendMessage`、`updateMessage`、`deleteMessage` 等会被宿主拒绝。等生成结束、停止或报错后再修改。

## 10. 用户输入事件

宿主不会自动把用户输入写入 messages。用户在聊天面板发送消息或点击选项时，宿主只向 app 发事件：

```ts
ha.on('userMessage', async event => {
  await ha.chat.appendMessage(event.chatSessionId, {
    role: 'user',
    content: event.text
  })

  await ha.chat.triggerLlmReply(event.chatSessionId)
})
```

事件结构：

```ts
type UserMessageEvent = {
  type: 'userMessage'
  chatSessionId: number
  text: string
  source: 'composer' | 'option'
}
```

如果 app 不处理这个事件，聊天面板不会显示用户刚才输入的内容。这是设计行为：app 可以拦截、改写、忽略用户输入，或把它转化为多条消息。

## 11. LLM 回复

触发 LLM 回复：

```ts
await ha.chat.triggerLlmReply(session.id)
```

宿主会：

1. 根据当前 chatSession 的 `messages` 构造 prompt。
2. 自动创建一条 assistant message。
3. 将流式 delta 写入这条 assistant message。
4. 在聊天面板中展示流式回复。
5. 同时向 app 发送 LLM 事件。

LLM 事件：

```ts
ha.on('llmReplyStarted', event => {
  console.log('started', event.chatSessionId, event.assistantMessageId)
})

ha.on('llmReplyDelta', event => {
  console.log('delta', event.text)
})

ha.on('llmReplyFinished', async event => {
  const session = await ha.chat.getSession(event.chatSessionId)
  await ha.save.writeJson('chat/main.json', session)
})

ha.on('llmReplyStopped', event => {
  console.log('stopped', event.chatSessionId)
})

ha.on('llmReplyError', event => {
  console.error(event.error)
})
```

停止回复：

```ts
await ha.chat.stopLlmReply(session.id)
```

如果用户在宿主 UI 中停止回复，app 会收到：

```ts
ha.on('userStoppedReply', event => {
  console.log('user stopped', event.chatSessionId)
})
```

## 12. 工具调用

每个 chatSession 独立注册工具。工具定义使用 JSON Schema 描述输入：

```ts
await ha.chat.registerTool(session.id, {
  name: 'roll_dice',
  description: 'Roll dice in NdM format, for example 2d6.',
  inputSchema: {
    type: 'object',
    properties: {
      dice: {
        type: 'string',
        description: 'Dice expression, such as 1d20 or 2d6.'
      }
    },
    required: ['dice'],
    additionalProperties: false
  }
}, async input => {
  const dice = String(input.dice ?? '1d6')
  return {
    dice,
    total: 4
  }
})
```

当 LLM 发起工具调用时：

1. 宿主把工具调用事件发送给 app iframe。
2. SDK 找到对应 chatSession 和 toolName 的 handler。
3. handler 返回任意 JSON 可序列化值。
4. 宿主把结果返回给 LLM。
5. assistant message 中会出现 `tool_call` content part。

如果 handler 抛错、返回失败或 120 秒内没有响应：

- 对应 `tool_call` 会被标为 `error`。
- 错误结果会继续返回给 LLM，让模型有机会解释失败或换一种方式继续。
- 整次 LLM 生成不会因为单个工具失败而自动终止。

## 13. 持久化 chatSession

因为宿主不落盘 chatSession，app 应在关键时机把 session 写入 `ha.save`：

```ts
async function saveSession(chatSessionId: number) {
  const session = await ha.chat.getSession(chatSessionId)
  await ha.save.writeJson(`chat/${chatSessionId}.json`, session)
}

ha.on('llmReplyFinished', event => {
  void saveSession(event.chatSessionId)
})

ha.on('llmReplyStopped', event => {
  void saveSession(event.chatSessionId)
})

ha.on('llmReplyError', event => {
  void saveSession(event.chatSessionId)
})
```

下次打开同一个 appSession 时，app 可以从 `ha.save` 恢复：

```ts
const saved = await ha.save.readJson('chat/0.json', null)

if (saved && typeof saved === 'object') {
  await ha.chat.createSession(saved as any)
} else {
  await ha.chat.createSession({ title: '主线剧情' })
}
```

恢复时需要重新注册工具 handler，因为 handler 是 JavaScript 函数，不能被 JSON 持久化：

```ts
const session = await ha.chat.createSession(savedState)
await registerTools(session.id)
```

## 14. 最小完整示例

目录：

```text
demo-app/
├── app.json
├── index.html
└── src/
    └── main.ts
```

`app.json`：

```json
{
  "id": "demo.roleplay",
  "name": "Demo Roleplay",
  "description": "最小 Huaian app 示例。",
  "version": 1
}
```

`index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Demo Roleplay</title>
  </head>
  <body>
    <main>
      <h1>Demo Roleplay</h1>
      <button id="start">开始</button>
      <pre id="log"></pre>
    </main>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/main.ts`：

```ts
import { ensureHuaianAppApi } from '@huaian/app-api'

const ha = ensureHuaianAppApi()
const log = document.querySelector<HTMLPreElement>('#log')!
const start = document.querySelector<HTMLButtonElement>('#start')!

function write(message: string) {
  log.textContent += `${message}\n`
}

async function ensureSession() {
  const sessions = await ha.chat.listSessions()
  if (sessions[0]) return sessions[0]

  const session = await ha.chat.createSession({
    title: '主线',
    allowUserReply: true,
    options: ['环顾四周', '呼唤同伴']
  })

  await ha.chat.appendMessage(session.id, {
    role: 'system',
    content: '你是一个角色扮演游戏主持人。用中文描述场景，并给玩家明确行动反馈。'
  })

  await ha.chat.registerTool(session.id, {
    name: 'roll_dice',
    description: 'Roll a six-sided die.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  }, () => ({
    total: Math.floor(Math.random() * 6) + 1
  }))

  return session
}

ha.on('userMessage', async event => {
  await ha.chat.appendMessage(event.chatSessionId, {
    role: 'user',
    content: event.text
  })
  await ha.chat.triggerLlmReply(event.chatSessionId)
})

ha.on('llmReplyFinished', async event => {
  const session = await ha.chat.getSession(event.chatSessionId)
  await ha.save.writeJson('chat/main.json', session)
  write('回复已保存。')
})

start.addEventListener('click', async () => {
  const context = await ha.context()
  write(`appSession: ${context.appSessionId}`)
  const session = await ensureSession()
  write(`chatSession: ${session.id}`)
})
```

构建后，把 `app.json` 复制到构建产物根目录，确保 zip 根目录有 `app.json` 和 `index.html`。

## 15. appSession 生命周期

每个 app 同时只能运行一个 appSession。不同 app 可以同时运行自己的 appSession。

行为规则：

- 如果某个 app 已有运行中的 appSession，再次点击这个 app 会直接跳转到运行中的 appSession。
- 运行中的 appSession iframe 会保持挂载；切换到其他 app 后，它仍可继续运行和调用 SDK。
- 隐藏/显示状态不会通知 app。
- 用户关闭 appSession 时，iframe 会被销毁，所有内存 chatSession 也会被销毁。
- 如果关闭时有 LLM 正在生成，宿主会询问用户；确认后终止所有生成并关闭。
- iframe 刷新、崩溃或发生顶层重新加载会被视为 appSession 关闭。

因此 app 应当：

- 把需要恢复的数据写入 `ha.save`。
- 在每次启动时从 `ha.save` 恢复状态。
- 每次 iframe 重新连接后重新注册工具 handler。

## 16. 安全与隔离

当前隔离模型：

- app 页面运行在 iframe 中。
- app 页面没有 Electron preload。
- app 页面没有 Node API。
- app 页面不能访问项目路径。
- app 只能通过 SDK 访问自己的 `appData` 和当前 appSession 的 `save`。
- `ha-app://` 下的资源只能读取当前安装 app 包内的文件。

不要把敏感密钥写入 app 包。LLM provider 的 API Key 由 Huaian 项目设置管理，app 只引用 `llmInstanceId` 或使用默认 LLM 实例。

## 17. 常见开发模式

### 17.1 让 app 自己管理聊天

推荐模式：

1. app 打开时从 `ha.save` 读取自己的游戏状态。
2. app 根据游戏状态创建一个或多个 chatSession。
3. app 监听 `userMessage`。
4. app 决定是否把用户输入写入 messages。
5. app 决定何时调用 `triggerLlmReply`。
6. app 在回复结束后写回 `ha.save`。

### 17.2 选项式交互

```ts
await ha.chat.updateSession(session.id, {
  allowUserReply: false,
  options: ['攻击', '防御', '交涉']
})

ha.on('userMessage', async event => {
  if (event.source === 'option') {
    await ha.chat.appendMessage(event.chatSessionId, {
      role: 'user',
      content: `玩家选择：${event.text}`
    })
    await ha.chat.triggerLlmReply(event.chatSessionId)
  }
})
```

### 17.3 多 chatSession

一个 appSession 可以创建多个 chatSession，例如：

- 主线剧情
- 角色内心独白
- 世界设定查询
- 战斗裁定

```ts
const main = await ha.chat.createSession({ title: '主线剧情' })
const lore = await ha.chat.createSession({
  title: '世界设定',
  allowUserReply: true
})
```

宿主右侧窄栏会展示当前 appSession 的所有 chatSession。用户点击某个 chatSession 后，iframe 左侧会展开聊天面板。

## 18. 调试建议

- 先在浏览器中把 app 当普通网页调试，确认 UI 和本地逻辑正常。
- 与 Huaian 集成时，所有 SDK 调用都应 `await` 并捕获错误。
- 打包前检查 zip 根目录，不要把 `dist/` 本身套进 zip。
- 如果 chat 面板没有出现消息，确认 app 是否在 `userMessage` 事件中主动调用了 `appendMessage`。
- 如果 LLM 不能回复，检查项目设置里是否已有 LLM provider 和 LLM instance。
- 如果工具调用没有触发 handler，确认每次 app 启动后都调用了 `registerTool`。
- 如果恢复的 chatSession 工具不可用，确认恢复后重新注册了工具 handler。
