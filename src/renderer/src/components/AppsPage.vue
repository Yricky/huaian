<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  MdAdd,
  MdApps,
  MdChat,
  MdClose,
  MdCode,
  MdDeleteOutline,
  MdDriveFileRenameOutline,
  MdFolder,
  MdInventory2,
  MdPlayArrow,
  MdSave,
  MdSend,
  MdSmartToy,
  MdStop,
  MdUploadFile
} from 'vue-icons-plus/md'
import type { AppChatContentPart, AppChatMessage, AppChatSessionState, AppDescriptor, AppSessionRecord } from '../../../shared/types'
import { useProjectWorkbench, type RuntimeAppSession } from '../composables/useProjectWorkbench'
import MarkdownView from './MarkdownView.vue'

const {
  activeRuntime,
  activeRuntimeKey,
  appIconUrl,
  apps,
  closeRuntime,
  createAppSession,
  deleteAppSession,
  handleAppFrameLoaded,
  installApp,
  openApp,
  openAppSession,
  renameAppSession,
  runningAppSessions,
  selectedApp,
  selectedAppSessions,
  sendUserMessage,
  stopChatReply,
  toggleChatPanel,
  uninstallSelectedApp
} = useProjectWorkbench()

const composerDrafts = ref<Record<string, string>>({})
const uninstallDialogOpen = ref(false)
const deleteConfigData = ref(false)
const deleteAllSaves = ref(false)

const activeChatSession = computed(() => {
  const runtime = activeRuntime.value
  if (!runtime || runtime.activeChatSessionId === null) return null
  return runtime.chatSessions.find(session => session.id === runtime.activeChatSessionId) ?? null
})

function appInitial(app: AppDescriptor): string {
  return (app.manifest.name || app.manifest.id).trim().slice(0, 1).toUpperCase() || 'A'
}

function runtimeTitle(runtime: RuntimeAppSession): string {
  return `${runtime.app.manifest.name || runtime.app.manifest.id} · ${runtime.record.title}`
}

function frameUrl(runtime: RuntimeAppSession): string {
  return window.electronAPI.appAssetUrl(runtime.app.manifest.id, 'index.html')
}

function isRuntimeActive(runtime: RuntimeAppSession): boolean {
  return activeRuntimeKey.value === runtime.key
}

function onFrameLoad(runtime: RuntimeAppSession, event: Event) {
  const iframe = event.target as HTMLIFrameElement
  const targetWindow = iframe.contentWindow
  if (!targetWindow) return
  void handleAppFrameLoaded(runtime, targetWindow)
}

function openUninstallDialog() {
  deleteConfigData.value = false
  deleteAllSaves.value = false
  uninstallDialogOpen.value = true
}

async function confirmUninstall() {
  uninstallDialogOpen.value = false
  await uninstallSelectedApp({
    deleteConfigData: deleteConfigData.value,
    deleteAllSaves: deleteAllSaves.value
  })
}

function chatKey(runtime: RuntimeAppSession, session: AppChatSessionState): string {
  return `${runtime.key}:${session.id}`
}

function roleLabel(role: AppChatMessage['role']): string {
  if (role === 'assistant') return 'AI'
  if (role === 'system') return '系统'
  return '用户'
}

function composerKey(runtime: RuntimeAppSession, session: AppChatSessionState): string {
  return `${runtime.key}:${session.id}`
}

function canSendComposer(runtime: RuntimeAppSession, session: AppChatSessionState): boolean {
  const text = composerDrafts.value[composerKey(runtime, session)] ?? ''
  return session.allowUserReply && session.status !== 'generating' && text.trim().length > 0
}

function llmPillLabel(session: AppChatSessionState): string {
  return session.llmInstanceId === null ? '未选择 LLM' : `LLM ${session.llmInstanceId}`
}

function partKey(message: AppChatMessage, part: AppChatContentPart, index: number): string {
  return part.type === 'tool_call' ? `${message.id}:tool:${part.toolCallId}` : `${message.id}:${part.type}:${index}`
}

