<template>
  <div class="app-shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">Huaian API Lab</p>
        <h1>@huaian/app-api 测试控制台</h1>
      </div>
      <div class="connection-pill" :class="connectionState">
        {{ connectionLabel }}
      </div>
    </header>

    <main class="console-grid">
      <section class="panel overview-panel">
        <div class="panel-heading">
          <div>
            <h2>运行上下文</h2>
            <p>测试 `context()`，并显示当前 iframe 所属 appSession。</p>
          </div>
          <button type="button" @click="loadContext">
            读取上下文
          </button>
        </div>

        <div class="metrics">
          <div>
            <span>appId</span>
            <strong>{{ context?.appId ?? '等待连接' }}</strong>
          </div>
          <div>
            <span>version</span>
            <strong>{{ context?.appVersion ?? '-' }}</strong>
          </div>
          <div>
            <span>appSessionId</span>
            <strong>{{ context?.appSessionId ?? '-' }}</strong>
          </div>
          <div>
            <span>title</span>
            <strong>{{ context?.appSessionTitle ?? '-' }}</strong>
          </div>
        </div>
      </section>

      <section class="panel checklist-panel">
        <div class="panel-heading">
          <div>
            <h2>API 覆盖清单</h2>
            <p>按钮或真实宿主事件触发后，对应项会更新为通过或失败。</p>
          </div>
          <button type="button" class="secondary" @click="resetChecks">
            重置状态
          </button>
        </div>

        <div class="check-groups">
          <div v-for="group in apiGroups" :key="group.title" class="check-group">
            <h3>{{ group.title }}</h3>
            <ul>
              <li v-for="id in group.ids" :key="id" :class="apiChecks[id]?.status ?? 'idle'">
                <span class="status-dot" />
                <span>{{ apiChecks[id]?.label ?? id }}</span>
                <small>{{ apiChecks[id]?.note }}</small>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section class="panel storage-panel">
        <div class="panel-heading">
          <div>
            <h2>存储 API</h2>
            <p>`appData` 和 `save` 各自独立测试。不会自动清理，删除只由按钮触发。</p>
          </div>
        </div>

        <div class="storage-grid">
          <article v-for="form in storageForms" :key="form.kind" class="storage-namespace">
            <header>
              <h3>{{ form.title }}</h3>
              <p>{{ form.description }}</p>
            </header>

            <div class="field-row">
              <label>
                <span>列表路径</span>
                <input v-model="form.listPath" spellcheck="false" placeholder="state" />
              </label>
              <button type="button" @click="listStorage(form)">
                list
              </button>
            </div>

            <div class="file-list">
              <div v-if="!form.entries.length" class="empty-state">
                暂无列表结果
              </div>
              <div v-for="entry in form.entries" :key="entry.path" class="file-entry">
                <strong>{{ entry.isDirectory ? 'dir' : 'file' }}</strong>
                <span>{{ entry.path }}</span>
                <small>{{ entry.size ?? '-' }}</small>
              </div>
            </div>

            <div class="field-row">
              <label>
                <span>目录路径</span>
                <input v-model="form.dirPath" spellcheck="false" placeholder="state/cache" />
              </label>
              <button type="button" @click="mkdirStorage(form)">
                mkdir
              </button>
            </div>

            <label class="stacked-field">
              <span>文本路径</span>
              <input v-model="form.textPath" spellcheck="false" placeholder="state/note.txt" />
            </label>
            <label class="stacked-field">
              <span>文本内容</span>
              <textarea v-model="form.textContent" rows="4" spellcheck="false" />
            </label>
            <div class="button-row">
              <button type="button" @click="writeTextStorage(form)">
                writeText
              </button>
              <button type="button" class="secondary" @click="readTextStorage(form)">
                readText
              </button>
            </div>

            <label class="stacked-field">
              <span>JSON 路径</span>
              <input v-model="form.jsonPath" spellcheck="false" placeholder="state/payload.json" />
            </label>
            <label class="stacked-field">
              <span>JSON 内容</span>
              <textarea v-model="form.jsonContent" rows="5" spellcheck="false" />
            </label>
            <div class="button-row">
              <button type="button" @click="writeJsonStorage(form)">
                writeJson
              </button>
              <button type="button" class="secondary" @click="readJsonStorage(form)">
                readJson
              </button>
            </div>

            <label class="stacked-field">
              <span>Bytes 路径</span>
              <input v-model="form.bytesPath" spellcheck="false" placeholder="state/blob.bin" />
            </label>
            <label class="stacked-field">
              <span>Bytes 文本载荷</span>
              <textarea v-model="form.bytesText" rows="3" spellcheck="false" />
            </label>
            <div class="button-row">
              <button type="button" @click="writeBytesStorage(form)">
                writeBytes
              </button>
              <button type="button" class="secondary" @click="readBytesStorage(form)">
                readBytes
              </button>
            </div>

            <div class="field-row delete-row">
              <label>
                <span>删除路径</span>
                <input v-model="form.deletePath" spellcheck="false" placeholder="state/cache" />
              </label>
              <label class="checkbox-label">
                <input v-model="form.deleteRecursive" type="checkbox" />
                递归
              </label>
              <button type="button" class="danger" @click="deleteStorage(form)">
                delete
              </button>
            </div>
          </article>
        </div>
      </section>

      <section class="panel chat-panel">
        <div class="panel-heading">
          <div>
            <h2>Chat、LLM 与工具调用</h2>
            <p>创建 chatSession、选择 LLM 实例、注册随机数工具，并触发真实 LLM 回复。</p>
          </div>
          <button type="button" class="secondary" @click="refreshChatState">
            刷新
          </button>
        </div>

        <div class="chat-layout">
          <div class="chat-controls">
            <div class="subsection-title">
              <h3>LLM 实例</h3>
              <button type="button" class="secondary compact" @click="loadLlmInstances">
                getLLMInstances
              </button>
            </div>
            <label class="stacked-field">
              <span>选择实例</span>
              <select v-model="llmSelectValue">
                <option value="default">宿主默认实例</option>
                <option v-for="instance in llmInstances" :key="instance.id" :value="String(instance.id)">
                  {{ instance.name }} (#{{ instance.id }})
                </option>
              </select>
            </label>

            <div class="subsection-title">
              <h3>会话</h3>
              <button type="button" class="secondary compact" @click="loadSessions">
                listSessions
              </button>
            </div>
            <label class="stacked-field">
              <span>当前会话</span>
              <select v-model.number="selectedSessionId">
                <option :value="null">未选择</option>
                <option v-for="session in sessions" :key="session.id" :value="session.id">
                  #{{ session.id }} {{ session.title }} · {{ session.status }}
                </option>
              </select>
            </label>
            <label class="stacked-field">
              <span>标题</span>
              <input v-model="sessionTitle" spellcheck="false" />
            </label>
            <label class="checkbox-label">
              <input v-model="allowUserReply" type="checkbox" />
              允许用户在宿主聊天框回复
            </label>
            <label class="stacked-field">
              <span>宿主选项，每行一个</span>
              <textarea v-model="optionsText" rows="3" spellcheck="false" />
            </label>
            <label class="stacked-field">
              <span>初始 system prompt</span>
              <textarea v-model="systemPrompt" rows="5" spellcheck="false" />
            </label>
            <div class="button-row wrap">
              <button type="button" @click="createSession">
                createSession
              </button>
              <button type="button" class="secondary" :disabled="!selectedSession" @click="getSelectedSession">
                getSession
              </button>
              <button type="button" class="secondary" :disabled="!selectedSession" @click="updateSelectedSession">
                updateSession
              </button>
              <button type="button" class="danger" :disabled="!selectedSession" @click="deleteSelectedSession">
                deleteSession
              </button>
            </div>

            <div class="subsection-title">
              <h3>用户事件处理</h3>
            </div>
            <label class="checkbox-label">
              <input v-model="autoAppendUserMessage" type="checkbox" />
              收到 userMessage 时自动 appendMessage
            </label>
            <label class="checkbox-label">
              <input v-model="autoTriggerAfterUser" type="checkbox" />
              收到 userMessage 后自动 triggerLlmReply
            </label>
          </div>

          <div class="chat-controls">
            <div class="subsection-title">
              <h3>消息</h3>
            </div>
            <label class="stacked-field">
              <span>新增消息角色</span>
              <select v-model="messageRole">
                <option value="system">system</option>
                <option value="user">user</option>
                <option value="assistant">assistant</option>
              </select>
            </label>
            <label class="stacked-field">
              <span>新增消息内容</span>
              <textarea v-model="messageContent" rows="5" spellcheck="false" />
            </label>
            <div class="button-row wrap">
              <button type="button" :disabled="!selectedSession" @click="appendMessage">
                appendMessage
              </button>
              <button type="button" class="secondary" :disabled="!selectedSession" @click="appendRichMessage">
                append contentParts
              </button>
            </div>

            <label class="stacked-field">
              <span>编辑消息</span>
              <select v-model.number="selectedMessageId" :disabled="!selectedSession?.messages.length">
                <option :value="null">未选择</option>
                <option v-for="message in selectedSession?.messages ?? []" :key="message.id" :value="message.id">
                  #{{ message.id }} {{ message.role }} · {{ message.status }}
                </option>
              </select>
            </label>
            <div class="content-parts-editor">
              <div class="subsection-title">
                <h3>编辑 contentParts</h3>
                <div class="mini-actions">
                  <button type="button" class="secondary compact" :disabled="!selectedMessage" @click="addEditablePart('text')">
                    添加 text
                  </button>
                  <button type="button" class="secondary compact" :disabled="!selectedMessage" @click="addEditablePart('reasoning')">
                    添加 reasoning
                  </button>
                </div>
              </div>
              <div v-if="!editableContentParts.length" class="empty-state">
                选中消息后会在这里按 part 展示
              </div>
              <article v-for="(part, index) in editableContentParts" :key="part.id" class="content-part-card">
                <header>
                  <strong>#{{ index }} {{ part.type }}</strong>
                  <button type="button" class="danger compact" @click="removeEditablePart(index)">
                    删除
                  </button>
                </header>

                <label v-if="part.type === 'text'" class="stacked-field">
                  <span>text</span>
                  <textarea v-model="part.text" rows="4" spellcheck="false" />
                </label>

                <template v-else-if="part.type === 'reasoning'">
                  <label class="stacked-field">
                    <span>reasoning.text</span>
                    <textarea v-model="part.text" rows="4" spellcheck="false" />
                  </label>
                  <label class="checkbox-label">
                    <input v-model="part.sendAsContext" type="checkbox" />
                    sendAsContext
                  </label>
                </template>

                <label v-else class="stacked-field">
                  <span>tool_call JSON</span>
                  <textarea v-model="part.json" rows="8" spellcheck="false" />
                </label>
              </article>
            </div>
            <div class="button-row wrap">
              <button type="button" class="secondary" :disabled="!selectedMessage" @click="updateSelectedMessage">
                updateMessage
              </button>
              <button type="button" class="danger" :disabled="!selectedMessage" @click="deleteSelectedMessage">
                deleteMessage
              </button>
            </div>

            <div class="subsection-title">
              <h3>LLM 与工具</h3>
            </div>
            <label class="stacked-field">
              <span>random_number 最大值</span>
              <input v-model.number="randomMax" type="number" min="0" step="1" />
            </label>
            <div class="button-row wrap">
              <button type="button" :disabled="!selectedSession" @click="registerRandomToolForSelected">
                registerTool
              </button>
              <button type="button" :disabled="!selectedSession" @click="triggerReply">
                triggerLlmReply
              </button>
              <button type="button" class="secondary" :disabled="!selectedSession" @click="askToolAndTrigger">
                请求 LLM 调工具
              </button>
              <button type="button" class="danger" :disabled="!selectedSession" @click="stopReply">
                stopLlmReply
              </button>
            </div>
          </div>

          <div class="session-view">
            <div class="subsection-title">
              <h3>当前 chatSession</h3>
              <small v-if="selectedSession">
                #{{ selectedSession.id }} · {{ selectedSession.status }}
              </small>
            </div>
            <div v-if="!selectedSession" class="empty-state large">
              请选择或创建一个 chatSession
            </div>
            <div v-else class="session-summary">
              <dl>
                <div>
                  <dt>title</dt>
                  <dd>{{ selectedSession.title }}</dd>
                </div>
                <div>
                  <dt>llmInstanceId</dt>
                  <dd>{{ selectedSession.llmInstanceId ?? 'default' }}</dd>
                </div>
                <div>
                  <dt>allowUserReply</dt>
                  <dd>{{ selectedSession.allowUserReply }}</dd>
                </div>
                <div>
                  <dt>options</dt>
                  <dd>{{ selectedSession.options.join(' / ') || '-' }}</dd>
                </div>
                <div>
                  <dt>tools</dt>
                  <dd>{{ selectedSession.tools.map(tool => tool.name).join(' / ') || '-' }}</dd>
                </div>
              </dl>

              <div class="messages">
                <article v-for="message in selectedSession.messages" :key="message.id" class="message-row">
                  <header>
                    <strong>#{{ message.id }} {{ message.role }}</strong>
                    <span :class="['message-status', message.status]">{{ message.status }}</span>
                  </header>
                  <pre>{{ formatMessage(message) }}</pre>
                  <small v-if="message.errorText">{{ message.errorText }}</small>
                </article>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="panel events-panel">
        <div class="panel-heading">
          <div>
            <h2>宿主事件日志</h2>
            <p>所有 `ha.on(...)` 支持的事件都会写入这里，delta 会保留最近记录。</p>
          </div>
          <button type="button" class="secondary" @click="eventLog = []">
            清空事件
          </button>
        </div>

        <div class="event-list">
          <article v-for="entry in eventLog" :key="entry.id" class="event-entry">
            <header>
              <strong>{{ entry.type }}</strong>
              <time>{{ entry.time }}</time>
            </header>
            <pre>{{ formatValue(entry.payload, 1600) }}</pre>
          </article>
          <div v-if="!eventLog.length" class="empty-state large">
            暂无事件。可以从宿主聊天框发送消息、停止回复或切换 LLM 实例。
          </div>
        </div>
      </section>

      <section class="panel logs-panel">
        <div class="panel-heading">
          <div>
            <h2>操作日志</h2>
            <p>记录每次 API 调用的入参、返回值和错误。</p>
          </div>
          <button type="button" class="secondary" @click="operationLog = []">
            清空日志
          </button>
        </div>

        <div class="operation-list">
          <article v-for="entry in operationLog" :key="entry.id" :class="['operation-entry', entry.kind]">
            <header>
              <strong>{{ entry.label }}</strong>
              <time>{{ entry.time }}</time>
            </header>
            <pre v-if="entry.details !== undefined">{{ formatValue(entry.details, 1800) }}</pre>
          </article>
          <div v-if="!operationLog.length" class="empty-state large">
            暂无操作记录
          </div>
        </div>
      </section>
    </main>

    <div v-if="activeToolConsent" class="modal-backdrop">
      <section class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="tool-consent-title">
        <header>
          <div>
            <p class="eyebrow">Tool Call</p>
            <h2 id="tool-consent-title">允许调用 {{ activeToolConsent.toolName }}？</h2>
          </div>
        </header>
        <p class="modal-copy">
          LLM 正在请求测试应用执行工具。拒绝后，本次工具调用会以错误结果返回给宿主。
        </p>
        <div class="tool-consent-payload">
          <span>输入参数</span>
          <pre>{{ formatValue(activeToolConsent.input, 1800) }}</pre>
        </div>
        <footer>
          <button type="button" class="secondary" @click="resolveToolConsent(false)">
            拒绝
          </button>
          <button type="button" @click="resolveToolConsent(true)">
            同意调用
          </button>
        </footer>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  ensureHuaianAppApi,
  type AppChatContentPart,
  type AppChatMessage,
  type AppChatRole,
  type AppChatSessionState,
  type AppEvent,
  type AppFileEntry,
  type AppFrameContext,
  type AppLlmInstanceSummary,
  type AppStorageApi,
  type JsonRecord
} from '@huaian/app-api'

