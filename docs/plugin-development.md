# ST-Forge 插件开发文档

本文面向希望为 ST-Forge 编写第三方项目插件的开发者。内容只描述当前代码已经实现的能力，不包含规划中的接口。

## 插件模型概览

ST-Forge 的插件是项目级资源。一个项目目录中包含：

- `plugins/<pluginId>`：插件本体目录，放 `plugin.json`、入口脚本、设置页 HTML、图片/CSS 等静态资源。
- `pluginData/<pluginId>`：插件数据目录，插件通过运行时 API 读写这里的数据。
- `forge.project.json`：项目配置，保存项目级启用插件列表和新聊天默认启用插件列表。
- `forge.db`：聊天、聊天块、LLM 实例等项目数据库。

插件有两层启用状态：

- 项目级启用：在插件页启用后，插件才会作为项目可用插件参与运行时。
- 聊天级启用：每个聊天可以单独启用/禁用项目中的插件。

插件依赖通过 `plugin.json` 的 `dependencies` 声明。运行时会按依赖顺序加载插件；如果某个插件的依赖没有安装或没有同时在项目级和聊天级启用，这个插件不会参与当前聊天的运行。

依赖关系不能形成循环。当前插件列表会按依赖做拓扑排序；一旦发现循环依赖，会抛出错误并阻止插件列表正常排序。

## 安装方式

当前第三方插件没有内置市场或安装 UI。开发者或用户需要把插件目录放到当前项目的 `plugins` 目录下：

```text
<project>/
  plugins/
    my_plugin/
      plugin.json
      initGlobal.js
      chatBlockProcessor.js
      settings.html
  pluginData/
    my_plugin/
```

应用打开项目时会扫描 `plugins` 目录中的子目录。插件目录内必须包含 `plugin.json` 或 `manifest.json`。新增或替换插件后，建议重新打开项目或重启应用，让项目快照重新读取插件列表。

## 插件 ID

插件 ID 必须满足：

- 只能使用字母、数字、下划线。
- 第一个字符必须是字母或下划线。
- 不能使用保留 ID `base`。

合法示例：

```text
my_plugin
worldbook_tools
_experimentalTools
```

不合法示例：

```text
my-plugin
123_plugin
base
```

插件目录名必须与插件 ID 一致。当前扫描插件列表时会读取目录中的 manifest，但运行入口脚本、HTML 和静态资源时会用 `plugins/<pluginId>` 作为根目录；如果目录名和 `id` 不一致，插件可能出现在列表中，但入口文件会读取失败。

## manifest

插件 manifest 使用 JSON。当前支持 `plugin.json` 和 `manifest.json` 两个文件名，推荐使用 `plugin.json`。

