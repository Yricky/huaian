# Huaian API Lab

`demo_app` 是一个用于测试 `@huaian/app-api` 公开接口的 Vue + Vite 示例应用。它被设计成宿主 iframe 内的测试控制台，而不是业务应用。

## 覆盖范围

- `context()`
- `appData` 和 `save` 的 `list`、`mkdir`、`readText`、`readBytes`、`writeText`、`writeBytes`、`delete`、`readJson`、`writeJson`
- `chat.getLLMInstances`
- `chat.createSession`、`listSessions`、`getSession`、`updateSession`、`deleteSession`
- `chat.appendMessage`、`updateMessage`、`deleteMessage`
- `chat.registerTool`、`triggerLlmReply`、`stopLlmReply`
- `ha.on(...)` 支持的全部事件

## 开发

在仓库根目录运行：

```bash
pnpm --filter huaian-api-lab dev
```

开发服务器仅用于调试页面本身。`@huaian/app-api` 需要宿主发送 `MessagePort` 才能真正返回数据，所以完整测试请安装构建产物后在 Huaian 中打开。

## 构建和打包

在仓库根目录运行：

```bash
pnpm --filter huaian-api-lab build
```

构建结果：

- `demo_app/dist/`
- `demo_app/huaian-api-lab.zip`

这两个路径已在 `demo_app/.gitignore` 中忽略。zip 根目录会包含 `app.json` 和 `index.html`，可以直接通过 Huaian 的安装应用流程导入。

## 使用说明

1. 安装 `huaian-api-lab.zip`。
2. 打开应用并创建一个 appSession。
3. 控制台会自动尝试读取上下文、LLM 实例和 chatSession 列表。
4. 存储面板不会自动清理文件；删除 API 只有点击 `delete` 按钮时才会执行。
5. 工具调用测试使用 `random_number` 工具，入参为 `max`。收到工具调用请求时，测试应用会先弹出模态框请求用户同意；同意后返回 `{ max, value, time }`，其中 `value` 是 `0..max` 的随机整数，`time` 是当前 ISO 时间字符串。
6. `userMessage`、`userStoppedReply`、`llmInstanceChanged` 等事件需要从宿主聊天 UI 发送消息、停止回复或切换 LLM 实例才能触发。
7. `toolCall` 事件需要真实 LLM 决定调用 `random_number` 工具。可以使用“请求 LLM 调工具”按钮追加提示词并触发回复。
