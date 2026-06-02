# ST-Forge 插件开发文档

本文描述当前插件系统已经实现的接口。旧的 `initChat`、独立 `chatBlockProcessor` 入口、工具 `handler` 文件入口、`window.parentPluginApi`、可见 iframe 的 preload/Node 能力都已经移除，不再兼容。

## 插件模型

ST-Forge 的插件是项目级资源：

- `plugins/<pluginId>`：插件目录，包含 `plugin.json`、入口脚本、页面 HTML、CSS、图片等资源。
- `pluginData/<pluginId>`：插件数据目录，插件通过 `haExtApi.storage` 读写这里的数据。
- `forge.project.json`：项目配置，保存项目级启用插件和新聊天默认启用插件。
- `forge.db`：聊天、聊天块、LLM 实例等项目数据库。

插件有两层启用状态：项目级启用决定插件是否作为项目插件参与运行；聊天级启用决定插件是否参与当前聊天处理。插件依赖通过 `dependencies` 声明，运行时按依赖顺序初始化；依赖缺失、未启用或形成循环时，对应插件不会正常参与运行。

插件 ID 必须只包含字母、数字、下划线，首字符必须是字母或下划线，且不能是 `base`。插件目录名必须与插件 ID 一致。

## Manifest

插件目录内必须有 `plugin.json` 或 `manifest.json`，推荐使用 `plugin.json`。

```json
{
  "id": "my_plugin",
  "name": "我的插件",
  "description": "在生成前处理聊天上下文。",
  "versionCode": 1,
  "dependencies": [],
  "entry": {
    "initGlobal": "initGlobal.js",
    "settingsHtml": "settings.html",
    "chatHtml": "chat.html",
    "toolCalls": [
      {
        "name": "my_tool_group",
        "label": "我的工具",
        "prompt": "需要时调用这些工具。",
        "settingsHtml": "toolSettings.html",
        "tools": [
          {
            "name": "my_tool",
            "description": "执行一个插件工具。",
            "inputSchema": {
              "type": "object",
              "properties": {
                "text": { "type": "string" }
              },
              "required": ["text"]
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
| `id` | `string` | 插件 ID。 |
| `name` | `string` | UI 显示名称，为空时显示 ID。 |
| `description` | `string` | 插件说明。 |
| `versionCode` | `number` | 整数版本号，默认 `1`。改变它会触发运行时重建。 |
| `dependencies` | `string[]` | 依赖插件 ID 列表。 |
| `entry.initGlobal` | `string` | Worker 全局运行时入口。 |
| `entry.settingsHtml` | `string` | 插件设置页。 |
| `entry.chatHtml` | `string` | 聊天页可见插件页面。 |
| `entry.toolCalls` | `PluginToolCallManifest[]` | 工具组声明。工具实现不再写在 manifest 中。 |

所有路径都相对于插件目录。宿主会限制路径不能通过 `../` 离开对应插件目录。

## 运行时

插件 JS 入口运行在一个 Dedicated Worker 中。Worker 是当前的全局插件运行时：所有启用插件按依赖顺序执行 `initGlobal`，每个插件返回的对象会登记到插件全局注册表中，后续插件可以读取之前插件的返回对象。

`initGlobal` 可以是 ES module，也可以是普通脚本。

ES module：

```ts
import type { PluginGlobalExport, PluginRuntimeContext } from '@st-forge/plugin-api'