```json
{
  "id": "my_plugin",
  "name": "我的插件",
  "description": "在生成前处理聊天上下文。",
  "versionCode": 1,
  "dependencies": [],
  "entry": {
    "initGlobal": "initGlobal.js",
    "initChat": "initChat.js",
    "chatBlockProcessor": "chatBlockProcessor.js",
    "settingsHtml": "settings.html",
    "toolCalls": []
  }
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 是 | 插件 ID。必须满足 ID 规则。 |
| `name` | `string` | 否 | 插件在 UI 中显示的名称。为空时显示 ID。 |
| `description` | `string` | 否 | 插件说明。 |
| `versionCode` | `number` | 否 | 整数版本号，默认 `1`。改变它会使插件运行时签名变化，从而触发运行时重建。 |
| `dependencies` | `string[]` | 否 | 依赖插件 ID 列表。 |
| `entry` | `object` | 否 | 插件入口声明。 |

`entry` 当前支持：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `initGlobal` | `string` | 全局初始化脚本路径。 |
| `initChat` | `string` | 聊天初始化脚本路径。 |
| `chatBlockProcessor` | `string` | 聊天块处理器脚本路径。 |
| `settingsHtml` | `string` | 插件设置页 HTML 路径。 |
| `toolCalls` | `PluginToolCallManifest[]` | 插件工具调用组。 |
| `chatHtml` | `string` | 当前已被 manifest 解析，但没有 UI 消费，不要依赖。 |

所有路径都相对于插件目录。路径会被限制在插件目录内部，不能通过 `../` 逃逸到外部目录。

## 入口脚本格式

入口脚本可以是两种形式。

ES module：

```js
export default function initGlobal(context, myAppPlugins) {
  return {
    hello() {
      return `hello from ${context.plugin.id}`
    }
  }
}
```

普通脚本：

```js
return {
  hello() {
    return `hello from ${context.plugin.id}`
  }
}
```

运行时判断脚本中是否包含顶层 `import` 或 `export`。如果包含，会把脚本作为 ES module 加载；否则用 `AsyncFunction('context', 'myAppPlugins', code)` 执行。

ES module 的默认导出可以是函数，也可以是对象。默认导出是函数时，运行时会调用：

```js
entry(context, myAppPlugins)
```

普通脚本可以直接使用入参变量 `context` 和 `myAppPlugins`，并通过 `return` 返回结果。

如果入口脚本使用 TypeScript、多文件源码、第三方依赖或相对 import，需要先打包成单个自包含的 JS 文件。插件运行时是从脚本文本创建 blob module；未打包的相对 import 无法按插件目录解析。

## 类型与辅助函数

仓库内提供了 `@st-forge/plugin-api` 包，里面导出当前插件系统的类型和少量辅助函数：

```ts
import type { PluginRuntimeContext, ProcessingChat } from '@st-forge/plugin-api'
import { asRecord, asString, textFromContentParts } from '@st-forge/plugin-api'
```

在仓库内开发插件时，可以直接依赖这个 workspace 包。第三方插件如果在仓库外开发，需要确保最终入口 JS 是自包含产物：类型导入应在构建时被擦除，运行时依赖应被打包进入口文件。

常用导出包括：

- `types`：manifest、聊天、聊天块、工具调用、运行时上下文等类型。
- `value-utils`：`asRecord`、`asString` 等安全取值工具。
- `chat-blocks`：`baseMessagesFromBlocks`、`textFromContentParts`、`chatBlockTargetRole` 等聊天块工具。

处理器返回值、工具输出、写入 storage 的 JSON 都应该保持可 JSON 序列化。函数、DOM 对象、循环引用、`Map`、`Set` 等复杂对象不应跨宿主边界返回。

## 生命周期

当前运行时有三个主要入口：

1. `initGlobal`
2. `initChat`
3. `chatBlockProcessor`

工具调用还有独立的 `handler` 入口，见“工具调用”。

### initGlobal

`initGlobal` 在插件运行时初始化或重建时执行。它适合暴露纯函数、解析器、共享工具方法等与具体聊天无关的能力。

```js
export default function initGlobal(context) {
  return {
    normalize(value) {
      return String(value ?? '').trim()
    }
  }
}
```

返回值会放入 `myAppPlugins.global[pluginId]`。依赖此插件的其他插件可以通过 `myAppPlugins.global.<pluginId>` 访问。

`initGlobal` 的 `context` 通常包含：

- `context.api`
- `context.plugin`

全局初始化不应依赖某个聊天或某组聊天块。当前实现中全局运行时按项目签名缓存，开发者不应假设它会在每次聊天切换或聊天级插件启用变化时重新执行。

### initChat

`initChat` 在准备某个聊天的显示块或生成上下文时执行。它适合为当前聊天构建轻量状态。

```js
export default function initChat(context) {
  return {
    chatId: context.chat?.id ?? null,
    blockCount: context.blocks?.length ?? 0
  }
}
```

返回值会放入 `myAppPlugins.chat[pluginId]`。同一轮插件处理中的后续插件可以读取它。

`initChat` 的 `context` 包含：

- `context.api`
- `context.plugin`
- `context.chat`
- `context.blocks`

### chatBlockProcessor

`chatBlockProcessor` 是聊天块处理缓存的核心入口。它需要返回一个带 `process` 方法的对象，`process` 的参数和返回值都是 `ProcessingChat`。

```js
export default function chatBlockProcessor(context) {
  return {
    async process(chat) {
      return {
        ...chat,
        pluginData: {
          ...chat.pluginData,
          myPlugin: { enabled: true }
        }
      }
    }
  }
}
```

`process(chat)` 会按插件依赖顺序执行。每个处理器都会接收上一个处理器返回的 `ProcessingChat`。

`ProcessingChat` 当前包含：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `chatSession` | `ChatSession` | 当前聊天，包含 `pluginData`。 |
| `pluginData` | `JsonRecord` | 要写回 `chat.runtimeConfig.pluginData` 的 patch。 |
| `chatBlocks` | `MixedChatBlock[]` | 处理链路中的聊天块。 |

`MixedChatBlock.original` 是从数据库块拆出的只读原始块，插件不得修改。插件可以新增 `original` 为空的块；也可以通过 `user` 或 `llm` 控制用户视角和 LLM 视角内容。若要隐藏某个块，把对应视角设置为空对象即可，例如 `llm: {}`。

处理结束后，前端会校验所有带 `original` 的块仍然存在且相对顺序一致。`pluginData` 和块级 `pluginData` 会作为 patch 写回；插件对 `original.metadata` 的修改不会写回。

## 聊天块与消息

当前聊天块类型：

```ts
type ChatBlockKind = 'system' | 'user' | 'assistant' | 'injection'
```

当前内容片段类型：

```ts
type ChatContentPart =
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
      sendAsContext?: boolean
      createdAt: string
      updatedAt: string
      extensions: Record<string, unknown>
    }