type ConnectionState = 'connecting' | 'ready' | 'error'
type CheckStatus = 'idle' | 'running' | 'pass' | 'fail'
type LogKind = 'info' | 'success' | 'error' | 'warning'
type StorageKind = 'appData' | 'save'

interface ApiCheck {
  label: string
  note: string
  status: CheckStatus
}

interface LogEntry {
  id: number
  kind: LogKind
  label: string
  time: string
  details?: unknown
}

interface EventEntry {
  id: number
  type: AppEvent['type']
  time: string
  payload: AppEvent
}

interface StorageForm {
  kind: StorageKind
  title: string
  description: string
  listPath: string
  dirPath: string
  textPath: string
  textContent: string
  jsonPath: string
  jsonContent: string
  bytesPath: string
  bytesText: string
  deletePath: string
  deleteRecursive: boolean
  entries: AppFileEntry[]
}

interface ToolConsentRequest {
  id: number
  toolName: string
  input: JsonRecord
  resolve: (approved: boolean) => void
}

interface EditableContentPart {
  id: number
  type: AppChatContentPart['type']
  text: string
  sendAsContext: boolean
  json: string
}

const ha = ensureHuaianAppApi()

const connectionState = ref<ConnectionState>('connecting')
const context = ref<AppFrameContext | null>(null)
const operationLog = ref<LogEntry[]>([])
const eventLog = ref<EventEntry[]>([])
const llmInstances = ref<AppLlmInstanceSummary[]>([])
const sessions = ref<AppChatSessionState[]>([])
const selectedSessionId = ref<number | null>(null)
const selectedMessageId = ref<number | null>(null)