export default function initGlobal(context: PluginRuntimeContext): PluginGlobalExport {
  return {
    exports: {
      normalize(value: unknown) {
        return String(value ?? '').trim()
      }
    }
  }
}
```

普通脚本：

```js
return {
  exports: {
    normalize(value) {
      return String(value ?? '').trim()
    }
  }
}
```

入口函数调用签名是：

```ts
initGlobal(context, plugins, haExtApi)
```

其中 `context.haExtApi` 和第三个参数 `haExtApi` 是同一个对象。推荐使用 `context.haExtApi`。

`initGlobal` 必须返回对象，结构固定为：

```ts
interface PluginGlobalExport {
  chatBlockProcessor?: {
    process(chat: ProcessingChat): ProcessingChat | Promise<ProcessingChat>
  }
  toolCalls?: Record<string, {
    handle(request: PluginToolCallRequest): unknown | Promise<unknown>
  }>
  exports?: Record<string, unknown>
}
```

如果某个插件的 `initGlobal` 初始化失败，后续初始化会 fail-fast，本轮插件处理失败。

## 插件注册表

`plugins` 是当前 Worker 内的插件全局注册表：

```ts
interface PluginGlobalRegistry {
  get(pluginId: string): PluginGlobalExport | undefined
  all(): Record<string, PluginGlobalExport>
}
```

注册表里是其他插件 `initGlobal` 的返回对象。由于运行时按依赖顺序初始化，插件应该只依赖已经通过 `dependencies` 声明的插件导出。

```ts
export default function initGlobal(context, plugins) {
  const compat = plugins.get('silly_tavern_compat')?.exports

  return {
    exports: {
      hasCompat: Boolean(compat)
    }
  }
}
```

跨插件访问本轮不是权限边界：`plugins.get()`、`haExtApi.storage.*For()` 和显式构造 `huaianext://<pluginId>/...` 当前都不会额外按调用方插件限制目标插件。

## haExtApi

Worker 中的 `context.haExtApi` 和可见插件页面中的 `window.haExtApi` 结构保持一致，但部分能力只在对应页面上下文存在。

公共能力：

```ts
interface HaExtApi {
  assetUrl(path: string): string
  storage: PluginStorageApi
  chat?: HaExtChatApi
  toolSettings?: HaExtToolSettingsApi
}
```

`assetUrl(path)` 返回当前插件资源 URL，例如 `huaianext://my_plugin/icon.png`。可见 iframe 本身也直接以 `huaianext://<pluginId>/<path>` 加载插件页面资源。

`storage` 方法：

```ts
interface PluginStorageApi {
  list(path?: string): Promise<PluginFileEntry[]>
  listFor(pluginId: string, path?: string): Promise<PluginFileEntry[]>
  readText(path: string): Promise<string>
  readTextFor(pluginId: string, path: string): Promise<string>
  readBase64(path: string): Promise<string>
  readBase64For(pluginId: string, path: string): Promise<string>
  writeText(path: string, content: string): Promise<void>
  writeTextFor(pluginId: string, path: string, content: string): Promise<void>
  writeBase64(path: string, content: string): Promise<void>
  writeBase64For(pluginId: string, path: string, content: string): Promise<void>
  delete(path: string): Promise<void>
  deleteFor(pluginId: string, path: string): Promise<void>
  readJson(path: string, fallback?: unknown): Promise<unknown>
  readJsonFor(pluginId: string, path: string, fallback?: unknown): Promise<unknown>
  writeJson(path: string, value: unknown): Promise<void>
  writeJsonFor(pluginId: string, path: string, value: unknown): Promise<void>
}
```

`readJson`/`readJsonFor` 在读取或解析失败时返回 `fallback`，未传 fallback 时返回 `{}`。所有 storage 路径都会被限制在目标插件的 `pluginData/<pluginId>` 目录内。

Worker 上下文只暴露 `assetUrl` 和 `storage`。`chat` 只在聊天页插件 iframe 存在，`toolSettings` 只在工具设置 iframe 存在。

## 可见插件页面

可见插件页面不会自动注入脚本。页面代码需要从 `@st-forge/plugin-api/client` 安装客户端：

```ts
import { installHaExtApi } from '@st-forge/plugin-api/client'

const api = installHaExtApi()
```

聊天页插件：

```ts
import { installHaExtApi } from '@st-forge/plugin-api/client'

const api = installHaExtApi({ chat: true })
const pluginData = await api.chat!.getPluginData()
await api.chat!.setPluginData({ ...pluginData, enabled: true })
```

工具设置页：

```ts
import { installHaExtApi } from '@st-forge/plugin-api/client'

const api = installHaExtApi({ toolSettings: true })
const commonArgs = await api.toolSettings!.getCommonArgs()
await api.toolSettings!.setCommonArgs({ ...commonArgs, mode: 'strict' })
```

客户端对象是同步创建的；具体 API 调用会等待宿主通过 `MessagePort` 连接页面。页面没有 Node、preload、Electron API，也没有 `window.parentPluginApi`。

`chat` API：