```

基础消息转换规则由 `baseMessagesFromBlocks` 提供：

- 只读取 `enabled === true` 的块。
- `system`、`user`、`assistant` 块使用自身角色。
- `injection` 块使用 `metadata.targetRole`，默认 `system`。
- `text` 片段会拼入消息文本。
- `reasoning` 和 `tool_call` 片段只有在 `sendAsContext === true` 时会以文本形式拼入上下文。

## 插件块

插件不再返回数据库形态的虚拟块。需要注入只用于显示或上下文的内容时，可以在 `ProcessingChat.chatBlocks` 中新增没有 `original` 的 `MixedChatBlock`。

```js
return {
  ...chat,
  chatBlocks: [
    {
      role: 'system',
      llm: { content: '注入给模型的内容' },
      user: { contentParts: [{ type: 'text', text: '用户视角里展示的说明' }] }
    },
    ...chat.chatBlocks
  ]
}
```

没有 `original` 的块不会写入数据库，也不会在原始视角显示。前端会为这类块生成临时 key；插件无需提供数据库 ID。

## 运行时 API

入口脚本通过 `context.api` 访问宿主能力。

```ts
interface PluginRuntimeApi {
  assetUrl(path: string): string
  chat: PluginChatApi
  storage: PluginStorageApi
}
```

### assetUrl

`context.api.assetUrl(path)` 返回当前插件静态资源的 URL：

```js
const url = context.api.assetUrl('images/avatar.png')
```

返回 URL 使用 `huaianext://<pluginId>/` 协议，只能定位当前插件目录内的文件。插件设置页 HTML 会自动注入 `<base href="huaianext://<pluginId>/">`，因此页面可以直接用相对路径或根路径引用插件目录中的 CSS、JS、图片、字体、JSON 等静态资源。

### storage

插件数据存储 API：

```ts
interface PluginStorageApi {
  list(path?: string): Promise<PluginFileEntry[]>
  listFor(pluginId: string, path?: string): Promise<PluginFileEntry[]>
  readText(path: string): Promise<string>
  readTextFor(pluginId: string, path: string): Promise<string>
  writeText(path: string, content: string): Promise<void>
  writeTextFor(pluginId: string, path: string, content: string): Promise<void>
  readJson(path: string, fallback?: unknown): Promise<unknown>
  readJsonFor(pluginId: string, path: string, fallback?: unknown): Promise<unknown>
  writeJson(path: string, value: unknown): Promise<void>
  writeJsonFor(pluginId: string, path: string, value: unknown): Promise<void>
}
```