const sessionTitle = ref('API 测试会话')
const allowUserReply = ref(true)
const optionsText = ref('继续测试\n请求随机数')
const systemPrompt = ref([
  '你是 Huaian API Lab 的测试助手。',
  '当用户要求随机数时，请调用 random_number 工具。',
  '工具返回后，用中文简要报告随机数和时间。'
].join('\n'))
const llmSelectValue = ref('default')
const messageRole = ref<AppChatRole>('user')
const messageContent = ref('请用一句话确认当前 chatSession 正常。')
const editableContentParts = ref<EditableContentPart[]>([])
const randomMax = ref(10)
const autoAppendUserMessage = ref(true)
const autoTriggerAfterUser = ref(false)
const activeToolConsent = ref<ToolConsentRequest | null>(null)

let logId = 0
let eventId = 0
let editablePartId = 0
let toolConsentId = 0
const unsubscribers: Array<() => void> = []
const toolConsentQueue: ToolConsentRequest[] = []

const eventTypes: AppEvent['type'][] = [
  'userMessage',
  'userStoppedReply',
  'llmInstanceChanged',
  'llmReplyStarted',
  'llmReplyDelta',
  'llmReplyFinished',
  'llmReplyStopped',
  'llmReplyError',
  'toolCall'
]

const apiChecks = reactive<Record<string, ApiCheck>>({
  context: check('context()'),
  'appData.list': check('appData.list'),
  'appData.mkdir': check('appData.mkdir'),
  'appData.readText': check('appData.readText'),
  'appData.readBytes': check('appData.readBytes'),
  'appData.writeText': check('appData.writeText'),
  'appData.writeBytes': check('appData.writeBytes'),
  'appData.delete': check('appData.delete'),
  'appData.readJson': check('appData.readJson'),
  'appData.writeJson': check('appData.writeJson'),
  'save.list': check('save.list'),
  'save.mkdir': check('save.mkdir'),
  'save.readText': check('save.readText'),
  'save.readBytes': check('save.readBytes'),
  'save.writeText': check('save.writeText'),
  'save.writeBytes': check('save.writeBytes'),
  'save.delete': check('save.delete'),
  'save.readJson': check('save.readJson'),
  'save.writeJson': check('save.writeJson'),
  'chat.getLLMInstances': check('chat.getLLMInstances'),
  'chat.createSession': check('chat.createSession'),
  'chat.listSessions': check('chat.listSessions'),
  'chat.getSession': check('chat.getSession'),
  'chat.updateSession': check('chat.updateSession'),
  'chat.deleteSession': check('chat.deleteSession'),
  'chat.appendMessage': check('chat.appendMessage'),
  'chat.updateMessage': check('chat.updateMessage'),
  'chat.deleteMessage': check('chat.deleteMessage'),
  'chat.registerTool': check('chat.registerTool'),
  'chat.triggerLlmReply': check('chat.triggerLlmReply'),
  'chat.stopLlmReply': check('chat.stopLlmReply'),
  'event.userMessage': check('event:userMessage', '等待宿主聊天输入'),
  'event.userStoppedReply': check('event:userStoppedReply', '等待宿主停止回复'),
  'event.llmInstanceChanged': check('event:llmInstanceChanged', '等待宿主切换 LLM'),
  'event.llmReplyStarted': check('event:llmReplyStarted'),
  'event.llmReplyDelta': check('event:llmReplyDelta'),
  'event.llmReplyFinished': check('event:llmReplyFinished'),
  'event.llmReplyStopped': check('event:llmReplyStopped'),
  'event.llmReplyError': check('event:llmReplyError'),
  'event.toolCall': check('event:toolCall', '等待 LLM 实际调用工具')
})