function toolStatusLabel(status: Extract<AppChatContentPart, { type: 'tool_call' }>['status']): string {
  if (status === 'pending') return '等待中'
  if (status === 'error') return '失败'
  return '完成'
}

function jsonPreview(value: unknown): string {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

async function sendComposer(runtime: RuntimeAppSession, session: AppChatSessionState) {
  const key = composerKey(runtime, session)
  const text = (composerDrafts.value[key] ?? '').trim()
  if (!text) return
  composerDrafts.value = { ...composerDrafts.value, [key]: '' }
  await sendUserMessage(runtime, session.id, text, 'composer')
}

async function chooseOption(runtime: RuntimeAppSession, session: AppChatSessionState, option: string) {
  await sendUserMessage(runtime, session.id, option, 'option')
}
</script>

<template>
  <section class="apps-page">
    <section class="app-content" :class="{ hidden: activeRuntime }">
      <div v-if="selectedApp" class="save-list-page">
        <header class="page-header">
          <div class="title-cluster">
            <span class="app-avatar">
              <img v-if="appIconUrl(selectedApp)" :src="appIconUrl(selectedApp)" alt="" />
              <span v-else>{{ appInitial(selectedApp) }}</span>
            </span>
            <span>
              <h1>{{ selectedApp.manifest.name || selectedApp.manifest.id }}</h1>
              <small>{{ selectedApp.manifest.description || selectedApp.manifest.id }} · v{{ selectedApp.manifest.version }}</small>
            </span>
          </div>
          <div class="header-actions">
            <button class="toolbar-action" type="button" @click="installApp">
              <MdUploadFile class="inline-icon" aria-hidden="true" />
              安装
            </button>
            <button class="toolbar-action danger" type="button" @click="openUninstallDialog">
              <MdDeleteOutline class="inline-icon" aria-hidden="true" />
              卸载
            </button>
            <button class="primary-action" type="button" @click="createAppSession(selectedApp.manifest.id)">
              <MdAdd class="inline-icon" aria-hidden="true" />
              新建存档
            </button>
          </div>
        </header>

        <div v-if="selectedAppSessions.length" class="save-grid">
          <article v-for="session in selectedAppSessions" :key="`${session.appId}:${session.id}`" class="save-card">
            <span class="save-icon"><MdSave aria-hidden="true" /></span>
            <div class="save-copy">
              <strong>{{ session.title }}</strong>
              <span>存档 {{ session.id }} · 创建版本 {{ session.version }}</span>
              <small>最近打开 {{ new Date(session.lastOpenedAt).toLocaleString() }}</small>
            </div>
            <div class="save-actions">
              <button class="icon-button" type="button" aria-label="重命名" data-tooltip="重命名"
                @click="renameAppSession(session)">
                <MdDriveFileRenameOutline aria-hidden="true" />
              </button>
              <button class="icon-button danger" type="button" aria-label="删除" data-tooltip="删除"
                @click="deleteAppSession(session)">
                <MdDeleteOutline aria-hidden="true" />
              </button>
              <button class="open-button" type="button" @click="openAppSession(session)">
                <MdPlayArrow aria-hidden="true" />
                打开
              </button>
            </div>
          </article>
        </div>

        <div v-else class="empty-state">
          <MdInventory2 class="empty-icon" aria-hidden="true" />
          <h2>还没有存档</h2>
          <button class="primary-action" type="button" @click="createAppSession(selectedApp.manifest.id)">
            <MdAdd class="inline-icon" aria-hidden="true" />
            新建存档
          </button>
        </div>
      </div>

      <div v-else class="library-page">
        <header class="page-header">
          <div class="title-cluster">
            <span class="app-avatar muted"><MdApps aria-hidden="true" /></span>
            <span>
              <h1>应用</h1>
              <small>{{ apps.length }} 个已安装应用</small>
            </span>
          </div>
          <button class="primary-action" type="button" @click="installApp">
            <MdUploadFile class="inline-icon" aria-hidden="true" />
            安装应用
          </button>
        </header>

        <div v-if="apps.length" class="app-grid">
          <button v-for="app in apps" :key="app.manifest.id" class="app-card" type="button"
            @click="openApp(app.manifest.id)">
            <span class="app-avatar">
              <img v-if="appIconUrl(app)" :src="appIconUrl(app)" alt="" />
              <span v-else>{{ appInitial(app) }}</span>
            </span>
            <strong>{{ app.manifest.name || app.manifest.id }}</strong>
            <span>{{ app.manifest.description || app.manifest.id }}</span>
            <small>v{{ app.manifest.version }}</small>
          </button>
        </div>

        <div v-else class="empty-state">
          <MdFolder class="empty-icon" aria-hidden="true" />
          <h2>还没有安装应用</h2>
          <button class="primary-action" type="button" @click="installApp">
            <MdUploadFile class="inline-icon" aria-hidden="true" />
            安装应用
          </button>
        </div>
      </div>
    </section>

    <section class="runtime-layer" :class="{ visible: activeRuntime, 'panel-open': activeRuntime?.chatPanelOpen && activeChatSession }">
      <aside v-if="activeRuntime?.chatPanelOpen && activeChatSession" class="chat-panel">
        <header class="chat-panel-header">
          <span>
            <strong>{{ activeChatSession.title }}</strong>
            <small>{{ activeChatSession.status }}</small>
          </span>
          <button class="icon-button" type="button" aria-label="收起" data-tooltip="收起"
            @click="toggleChatPanel(activeRuntime, activeChatSession.id)">
            <MdClose aria-hidden="true" />
          </button>
        </header>

        <div class="message-list">
          <article v-for="message in activeChatSession.messages" :key="message.id" class="message-bubble"
            :class="[message.role, message.status]">
            <header>
              <span>{{ roleLabel(message.role) }}</span>
              <small v-if="message.status !== 'idle'">{{ message.status }}</small>
            </header>
            <template v-for="(part, partIndex) in message.contentParts" :key="partKey(message, part, partIndex)">
              <MarkdownView v-if="part.type === 'text' && part.text" class="message-markdown" :markdown="part.text" />
              <details v-else-if="part.type === 'reasoning' && part.text" class="reasoning-part">
                <summary>
                  <span>思考</span>
                </summary>
                <MarkdownView class="message-markdown" :markdown="part.text" />
              </details>
              <section v-else-if="part.type === 'tool_call'" class="tool-call" :class="part.status">
                <header class="tool-call-header">
                  <strong>{{ part.toolName }}</strong>
                  <span>{{ toolStatusLabel(part.status) }}</span>
                </header>
                <details class="tool-json">
                  <summary>输入</summary>
                  <pre>{{ jsonPreview(part.input) }}</pre>
                </details>
                <details v-if="part.output !== undefined" class="tool-json">
                  <summary>输出</summary>
                  <pre>{{ jsonPreview(part.output) }}</pre>
                </details>
                <p v-if="part.error" class="tool-error">{{ part.error }}</p>
              </section>
            </template>
            <em v-if="message.errorText">{{ message.errorText }}</em>
          </article>
        </div>

        <div v-if="activeChatSession.options.length" class="option-list">
          <button v-for="option in activeChatSession.options" :key="option" type="button"
            @click="chooseOption(activeRuntime, activeChatSession, option)">
            {{ option }}
          </button>
        </div>

        <footer class="chat-composer">
          <form class="composer-form" @submit.prevent="sendComposer(activeRuntime, activeChatSession)">
            <textarea v-model="composerDrafts[chatKey(activeRuntime, activeChatSession)]" class="composer-input"
              rows="2" :placeholder="activeChatSession.allowUserReply ? '输入消息...' : '当前对话不允许用户回复'"
              :disabled="!activeChatSession.allowUserReply || activeChatSession.status === 'generating'"
              @keydown.enter.exact.prevent="sendComposer(activeRuntime, activeChatSession)" />

            <div class="composer-controls">
              <div class="composer-left">
                <span class="model-pill">
                  <span class="model-pill-icon" aria-hidden="true">
                    <MdSmartToy class="model-pill-symbol" />
                  </span>
                  <span class="model-pill-label">{{ llmPillLabel(activeChatSession) }}</span>
                </span>
                <span class="model-pill tool-pill">
                  <span class="model-pill-icon" aria-hidden="true">
                    <MdCode class="model-pill-symbol" />
                  </span>
                  <span class="model-pill-label">工具 {{ activeChatSession.tools.length }}</span>
                </span>
              </div>

              <div class="composer-right">
                <button v-if="activeChatSession.status === 'generating'" class="composer-action-button stop"
                  type="button" aria-label="停止" data-tooltip="停止"
                  @click="stopChatReply(activeRuntime, activeChatSession.id)">
                  <MdStop size="16" />
                </button>
                <button v-else class="composer-action-button" type="submit" :disabled="!canSendComposer(activeRuntime, activeChatSession)"
                  aria-label="发送" data-tooltip="发送">
                  <MdSend size="16" />
                </button>
              </div>
            </div>
          </form>
        </footer>
      </aside>

      <main class="frame-stage">
        <article v-for="runtime in runningAppSessions" :key="runtime.key" class="frame-cell"
          :class="{ active: isRuntimeActive(runtime) }">
          <header class="runtime-header">
            <strong>{{ runtimeTitle(runtime) }}</strong>
            <button class="icon-button" type="button" aria-label="关闭存档" data-tooltip="关闭存档"
              @click="closeRuntime(runtime)">
              <MdClose aria-hidden="true" />
            </button>
          </header>
          <iframe :src="frameUrl(runtime)"
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads"
            @load="onFrameLoad(runtime, $event)" />
        </article>
      </main>

      <aside v-if="activeRuntime" class="chat-rail" aria-label="chatSession">
        <button v-for="session in activeRuntime.chatSessions" :key="session.id" class="chat-rail-item" type="button"
          :class="{ active: activeRuntime.activeChatSessionId === session.id && activeRuntime.chatPanelOpen, generating: session.status === 'generating' }"
          :title="session.title" @click="toggleChatPanel(activeRuntime, session.id)">
          <MdChat aria-hidden="true" />
          <span>{{ session.id }}</span>
        </button>
      </aside>
    </section>

    <div v-if="uninstallDialogOpen" class="modal-backdrop" @click.self="uninstallDialogOpen = false">
      <section class="uninstall-dialog" role="dialog" aria-modal="true" aria-label="卸载应用">
        <header>
          <h2>卸载应用</h2>
          <button class="icon-button" type="button" aria-label="关闭" @click="uninstallDialogOpen = false">
            <MdClose aria-hidden="true" />
          </button>
        </header>
        <label class="check-row">
          <input v-model="deleteConfigData" type="checkbox" />
          <span>删除配置数据</span>
        </label>
        <label class="check-row">
          <input v-model="deleteAllSaves" type="checkbox" />
          <span>删除所有存档</span>
        </label>
        <footer>
          <button class="toolbar-action" type="button" @click="uninstallDialogOpen = false">取消</button>
          <button class="toolbar-action danger" type="button" @click="confirmUninstall">卸载</button>
        </footer>
      </section>
    </div>
  </section>
</template>

<style scoped>
.apps-page {
  position: relative;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  background: #ffffff;
}

.app-content {
  height: 100%;
  min-width: 0;
  overflow: auto;
}

.app-content.hidden {
  visibility: hidden;
  pointer-events: none;
}

.library-page,
.save-list-page {
  min-height: 100%;
  padding: 22px;
}

.page-header {
  min-height: 66px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid #e7ebf0;
  margin-bottom: 18px;
  padding-bottom: 14px;
}

.title-cluster {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.title-cluster h1 {
  margin: 0;
  color: #161b22;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 0;
}

.title-cluster small {
  display: block;
  min-width: 0;
  overflow: hidden;
  color: #6d7787;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-avatar {
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 8px;
  background: #daeee2;
  color: #17452a;
  font-size: 17px;
  font-weight: 800;
}

.app-avatar.muted {
  background: #eef1f5;
  color: #5a6370;
}

.app-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.header-actions,
.save-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.primary-action,
.toolbar-action,
.open-button {
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid #b8c4d2;
  border-radius: 8px;
  background: #ffffff;
  color: #273446;
  padding: 7px 11px;
  font-size: 13px;
  font-weight: 700;
}

.primary-action {
  border-color: #2f6fca;
  background: #f4f8ff;
  color: #174f99;
}

.toolbar-action:hover,
.primary-action:hover,
.open-button:hover {
  background: #f1f5fb;
}

.toolbar-action.danger {
  border-color: #ddc4c4;
  color: #a33a3a;
}

.inline-icon {
  width: 18px;
  height: 18px;
}

.app-grid,
.save-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.app-card,
.save-card {
  min-width: 0;
  display: grid;
  gap: 8px;
  border: 1px solid #d9e0e9;
  border-radius: 8px;
  background: #ffffff;
  color: #263141;
  padding: 14px;
  text-align: left;
}

.app-card {
  min-height: 172px;
}

.app-card:hover,
.save-card:hover {
  border-color: #bfcada;
  background: #fbfcfe;
}

.app-card strong,
.save-copy strong {
  min-width: 0;
  overflow: hidden;
  color: #161b22;
  font-size: 15px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-card span,
.save-copy span {
  min-width: 0;
  overflow: hidden;
  color: #677386;
  font-size: 12px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-card small,
.save-copy small {
  color: #8a94a5;
  font-size: 11px;
}

.save-card {
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
}

.save-icon {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: #eef5ff;
  color: #315cab;
}

.save-copy {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.save-actions {
  grid-column: 1 / -1;
  justify-content: flex-end;
  padding-top: 4px;
}

.icon-button {
  position: relative;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #4d596b;
  padding: 0;
}

.icon-button:hover {
  background: #edf2f8;
}

.icon-button.danger {
  color: #a33a3a;
}

.icon-button svg,
.open-button svg {
  width: 19px;
  height: 19px;
}

.icon-button::after {
  position: absolute;
  top: calc(100% + 7px);
  right: 0;
  z-index: 40;
  pointer-events: none;
  content: attr(data-tooltip);
  opacity: 0;
  transform: translateY(-2px);
  border-radius: 4px;
  background: #30343a;
  padding: 5px 8px;
  color: #ffffff;
  font-size: 12px;
  white-space: nowrap;
  transition: opacity 120ms ease, transform 120ms ease;
}

.icon-button:hover::after,
.icon-button:focus-visible::after {
  opacity: 1;
  transform: translateY(0);
}

.empty-state {
  min-height: 360px;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 12px;
  color: #5e6877;
  text-align: center;
}

.empty-state h2 {
  margin: 0;
  color: #253244;
  font-size: 16px;
  font-weight: 800;
}

.empty-icon {
  width: 44px;
  height: 44px;
  color: #96a2b5;
}

.runtime-layer {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 36px;
  grid-template-rows: minmax(0, 1fr);
  grid-auto-rows: 0;
  overflow: hidden;
  visibility: hidden;
  pointer-events: none;
  background: #ffffff;
}

.runtime-layer.visible {
  visibility: visible;
  pointer-events: auto;
}

.runtime-layer.panel-open {
  grid-template-columns: minmax(0, 1fr) minmax(520px, min(680px, 46vw)) 36px;
}

.chat-panel {
  grid-column: 2;
  grid-row: 1;
  width: auto;
  min-width: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto auto;
  min-height: 0;
  overflow: hidden;
  border-right: 1px solid #dfe5ed;
  border-left: 1px solid #dfe5ed;
  background: #fbfcfd;
}

.chat-panel-header {
  min-height: 54px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid #e5e9ef;
  padding: 8px 10px 8px 14px;
}

.chat-panel-header span {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.chat-panel-header strong {
  min-width: 0;
  overflow: hidden;
  color: #17202d;
  font-size: 14px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-panel-header small {
  color: #7b8798;
  font-size: 11px;
}

.message-list {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
  padding: 14px;
}

.message-bubble {
  width: fit-content;
  min-width: min(240px, 100%);
  max-width: 100%;
  display: grid;
  gap: 7px;
  border: 1px solid #dce3ec;
  border-radius: 8px;
  background: #ffffff;
  color: #202a38;
  padding: 10px 12px;
}

.message-bubble.user {
  width: fit-content;
  min-width: min(180px, 100%);
  max-width: 78%;
  align-self: flex-end;
  border-color: #bdd4f5;
  background: #f4f8ff;
}

.message-bubble.assistant {
  width: 100%;
  max-width: 100%;
  align-self: flex-start;
}

.message-bubble.system {
  width: 100%;
  align-self: center;
  max-width: 100%;
  background: #f3f5f7;
}

.message-bubble.error {
  border-color: #e0b9b9;
  background: #fff8f8;
}

.message-bubble > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: #6c7788;
  font-size: 11px;
  font-weight: 700;
}

.message-markdown {
  min-width: 0;
  color: #202a38;
  font-size: 13px;
  line-height: 1.45;
}

.message-markdown :deep(.sm-paragraph:last-child),
.message-markdown :deep(.sm-block:last-child) {
  margin-bottom: 0;
}

.message-markdown :deep(.sm-line),
.message-markdown :deep(.sm-code-line) {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.message-bubble em {
  color: #a33a3a;
  font-size: 12px;
  font-style: normal;
}

.reasoning-part {
  min-width: 0;
  border: 1px solid #d9e0e8;
  border-radius: 8px;
  background: #f7f9fb;
  padding: 7px 8px;
}

.reasoning-part summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #667286;
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
}

.reasoning-part[open] summary {
  margin-bottom: 6px;
}

.tool-call {
  min-width: 0;
  display: grid;
  gap: 6px;
  border: 1px solid #d8e0ea;
  border-radius: 8px;
  background: #f1f4f7;
  padding: 8px;
  font-size: 12px;
}

.tool-call-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.tool-call-header strong {
  min-width: 0;
  overflow: hidden;
  color: #304054;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-call-header span {
  flex: 0 0 auto;
  color: #657386;
  font-weight: 800;
}

.tool-call.error {
  border-color: #e5c4c4;
  background: #fff0f0;
}

.tool-json {
  min-width: 0;
}

.tool-json summary {
  cursor: pointer;
  color: #5c6879;
  font-size: 11px;
  font-weight: 800;
}

.tool-json pre {
  max-height: 160px;
  overflow: auto;
  margin: 5px 0 0;
  border-radius: 6px;
  background: #ffffff;
  color: #263141;
  padding: 7px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.tool-error {
  margin: 0;
  color: #a33a3a;
  overflow-wrap: anywhere;
}

.option-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  border-top: 1px solid #e8edf3;
  padding: 8px 10px;
}

.option-list button {
  border: 1px solid #cdd7e5;
  border-radius: 999px;
  background: #ffffff;
  color: #27405f;
  padding: 6px 9px;
  font-size: 12px;
  font-weight: 700;
}

.chat-composer {
  min-width: 0;
  border-top: 1px solid #e8edf3;
  background: #ffffff;
  padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px));
}

.composer-form {
  min-width: 0;
  display: grid;
  grid-template-rows: minmax(70px, 1fr) auto;
  gap: 6px;
  min-height: 122px;
  overflow: hidden;
  border: 1px solid #dddddd;
  border-radius: 16px;
  background: #ffffff;
  padding: 4px;
}

.composer-input {
  width: 100%;
  min-width: 0;
  min-height: 70px;
  max-height: 150px;
  resize: none;
  overflow: auto;
  border: 0;
  background: transparent;
  color: #1f2a38;
  padding: 2px 4px;
  outline: none;
  line-height: 1.45;
}

.composer-input:focus {
  outline: none;
}

.composer-input:disabled {
  cursor: default;
  opacity: 0.62;
}

.composer-controls {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.composer-left,
.composer-right {
  min-width: 0;
  display: flex;
  align-items: center;
}

.composer-left {
  justify-content: flex-start;
  gap: 6px;
}

.composer-right {
  justify-content: flex-end;
}

.model-pill {
  min-width: 0;
  max-width: min(180px, 100%);
  height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  overflow: hidden;
  border: 0;
  border-radius: 14px;
  background: #f5f5f5;
  color: #1f242b;
  padding: 0 8px 0 0;
  font-size: 13px;
  font-weight: 600;
}

.tool-pill {
  max-width: min(120px, 100%);
}

.model-pill-icon {
  width: 28px;
  height: 28px;
  display: grid;
  flex-shrink: 0;
  place-items: center;
  border-radius: 50%;
  background: #c8c8c8;
  color: #ffffff;
}

.model-pill-symbol {
  width: 12px;
  height: 12px;
}

.model-pill-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer-action-button {
  position: relative;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: #c8c8c8;
  color: #ffffff;
  padding: 6px;
  transition: background 140ms ease, opacity 140ms ease;
}

.composer-action-button:hover:not(:disabled) {
  background: #b6b6b6;
}

.composer-action-button.stop {
  background: #d66b6b;
}

.composer-action-button:disabled {
  cursor: default;
  opacity: 0.45;
}

.composer-action-button::after {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 30;
  pointer-events: none;
  content: attr(data-tooltip);
  opacity: 0;
  transform: translateY(2px);
  border-radius: 4px;
  background: #30343a;
  padding: 5px 8px;
  color: #ffffff;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(32, 36, 42, 0.2);
  transition: opacity 120ms ease, transform 120ms ease;
}

.composer-action-button:hover::after,
.composer-action-button:focus-visible::after {
  opacity: 1;
  transform: translateY(0);
}

.composer-action-button:focus-visible {
  outline: 2px solid #446bd7;
  outline-offset: 2px;
}

.frame-stage {
  position: relative;
  grid-column: 1;
  grid-row: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #ffffff;
}

.frame-cell {
  position: absolute;
  inset: 0;
  display: none;
  grid-template-rows: 42px minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
}

.frame-cell.active {
  display: grid;
}

.runtime-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid #e3e8ef;
  background: #ffffff;
  padding: 0 8px 0 14px;
}

.runtime-header strong {
  min-width: 0;
  overflow: hidden;
  color: #1d2633;
  font-size: 13px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.frame-cell iframe {
  width: 100%;
  height: 100%;
  border: 0;
  background: #ffffff;
}

.chat-rail {
  grid-column: 2;
  grid-row: 1;
  width: 36px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  border-left: 1px solid #dfe5ed;
  background: #f8fafc;
  padding: 8px 3px;
}

.runtime-layer.panel-open .chat-rail {
  grid-column: 3;
}

.chat-rail-item {
  position: relative;
  width: 30px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: #526071;
  font-size: 11px;
  font-weight: 800;
}

.chat-rail-item svg {
  width: 17px;
  height: 17px;
}

.chat-rail-item.active,
.chat-rail-item:hover {
  border-color: #cbd7e6;
  background: #ffffff;
  color: #24579b;
}

.chat-rail-item.generating::after {
  position: absolute;
  right: 5px;
  top: 5px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #2f9d63;
  content: "";
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  background: rgba(28, 35, 45, 0.36);
}

.uninstall-dialog {
  width: min(360px, calc(100vw - 32px));
  display: grid;
  gap: 10px;
  border-radius: 8px;
  background: #ffffff;
  padding: 14px;
  box-shadow: 0 18px 48px rgba(20, 28, 38, 0.25);
}

.uninstall-dialog header,
.uninstall-dialog footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.uninstall-dialog h2 {
  margin: 0;
  color: #1f2a38;
  font-size: 16px;
  font-weight: 800;
}

.check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #344256;
  font-size: 13px;
}

.check-row input {
  width: 16px;
  height: 16px;
  accent-color: #2f6fca;
}

@media (max-width: 900px) {
  .runtime-layer {
    grid-template-columns: minmax(0, 1fr) 36px;
  }

  .runtime-layer.panel-open {
    grid-template-columns: minmax(0, 1fr) minmax(320px, 60vw) 36px;
  }

  .chat-panel {
    min-width: 0;
  }

  .header-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
  }
}
</style>