行为说明：

- `list()` 会读取 `pluginData/<pluginId>/<path>`，目录不存在时会创建目录。
- `readText()` 读取文本文件；文件不存在时返回空字符串。
- `writeText()` 会自动创建父目录。
- `readJson()` 会读取并解析 JSON；读取或解析失败时返回 fallback，未传 fallback 时返回 `{}`。
- 所有路径都会被限制在目标插件的数据目录内，不能通过 `../` 访问外部文件。
- `*For(pluginId, ...)` 可以读写其他插件的数据目录。当前没有额外权限系统，应只在明确依赖或用户明确配置的集成场景中使用。

### chat

聊天数据 API：

```ts
interface ChatSession {
  id: number
  title: string
  pluginData: JsonRecord
  createdAt: string
  updatedAt: string
}

interface PluginChatApi {
  getSession(): ChatSession | null
  getPluginData(): JsonRecord
  setPluginData(value: JsonRecord): Promise<ChatSession | null>
  getBlockPluginData(blockId: number): JsonRecord
  setBlockPluginData(blockId: number, value: JsonRecord): Promise<OriginalChatBlock | null>
}
```

插件入口中的 `context.chat`、`state.chat` 和 `getSession()` 都只包含聊天 ID、标题、插件数据和时间戳，不暴露宿主的完整运行时配置。

`getPluginData()` 读取当前插件在当前聊天中的数据。

`setPluginData(value)` 会把值写回当前聊天，并触发项目快照刷新。

`getBlockPluginData(blockId)` 读取指定块 `block.metadata.pluginData[pluginId]`。

`setBlockPluginData(blockId, value)` 会把值写回指定聊天块，并触发项目快照刷新。

这些方法需要当前上下文里有 `chat` 和 `blocks`。`initGlobal` 和工具调用 handler 中没有具体聊天块上下文，`chat` API 可能返回空对象或 `null`，不要在这些入口里依赖它。

## 插件间共享

入口函数第二个参数 `myAppPlugins` 提供插件作用域：

```ts
interface PluginScopes {
  global: Record<string, unknown>
  chat: Record<string, unknown>
}
```

`myAppPlugins.global` 包含：

- `base.plugins`：项目中全部插件 manifest 的 `Map`。
- 每个已初始化插件的 `initGlobal` 返回值，键为插件 ID。

`myAppPlugins.chat` 包含当前处理轮中每个插件的 `initChat` 返回值，键为插件 ID。

依赖其他插件时，应在 `dependencies` 中声明依赖，并在读取共享 API 时做类型检查。插件缺失、禁用或版本不兼容时，应给出清晰错误。

## 设置页

插件可以通过 `entry.settingsHtml` 提供设置页。插件启用后，用户可以在插件页打开该设置页。

设置页是一个独立 iframe：

- 宿主会读取插件目录中的 HTML 文件。
- 宿主会向 HTML 注入 `<base href="huaianext://<pluginId>/">`，方便使用相对路径加载插件静态资源。
- 宿主会注入 `window.parentPluginApi`。
- iframe 使用 sandbox，只允许脚本运行，不能直接访问 Electron、Node 或父窗口 DOM。

这意味着设置页和工具设置页不需要打包成单个 HTML 文件。只要最终文件位于 `plugins/<pluginId>` 下，HTML 可以像普通前端项目一样拆分引用：

```html
<link rel="stylesheet" href="./assets/settings.css">
<script type="module" src="./src/settings.js"></script>
<img src="/images/logo.png" alt="">
```

设置页可用 API：

```js
const api = window.parentPluginApi

await api.storage.writeJson('config.json', { enabled: true })
const config = await api.storage.readJson('config.json', {})
const files = await api.storage.list('presets')
```

`window.parentPluginApi.storage` 当前包含：