const apiGroups = [
  { title: '上下文', ids: ['context'] },
  {
    title: 'appData',
    ids: [
      'appData.list',
      'appData.mkdir',
      'appData.readText',
      'appData.readBytes',
      'appData.writeText',
      'appData.writeBytes',
      'appData.delete',
      'appData.readJson',
      'appData.writeJson'
    ]
  },
  {
    title: 'save',
    ids: [
      'save.list',
      'save.mkdir',
      'save.readText',
      'save.readBytes',
      'save.writeText',
      'save.writeBytes',
      'save.delete',
      'save.readJson',
      'save.writeJson'
    ]
  },
  {
    title: 'chat',
    ids: [
      'chat.getLLMInstances',
      'chat.createSession',
      'chat.listSessions',
      'chat.getSession',
      'chat.updateSession',
      'chat.deleteSession',
      'chat.appendMessage',
      'chat.updateMessage',
      'chat.deleteMessage',
      'chat.registerTool',
      'chat.triggerLlmReply',
      'chat.stopLlmReply'
    ]
  },
  {
    title: 'events',
    ids: eventTypes.map(type => `event.${type}`)
  }
]

const storageForms = reactive<StorageForm[]>([
  createStorageForm('appData', 'appData', '同一个 app 的全局数据。'),
  createStorageForm('save', 'save', '当前 appSession 的存档数据。')
])