```ts
interface HaExtChatApi {
  getSession(): Promise<ChatSession | null>
  getPluginData(): Promise<Record<string, unknown>>
  setPluginData(value: Record<string, unknown>): Promise<Record<string, unknown>>
}
```

`toolSettings` API：

```ts
interface HaExtToolSettingsApi {
  getCommonArgs(): Promise<Record<string, unknown>>
  setCommonArgs(value: Record<string, unknown>): Promise<Record<string, unknown>>
}
```

如果页面没有对应能力却调用这些方法，宿主会返回错误。

## 聊天处理器

聊天处理器现在由 `initGlobal` 返回，不再是独立入口文件：

```ts
import type { PluginGlobalExport, PluginRuntimeContext } from '@st-forge/plugin-api'

export default function initGlobal(context: PluginRuntimeContext): PluginGlobalExport {
  return {
    chatBlockProcessor: {
      async process(chat) {
        const pluginData = chat.chatSession.pluginData[context.plugin.id]

        return {
          ...chat,
          pluginData: {
            ...chat.pluginData,
            [context.plugin.id]: pluginData
          }
        }
      }
    }
  }
}
```

`process(chat)` 的入参和返回值都是 `ProcessingChat`。处理器可以修改 `chat.pluginData` 和每个 `MixedChatBlock.pluginData`，这些 patch 会由宿主写回；不要修改 `MixedChatBlock.original`，宿主会保留原始块的 canonical 数据。

`chatBlockProcessor` 只会在聊天页准备显示块、生成上下文、插件数据变化等需要重新处理聊天块的时机运行。

## 工具调用

manifest 只声明工具组和 schema，不再声明 `handler` 文件。工具实现由 `initGlobal` 返回的 `toolCalls` 对象提供。`toolCalls` 的 key 必须与 manifest 中的 `entry.toolCalls[].name` 一致。

```ts
import type { PluginGlobalExport, PluginRuntimeContext } from '@st-forge/plugin-api'

export default function initGlobal(context: PluginRuntimeContext): PluginGlobalExport {
  return {
    toolCalls: {
      my_tool_group: {
        async handle(request) {
          const settings = request.commonArgs
          const input = request.input

          return {
            ok: true,
            pluginId: context.plugin.id,
            settings,
            input
          }
        }
      }
    }
  }
}
```

工具请求结构：

```ts
interface PluginToolCallRequest {
  chatId: number
  toolCallName: string
  toolName: string
  input: Record<string, unknown>
  commonArgs: Record<string, unknown>
}
```

`toolCallName` 是插件工具组名，`toolName` 是该工具组内模型实际调用的工具名。工具设置页保存的公共参数会作为 `commonArgs` 传入 `handle`。

## 构建建议

入口脚本运行时从插件文件文本创建 blob module。插件如果使用 TypeScript、多文件源码、第三方依赖或相对 import，需要先打包成自包含产物。仓库内插件可使用 `packages/plugins/vite.shared.ts`：

```ts
import { definePluginBuild } from '../vite.shared'

export default definePluginBuild({
  packageDir: __dirname,
  scriptEntries: {
    initGlobal: 'src/initGlobal.ts'
  },
  pages: {
    settingsHtml: { input: 'src/settings.html', name: 'settings' },
    chatHtml: { input: 'src/chat.html', name: 'chat' }
  }
})
```

页面构建时也应把 `@st-forge/plugin-api/client` 打进页面脚本里；不要依赖宿主自动注入。

## 安全边界

可见插件 iframe 使用 `huaianext://<pluginId>/...` 直接加载插件资源，主进程会把文件访问限制在对应插件目录内，并为页面响应设置插件 CSP。iframe 不具备 Node、preload 或 Electron IPC 能力，只能通过页面安装的 `haExtApi` 与 Worker 通信。

Worker 里的插件代码也不能直接访问 Node 或 Electron。它通过宿主转发访问插件文件、插件数据目录，以及可见页面对应的 `chat`/`toolSettings` 能力。

当前仍允许显式跨插件访问：`storage.*For()`、`plugins.get()` 和构造其他插件的 `huaianext://` URL 不会被调用方插件 ID 拦截。后续如果要收紧权限，需要在这些入口统一加访问控制。