- `list(path)`
- `listFor(pluginId, path)`
- `readText(path)`
- `readTextFor(pluginId, path)`
- `writeText(path, content)`
- `writeTextFor(pluginId, path, content)`
- `readJson(path, fallback)`
- `writeJson(path, value)`

全局设置页应把长期配置写入 `pluginData/<pluginId>`。写入数据后，宿主会派发插件数据变更事件，聊天显示会重新准备插件显示块。

不要依赖 iframe 的同源存储、父窗口对象或 Electron API。设置页与宿主通信的稳定方式只有 `window.parentPluginApi`。

## 工具调用

插件可以把工具暴露给 LLM。工具调用由三部分组成：

1. manifest 中声明 `entry.toolCalls`。
2. 用户在聊天页的工具调用配置里启用工具组，并按需填写通参。
3. LLM 调用工具时，运行时执行插件的 handler。

### manifest 声明

```json
{
  "entry": {
    "toolCalls": [
      {
        "name": "worldbook_edit",
        "label": "世界书编辑工具组",
        "handler": "handler.js",
        "settingsHtml": "toolSettings.html",
        "prompt": "你可以使用世界书编辑工具组来查看、测试或更新世界书。",
        "tools": [
          {
            "name": "list_entries",
            "description": "列出条目 ID 和标题。",
            "inputSchema": {
              "type": "object",
              "properties": {},
              "additionalProperties": false
            }
          }
        ]
      }
    ]
  }
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | `string` | 工具调用组名称。 |
| `label` | `string` | UI 显示名称。 |
| `handler` | `string` | 工具处理脚本路径。 |
| `settingsHtml` | `string` | 工具通参设置页。 |
| `prompt` | `string` | 工具组说明文本。当前生成运行时不会自动把它作为上下文发送给模型。 |
| `tools` | `PluginToolSchema[]` | 提供给 LLM 的工具 schema 列表。 |

`tools[].inputSchema` 是 JSON Schema，会传给 AI SDK 的 `jsonSchema()`。工具输出应是可 JSON 序列化的值。

工具名称会作为 AI SDK 的 tools 对象 key。当前没有重复名称检测；同一聊天上下文中如果多个已配置工具组使用相同 `toolName`，后者可能覆盖前者。建议所有工具名在活跃聊天内保持唯一。

### 聊天工具配置

工具只有在当前聊天的 `runtimeConfig.toolDefinitions` 中存在对应配置时才会暴露给 LLM。配置结构形如：

```json
{
  "pluginId": "my_plugin",
  "toolCallName": "worldbook_edit",
  "commonArgs": {}
}
```

生成时，宿主会根据聊天工具配置和已启用插件收集工具 schema，并把 `commonArgs` 透传给 handler。工具配置本身不会生成聊天块，也不会自动写入 system 消息；如果工具需要模型看到额外说明，可以通过 `chatBlockProcessor` 添加没有 `original` 的 `MixedChatBlock`。

聊天页顶部的“工具调用”按钮会打开配置对话框。manifest 可以声明多个工具调用组，用户可以在该对话框中逐个添加、删除和配置。

### 工具通参设置页

`toolCalls[].settingsHtml` 会显示在聊天工具配置对话框中。它除了 storage API 外，还能使用：

```js
const args = await window.parentPluginApi.toolSettings.getCommonArgs()
await window.parentPluginApi.toolSettings.setCommonArgs({
  worldBookFile: 'main.json'
})
```

`commonArgs` 会保存在当前聊天的工具配置中，并在工具调用时传给 handler。适合存放“本工具组绑定哪个文件”“使用哪个 profile”等不应由模型每次决定的参数。

### handler

工具 handler 入口需要返回带 `handle` 方法的对象。

```js
export default function handler(context, myAppPlugins) {
  return {
    async handle(request) {
      if (request.toolName === 'list_entries') {
        return []
      }
      throw new Error(`未知工具：${request.toolName}`)
    }
  }
}
```

`request` 结构：

```ts
interface PluginToolCallRequest {
  chatId: number
  toolCallName: string
  toolName: string
  input: Record<string, unknown>
  commonArgs: Record<string, unknown>
}
```

handler 的 `context` 当前包含：

- `context.api`
- `context.plugin`

handler 没有当前聊天块列表，也没有经过清理的项目快照。需要当前聊天 ID 时使用 `request.chatId`。需要工具配置时使用 `request.commonArgs`。需要持久数据时使用 `context.api.storage`。

工具调用超时时间是 120 秒。生成运行时在启用工具时会设置默认工具循环上限为 8 步。

## 生成流程

用户点击生成回复时，流程如下：

1. 读取当前聊天的 `ProcessingChat` 缓存；如果缓存正在刷新，则等待刷新完成。
2. 如果是重新生成某个助手块，只使用缓存中位于该块之前的内容。
3. 从 `ProcessingChat.chatBlocks[].llm` 生成最终 messages；未设置 `llm` 的块会回退到 `original`。
4. 从聊天级工具配置收集工具 schema。
5. 调用 LLM。

`chatBlockProcessor` 只会在进入聊天页、实际存储的非 generating 块发生影响 `OriginalChatBlock` 的变化、或插件相关数据变化时运行。进入聊天页的首次运行不会写回 `pluginData`；后续由块或插件数据变化触发的运行会写回 patch。

## 调试建议

当前没有专门的插件调试面板。建议使用以下方式排查：

- 在插件页确认插件是否已启用。
- 在聊天的“更多操作”菜单确认当前聊天是否启用了插件。
- 使用“查看将要发送的上下文”检查最终 `messages`。
- 打开聊天块“详情”检查当前视角、`metadata`、`contentParts` 和 source/display 差异。
- 工具调用结果会显示在助手块的 `tool_call` 片段中，可展开查看 input、output、error 和 extensions。
- 插件设置写入的数据保存在项目目录的 `pluginData/<pluginId>` 中，可直接检查 JSON 文件。
- 修改入口脚本后，更新 `versionCode`、重新打开项目或重启应用，可以避免旧运行时缓存干扰。

入口脚本抛出的错误会通过 UI toast 或生成错误显示出来。建议错误消息直接说明缺少哪个配置、哪个依赖插件不可用、哪个数据文件解析失败。

## 安全与限制

当前插件系统的限制：

- 插件运行在浏览器 iframe 沙箱中，没有 Node.js、Electron、shell 或任意文件系统访问能力。
- 插件只能通过宿主 API 读取插件目录文件和插件数据目录文件。
- 运行时脚本沙箱禁止网络连接；设置页 iframe 不应把网络访问作为稳定插件能力。
- 插件数据路径会被限制在目标插件数据目录内。
- 当前没有第三方插件安装器、签名校验、权限声明或权限授权 UI。
- `storage.*For` 可以访问其他插件的数据目录，当前没有细粒度权限控制。
- `chatHtml` manifest 字段当前没有 UI 消费。
- 多个 `toolCalls` 可以声明；聊天页工具调用对话框会列出当前聊天可用的工具组。
- 入口脚本如果使用 import，需要预先打包为单文件入口。

开发者应把插件设计为可恢复、可重复执行：处理器不要依赖全局可变状态的执行次数，不要在显示刷新时无条件写入数据，不要假设其他插件一定存在或已启用。

## 当前内置插件参考

仓库中有三个内置插件，可作为当前能力的参考实现：

- `packages/plugins/silly_tavern_compat`：使用 `initGlobal`、`initChat`、`chatBlockProcessor` 和 `settingsHtml`。
- `packages/plugins/st_prompt_template_compat`：在处理器中重写 blocks 与 messages。
- `packages/plugins/character_card_tool_calls`：声明工具调用组、工具通参设置页和 handler。

第三方插件不需要使用内置插件打包脚本。只要最终插件目录中包含 manifest、入口 JS 和 HTML/静态资源，ST-Forge 就能从项目 `plugins` 目录加载它。