const connectionLabel = computed(() => {
  if (connectionState.value === 'ready') return '已连接宿主'
  if (connectionState.value === 'error') return '连接失败'
  return '等待宿主连接'
})

const selectedSession = computed(() => {
  if (selectedSessionId.value === null) return null
  return sessions.value.find(session => session.id === selectedSessionId.value) ?? null
})

const selectedMessage = computed(() => {
  const session = selectedSession.value
  if (!session || selectedMessageId.value === null) return null
  return session.messages.find(message => message.id === selectedMessageId.value) ?? null
})

watch(selectedSession, session => {
  if (!session) return
  sessionTitle.value = session.title
  allowUserReply.value = session.allowUserReply
  optionsText.value = session.options.join('\n')
  llmSelectValue.value = session.llmInstanceId === null ? 'default' : String(session.llmInstanceId)
  if (!session.messages.some(message => message.id === selectedMessageId.value)) {
    selectedMessageId.value = session.messages[0]?.id ?? null
  }
}, { immediate: true })

watch(selectedMessage, message => {
  editableContentParts.value = message ? message.contentParts.map(toEditableContentPart) : []
}, { immediate: true })

onMounted(() => {
  registerEventListeners()
  void initialize()
})

onBeforeUnmount(() => {
  for (const unsubscribe of unsubscribers.splice(0)) unsubscribe()
  activeToolConsent.value?.resolve(false)
  activeToolConsent.value = null
  while (toolConsentQueue.length) toolConsentQueue.shift()?.resolve(false)
})

function check(label: string, note = ''): ApiCheck {
  return { label, note, status: 'idle' }
}

function createStorageForm(kind: StorageKind, title: string, description: string): StorageForm {
  return {
    kind,
    title,
    description,
    listPath: 'api-lab',
    dirPath: 'api-lab',
    textPath: 'api-lab/note.txt',
    textContent: `${kind} text ${new Date().toISOString()}`,
    jsonPath: 'api-lab/payload.json',
    jsonContent: JSON.stringify({
      namespace: kind,
      savedBy: 'Huaian API Lab',
      at: new Date().toISOString()
    }, null, 2),
    bytesPath: 'api-lab/blob.bin',
    bytesText: `${kind} bytes payload`,
    deletePath: 'api-lab/remove-me',
    deleteRecursive: true,
    entries: []
  }
}

async function initialize(): Promise<void> {
  const noticeTimer = window.setTimeout(() => {
    if (connectionState.value === 'connecting') {
      pushLog('warning', '仍在等待宿主连接', '请确认应用运行在 Huaian iframe 中。')
    }
  }, 1600)

  try {
    await loadContext()
    await refreshChatState()
  } finally {
    window.clearTimeout(noticeTimer)
  }
}

async function runApi<T>(checkId: string, label: string, task: () => Promise<T>): Promise<T | undefined> {
  markCheck(checkId, 'running', '调用中')
  pushLog('info', label)
  try {
    const value = await task()
    markCheck(checkId, 'pass', '通过')
    pushLog('success', `${label} 成功`, value)
    return value
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    markCheck(checkId, 'fail', message)
    pushLog('error', `${label} 失败`, message)
    return undefined
  }
}

function markCheck(id: string, status: CheckStatus, note = ''): void {
  if (!apiChecks[id]) apiChecks[id] = check(id)
  apiChecks[id].status = status
  apiChecks[id].note = note
}

function resetChecks(): void {
  for (const item of Object.values(apiChecks)) {
    item.status = 'idle'
    if (item.note === '通过' || item.note === '调用中' || item.note.startsWith('失败') || item.note.startsWith('调用')) {
      item.note = ''
    }
  }
}

function pushLog(kind: LogKind, label: string, details?: unknown): void {
  operationLog.value = [{
    id: ++logId,
    kind,
    label,
    time: new Date().toLocaleTimeString(),
    details
  }, ...operationLog.value].slice(0, 160)
}

function pushEvent(event: AppEvent): void {
  eventLog.value = [{
    id: ++eventId,
    type: event.type,
    time: new Date().toLocaleTimeString(),
    payload: event
  }, ...eventLog.value].slice(0, 220)
}

function formatValue(value: unknown, maxLength = 1000): string {
  let text: string
  if (typeof value === 'string') {
    text = value
  } else if (value instanceof ArrayBuffer) {
    text = `ArrayBuffer(${value.byteLength})`
  } else {
    try {
      text = JSON.stringify(value, null, 2)
    } catch {
      text = String(value)
    }
  }
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}\n... truncated ${text.length - maxLength} chars`
}

function formatMessage(message: AppChatMessage): string {
  return message.contentParts.map(part => {
    if (part.type === 'text') return part.text
    if (part.type === 'reasoning') return `[reasoning sendAsContext=${part.sendAsContext === true}]\n${part.text}`
    return [
      `[tool_call ${part.toolName} · ${part.status}]`,
      `input: ${formatValue(part.input, 500)}`,
      part.output === undefined ? '' : `output: ${formatValue(part.output, 500)}`,
      part.error ? `error: ${part.error}` : ''
    ].filter(Boolean).join('\n')
  }).join('\n\n')
}

function toEditableContentPart(part: AppChatContentPart): EditableContentPart {
  if (part.type === 'text') {
    return {
      id: ++editablePartId,
      type: 'text',
      text: part.text,
      sendAsContext: false,
      json: ''
    }
  }
  if (part.type === 'reasoning') {
    return {
      id: ++editablePartId,
      type: 'reasoning',
      text: part.text,
      sendAsContext: part.sendAsContext === true,
      json: ''
    }
  }
  return {
    id: ++editablePartId,
    type: 'tool_call',
    text: '',
    sendAsContext: false,
    json: JSON.stringify(part, null, 2)
  }
}

function addEditablePart(type: 'text' | 'reasoning'): void {
  editableContentParts.value = [
    ...editableContentParts.value,
    {
      id: ++editablePartId,
      type,
      text: type === 'text' ? '新的 text part' : '新的 reasoning part',
      sendAsContext: type === 'reasoning',
      json: ''
    }
  ]
}

function removeEditablePart(index: number): void {
  editableContentParts.value = editableContentParts.value.filter((_, itemIndex) => itemIndex !== index)
}

function buildEditedContentParts(): AppChatContentPart[] | null {
  const parts: AppChatContentPart[] = []
  for (const part of editableContentParts.value) {
    if (part.type === 'text') {
      parts.push({ type: 'text', text: part.text })
    } else if (part.type === 'reasoning') {
      parts.push({
        type: 'reasoning',
        text: part.text,
        sendAsContext: part.sendAsContext
      })
    } else {
      try {
        const value = JSON.parse(part.json) as AppChatContentPart
        if (value.type !== 'tool_call') throw new Error('tool_call JSON 的 type 必须是 "tool_call"。')
        parts.push(value)
      } catch (error) {
        pushLog('error', 'contentParts JSON 解析失败', error instanceof Error ? error.message : String(error))
        markCheck('chat.updateMessage', 'fail', 'contentParts JSON 解析失败')
        return null
      }
    }
  }
  return parts
}

function parseOptions(): string[] {
  return optionsText.value
    .split(/\n|,/)
    .map(item => item.trim())
    .filter(Boolean)
}

function selectedLlmInstanceId(): number | null {
  if (llmSelectValue.value === 'default') return null
  const id = Number(llmSelectValue.value)
  return Number.isInteger(id) ? id : null
}

function storageApi(kind: StorageKind): AppStorageApi {
  return kind === 'appData' ? ha.appData : ha.save
}

function storageCheck(kind: StorageKind, method: string): string {
  return `${kind}.${method}`
}

async function loadContext(): Promise<void> {
  const nextContext = await runApi('context', 'context()', () => ha.context())
  if (!nextContext) {
    connectionState.value = 'error'
    return
  }
  context.value = nextContext
  connectionState.value = 'ready'
}

async function listStorage(form: StorageForm): Promise<void> {
  const entries = await runApi(storageCheck(form.kind, 'list'), `${form.kind}.list`, () => storageApi(form.kind).list(form.listPath))
  if (entries) form.entries = entries
}

async function mkdirStorage(form: StorageForm): Promise<void> {
  await runApi(storageCheck(form.kind, 'mkdir'), `${form.kind}.mkdir`, () => storageApi(form.kind).mkdir(form.dirPath))
  await listStorage(form)
}

async function writeTextStorage(form: StorageForm): Promise<void> {
  await runApi(storageCheck(form.kind, 'writeText'), `${form.kind}.writeText`, () => (
    storageApi(form.kind).writeText(form.textPath, form.textContent)
  ))
}

async function readTextStorage(form: StorageForm): Promise<void> {
  const text = await runApi(storageCheck(form.kind, 'readText'), `${form.kind}.readText`, () => (
    storageApi(form.kind).readText(form.textPath)
  ))
  if (text !== undefined) form.textContent = text
}

async function writeJsonStorage(form: StorageForm): Promise<void> {
  let value: unknown
  try {
    value = JSON.parse(form.jsonContent)
  } catch (error) {
    pushLog('error', `${form.kind}.writeJson JSON 解析失败`, error instanceof Error ? error.message : String(error))
    markCheck(storageCheck(form.kind, 'writeJson'), 'fail', 'JSON 解析失败')
    return
  }
  await runApi(storageCheck(form.kind, 'writeJson'), `${form.kind}.writeJson`, () => (
    storageApi(form.kind).writeJson(form.jsonPath, value)
  ))
}

async function readJsonStorage(form: StorageForm): Promise<void> {
  const fallback = {
    fallback: true,
    namespace: form.kind,
    at: new Date().toISOString()
  }
  const value = await runApi(storageCheck(form.kind, 'readJson'), `${form.kind}.readJson`, () => (
    storageApi(form.kind).readJson(form.jsonPath, fallback)
  ))
  if (value !== undefined) form.jsonContent = formatValue(value, 4000)
}

async function writeBytesStorage(form: StorageForm): Promise<void> {
  const bytes = new TextEncoder().encode(form.bytesText)
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  await runApi(storageCheck(form.kind, 'writeBytes'), `${form.kind}.writeBytes`, () => (
    storageApi(form.kind).writeBytes(form.bytesPath, buffer)
  ))
}

async function readBytesStorage(form: StorageForm): Promise<void> {
  const buffer = await runApi(storageCheck(form.kind, 'readBytes'), `${form.kind}.readBytes`, () => (
    storageApi(form.kind).readBytes(form.bytesPath)
  ))
  if (buffer !== undefined) form.bytesText = new TextDecoder().decode(new Uint8Array(buffer))
}

async function deleteStorage(form: StorageForm): Promise<void> {
  await runApi(storageCheck(form.kind, 'delete'), `${form.kind}.delete`, () => (
    storageApi(form.kind).delete(form.deletePath, { recursive: form.deleteRecursive })
  ))
  await listStorage(form)
}

async function refreshChatState(): Promise<void> {
  await loadLlmInstances()
  await loadSessions()
}

async function loadLlmInstances(): Promise<void> {
  const instances = await runApi('chat.getLLMInstances', 'chat.getLLMInstances', () => ha.chat.getLLMInstances())
  if (instances) llmInstances.value = instances
}

async function loadSessions(): Promise<void> {
  const nextSessions = await runApi('chat.listSessions', 'chat.listSessions', () => ha.chat.listSessions())
  if (!nextSessions) return
  sessions.value = nextSessions
  if (selectedSessionId.value === null && nextSessions[0]) selectedSessionId.value = nextSessions[0].id
  if (selectedSessionId.value !== null && !nextSessions.some(session => session.id === selectedSessionId.value)) {
    selectedSessionId.value = nextSessions[0]?.id ?? null
  }
}

function upsertSession(session: AppChatSessionState): void {
  const index = sessions.value.findIndex(item => item.id === session.id)
  if (index === -1) sessions.value = [...sessions.value, session]
  else sessions.value = sessions.value.map(item => item.id === session.id ? session : item)
}

async function createSession(): Promise<void> {
  const session = await runApi('chat.createSession', 'chat.createSession', () => ha.chat.createSession({
    title: sessionTitle.value.trim() || 'API 测试会话',
    allowUserReply: allowUserReply.value,
    options: parseOptions(),
    llmInstanceId: selectedLlmInstanceId()
  }))
  if (!session) return
  upsertSession(session)
  selectedSessionId.value = session.id

  if (systemPrompt.value.trim()) {
    await runApi('chat.appendMessage', 'chat.appendMessage(system)', () => ha.chat.appendMessage(session.id, {
      role: 'system',
      content: systemPrompt.value
    }))
  }
  await registerRandomTool(session.id)
  await loadSession(session.id)
}

async function getSelectedSession(): Promise<void> {
  if (!selectedSession.value) return
  await loadSession(selectedSession.value.id)
}

async function loadSession(chatSessionId: number): Promise<void> {
  const session = await runApi('chat.getSession', `chat.getSession(${chatSessionId})`, () => ha.chat.getSession(chatSessionId))
  if (session) upsertSession(session)
}

async function updateSelectedSession(): Promise<void> {
  const session = selectedSession.value
  if (!session) return
  const updated = await runApi('chat.updateSession', 'chat.updateSession', () => ha.chat.updateSession(session.id, {
    title: sessionTitle.value.trim() || session.title,
    allowUserReply: allowUserReply.value,
    options: parseOptions(),
    llmInstanceId: selectedLlmInstanceId()
  }))
  if (updated) upsertSession(updated)
}

async function deleteSelectedSession(): Promise<void> {
  const session = selectedSession.value
  if (!session) return
  const nextSessions = await runApi('chat.deleteSession', 'chat.deleteSession', () => ha.chat.deleteSession(session.id))
  if (!nextSessions) return
  sessions.value = nextSessions
  selectedSessionId.value = nextSessions[0]?.id ?? null
}

async function appendMessage(): Promise<void> {
  const session = selectedSession.value
  if (!session) return
  const message = await runApi('chat.appendMessage', 'chat.appendMessage', () => ha.chat.appendMessage(session.id, {
    role: messageRole.value,
    content: messageContent.value
  }))
  if (message) await loadSession(session.id)
}

async function appendRichMessage(): Promise<void> {
  const session = selectedSession.value
  if (!session) return
  const message = await runApi('chat.appendMessage', 'chat.appendMessage(contentParts)', () => ha.chat.appendMessage(session.id, {
    role: 'assistant',
    contentParts: [
      { type: 'reasoning', text: '这是用于验证 reasoning content part 的测试片段。', sendAsContext: true },
      { type: 'text', text: messageContent.value }
    ],
    metadata: {
      createdBy: 'api-lab',
      mode: 'contentParts'
    }
  }))
  if (message) await loadSession(session.id)
}

async function updateSelectedMessage(): Promise<void> {
  const session = selectedSession.value
  const message = selectedMessage.value
  if (!session || !message) return
  const contentParts = buildEditedContentParts()
  if (!contentParts) return
  const updated = await runApi('chat.updateMessage', 'chat.updateMessage', () => ha.chat.updateMessage(session.id, message.id, {
    contentParts,
    metadata: {
      ...message.metadata,
      updatedBy: 'api-lab',
      updatedAt: new Date().toISOString()
    }
  }))
  if (updated) await loadSession(session.id)
}

async function deleteSelectedMessage(): Promise<void> {
  const session = selectedSession.value
  const message = selectedMessage.value
  if (!session || !message) return
  const updatedSession = await runApi('chat.deleteMessage', 'chat.deleteMessage', () => (
    ha.chat.deleteMessage(session.id, message.id)
  ))
  if (updatedSession) upsertSession(updatedSession)
}

async function registerRandomToolForSelected(): Promise<void> {
  const session = selectedSession.value
  if (!session) return
  await registerRandomTool(session.id)
  await loadSession(session.id)
}

async function registerRandomTool(chatSessionId: number): Promise<void> {
  const toolSession = await runApi('chat.registerTool', 'chat.registerTool(random_number)', () => ha.chat.registerTool(chatSessionId, {
    name: 'random_number',
    description: 'Return a random integer from 0 to max and the current ISO time string.',
    inputSchema: {
      type: 'object',
      properties: {
        max: {
          type: 'number',
          description: 'Maximum inclusive random value.'
        }
      },
      required: ['max'],
      additionalProperties: false
    }
  }, async input => {
    pushLog('info', 'random_number 请求用户同意', input)
    const approved = await requestToolConsent('random_number', input)
    if (!approved) {
      pushLog('warning', 'random_number 用户拒绝', input)
      throw new Error('用户拒绝工具调用。')
    }
    const output = randomToolOutput(input)
    pushLog('success', 'random_number handler 返回', output)
    return output
  }))
  if (toolSession) upsertSession(toolSession)
}

function randomToolOutput(input: JsonRecord): JsonRecord {
  const rawMax = Number(input.max ?? randomMax.value)
  const max = Number.isFinite(rawMax) ? Math.max(0, Math.floor(rawMax)) : 0
  return {
    max,
    value: Math.floor(Math.random() * (max + 1)),
    time: new Date().toISOString()
  }
}

function requestToolConsent(toolName: string, input: JsonRecord): Promise<boolean> {
  return new Promise(resolve => {
    const request: ToolConsentRequest = {
      id: ++toolConsentId,
      toolName,
      input,
      resolve
    }
    if (activeToolConsent.value) toolConsentQueue.push(request)
    else activeToolConsent.value = request
  })
}

function resolveToolConsent(approved: boolean): void {
  const request = activeToolConsent.value
  if (!request) return
  request.resolve(approved)
  activeToolConsent.value = toolConsentQueue.shift() ?? null
}

async function triggerReply(): Promise<void> {
  const session = selectedSession.value
  if (!session) return
  const updated = await runApi('chat.triggerLlmReply', 'chat.triggerLlmReply', () => ha.chat.triggerLlmReply(session.id))
  if (updated) upsertSession(updated)
}

async function askToolAndTrigger(): Promise<void> {
  const session = selectedSession.value
  if (!session) return
  await registerRandomTool(session.id)
  const message = await runApi('chat.appendMessage', 'chat.appendMessage(tool request)', () => ha.chat.appendMessage(session.id, {
    role: 'user',
    content: `请调用 random_number 工具，max 参数为 ${normalizeMax(randomMax.value)}。拿到工具结果后，请用中文报告随机值和 time 字符串。`
  }))
  if (!message) return
  await triggerReply()
}

async function stopReply(): Promise<void> {
  const session = selectedSession.value
  if (!session) return
  await runApi('chat.stopLlmReply', 'chat.stopLlmReply', () => ha.chat.stopLlmReply(session.id))
  await loadSession(session.id)
}

function normalizeMax(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function registerEventListeners(): void {
  for (const type of eventTypes) {
    const unsubscribe = ha.on(type, event => {
      void handleEvent(event as AppEvent)
    })
    unsubscribers.push(unsubscribe)
  }
}

async function handleEvent(event: AppEvent): Promise<void> {
  pushEvent(event)
  markCheck(`event.${event.type}`, 'pass', '已收到')

  if (event.type === 'userMessage') {
    if (autoAppendUserMessage.value) {
      await runApi('chat.appendMessage', 'auto append userMessage', () => ha.chat.appendMessage(event.chatSessionId, {
        role: 'user',
        content: event.text,
        metadata: {
          source: event.source
        }
      }))
      await loadSession(event.chatSessionId)
    }
    if (autoTriggerAfterUser.value) {
      await runApi('chat.triggerLlmReply', 'auto trigger after userMessage', () => ha.chat.triggerLlmReply(event.chatSessionId))
    }
    return
  }

  if (event.type === 'llmInstanceChanged') {
    await loadSession(event.chatSessionId)
    return
  }

  if (
    event.type === 'llmReplyStarted' ||
    event.type === 'llmReplyFinished' ||
    event.type === 'llmReplyStopped' ||
    event.type === 'llmReplyError'
  ) {
    await loadSession(event.chatSessionId)
  }
}
</script>
