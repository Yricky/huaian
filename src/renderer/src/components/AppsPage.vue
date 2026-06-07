<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  MdAdd,
  MdApps,
  MdChat,
  MdClose,
  MdDeleteOutline,
  MdDriveFileRenameOutline,
  MdFolder,
  MdInventory2,
  MdMoreVert,
  MdOpenInNew,
  MdPlayArrow,
  MdRefresh,
  MdSave,
  MdUploadFile
} from 'vue-icons-plus/md'
import type { AppDescriptor, AppSessionRecord } from '../../../shared/types'
import { useProjectWorkbench, type RuntimeAppSession } from '../composables/useProjectWorkbench'
import AppChatPanel from './AppChatPanel.vue'

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
  showToast,
  toggleChatPanel,
  uninstallSelectedApp
} = useProjectWorkbench()

const uninstallDialogOpen = ref(false)
const deleteConfigData = ref(false)
const deleteAllSaves = ref(false)
const debugMenuRuntimeKey = ref<string | null>(null)
const debugUrlDrafts = ref<Record<string, string>>({})
const frameReloadTicks = ref<Record<string, number>>({})
const frameUrls = ref<Record<string, string>>({})
const chatPanelWidth = ref<number | null>(null)
const isChatPanelResizing = ref(false)

const activeChatSession = computed(() => {
  const runtime = activeRuntime.value
  if (!runtime || runtime.activeChatSessionId === null) return null
  return runtime.chatSessions.find(session => session.id === runtime.activeChatSessionId) ?? null
})

const runtimeLayerStyle = computed(() => (
  chatPanelWidth.value === null ? {} : { '--chat-panel-width': `${chatPanelWidth.value}px` }
))

function appInitial(app: AppDescriptor): string {
  return (app.manifest.name || app.manifest.id).trim().slice(0, 1).toUpperCase() || 'A'
}

function runtimeTitle(runtime: RuntimeAppSession): string {
  return `${runtime.app.manifest.name || runtime.app.manifest.id} · ${runtime.record.title}`
}

function defaultFrameUrl(runtime: RuntimeAppSession): string {
  return window.electronAPI.appAssetUrl(runtime.app.manifest.id, 'index.html')
}

function frameUrl(runtime: RuntimeAppSession): string {
  return frameUrls.value[runtime.key] ?? defaultFrameUrl(runtime)
}

function frameKey(runtime: RuntimeAppSession): string {
  return `${runtime.key}:${frameUrl(runtime)}:${frameReloadTicks.value[runtime.key] ?? 0}`
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

function normalizeDebugUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    return ['ha-app:', 'http:', 'https:'].includes(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

function bumpFrameReload(runtime: RuntimeAppSession) {
  frameReloadTicks.value = {
    ...frameReloadTicks.value,
    [runtime.key]: (frameReloadTicks.value[runtime.key] ?? 0) + 1
  }
}

function toggleDebugMenu(runtime: RuntimeAppSession) {
  const nextKey = debugMenuRuntimeKey.value === runtime.key ? null : runtime.key
  debugMenuRuntimeKey.value = nextKey
  if (nextKey) {
    debugUrlDrafts.value = {
      ...debugUrlDrafts.value,
      [runtime.key]: debugUrlDrafts.value[runtime.key] ?? frameUrl(runtime)
    }
  }
}

function openDebugUrl(runtime: RuntimeAppSession) {
  const url = normalizeDebugUrl(debugUrlDrafts.value[runtime.key] ?? '')
  if (!url) {
    showToast('请输入 http://、https:// 或 ha-app:// 开头的完整网址。', 'error')
    return
  }
  frameUrls.value = { ...frameUrls.value, [runtime.key]: url }
  debugUrlDrafts.value = { ...debugUrlDrafts.value, [runtime.key]: url }
  bumpFrameReload(runtime)
  debugMenuRuntimeKey.value = null
}

function refreshFrame(runtime: RuntimeAppSession) {
  bumpFrameReload(runtime)
  debugMenuRuntimeKey.value = null
}

function clearRuntimeFrameState(runtime: RuntimeAppSession) {
  const { [runtime.key]: _url, ...nextUrls } = frameUrls.value
  const { [runtime.key]: _draft, ...nextDrafts } = debugUrlDrafts.value
  const { [runtime.key]: _tick, ...nextTicks } = frameReloadTicks.value
  frameUrls.value = nextUrls
  debugUrlDrafts.value = nextDrafts
  frameReloadTicks.value = nextTicks
  if (debugMenuRuntimeKey.value === runtime.key) debugMenuRuntimeKey.value = null
}

async function closeAppRuntime(runtime: RuntimeAppSession) {
  clearRuntimeFrameState(runtime)
  await closeRuntime(runtime)
}

function closeDebugMenu() {
  debugMenuRuntimeKey.value = null
}

function handleDocumentClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null
  if (!target?.closest('.runtime-debug-menu-shell')) closeDebugMenu()
}

function handleDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeDebugMenu()
}

async function confirmUninstall() {
  uninstallDialogOpen.value = false
  await uninstallSelectedApp({
    deleteConfigData: deleteConfigData.value,
    deleteAllSaves: deleteAllSaves.value
  })
}

onMounted(() => {
  document.addEventListener('click', handleDocumentClick)
  document.addEventListener('keydown', handleDocumentKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick)
  document.removeEventListener('keydown', handleDocumentKeydown)
})
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

    <section class="runtime-layer" :style="runtimeLayerStyle"
      :class="{ visible: activeRuntime, 'panel-open': activeRuntime?.chatPanelOpen && activeChatSession }">
      <AppChatPanel v-if="activeRuntime && activeChatSession"
        v-show="activeRuntime.chatPanelOpen"
        :runtime="activeRuntime"
        :session="activeChatSession"
        @panel-width="chatPanelWidth = $event"
        @resizing="isChatPanelResizing = $event" />

      <main class="frame-stage">
        <article v-for="runtime in runningAppSessions" :key="runtime.key" class="frame-cell"
          :class="{ active: isRuntimeActive(runtime) }">
          <header class="runtime-header">
            <strong>{{ runtimeTitle(runtime) }}</strong>
            <div class="runtime-actions">
              <div class="runtime-debug-menu-shell" :class="{ open: debugMenuRuntimeKey === runtime.key }">
                <button class="icon-button" type="button" aria-label="更多" data-tooltip="更多" aria-haspopup="dialog"
                  :aria-expanded="debugMenuRuntimeKey === runtime.key" @click="toggleDebugMenu(runtime)">
                  <MdMoreVert aria-hidden="true" />
                </button>
                <section v-if="debugMenuRuntimeKey === runtime.key" class="runtime-debug-popover" role="dialog"
                  aria-label="iframe 调试" @click.stop>
                  <form class="debug-url-form" @submit.prevent="openDebugUrl(runtime)">
                    <label class="debug-url-label">
                      <span>自定义网址</span>
                      <span class="debug-url-row">
                        <input v-model="debugUrlDrafts[runtime.key]" class="debug-url-input" type="text"
                          inputmode="url" spellcheck="false" placeholder="http://localhost:5173" />
                        <button class="debug-icon-button" type="submit" aria-label="打开" data-tooltip="打开">
                          <MdOpenInNew aria-hidden="true" />
                        </button>
                      </span>
                    </label>
                  </form>
                  <button class="debug-menu-action" type="button" @click="refreshFrame(runtime)">
                    <MdRefresh aria-hidden="true" />
                    <span>刷新当前页面</span>
                  </button>
                </section>
              </div>
              <button class="icon-button" type="button" aria-label="关闭存档" data-tooltip="关闭存档"
                @click="closeAppRuntime(runtime)">
                <MdClose aria-hidden="true" />
              </button>
            </div>
          </header>
          <iframe :key="frameKey(runtime)" :src="frameUrl(runtime)"
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads"
            @load="onFrameLoad(runtime, $event)" />
        </article>
        <div v-if="debugMenuRuntimeKey" class="debug-menu-scrim" aria-hidden="true" @click="closeDebugMenu"></div>
      </main>
      <div v-if="isChatPanelResizing" class="chat-resize-scrim" aria-hidden="true"></div>

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
  --chat-panel-width: min(680px, 46vw);
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
  grid-template-columns: minmax(0, 1fr) minmax(360px, min(var(--chat-panel-width), 900px)) 36px;
}

.chat-resize-scrim {
  position: absolute;
  inset: 0;
  z-index: 80;
  background: transparent;
  cursor: col-resize;
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

.debug-menu-scrim {
  position: absolute;
  inset: 0;
  z-index: 50;
  background: transparent;
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

.runtime-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
}

.runtime-debug-menu-shell {
  position: relative;
  display: grid;
  place-items: center;
}

.runtime-debug-menu-shell.open .icon-button::after {
  display: none;
}

.runtime-debug-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 60;
  width: min(360px, calc(100vw - 32px));
  display: grid;
  gap: 10px;
  border: 1px solid #d8e0ea;
  border-radius: 8px;
  background: #ffffff;
  padding: 12px;
  box-shadow: 0 14px 36px rgba(24, 32, 44, 0.18);
}

.debug-url-form,
.debug-url-label {
  min-width: 0;
  display: grid;
  gap: 7px;
}

.debug-url-label > span:first-child {
  color: #425064;
  font-size: 12px;
  font-weight: 800;
}

.debug-url-row {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px;
  gap: 8px;
}

.debug-url-input {
  width: 100%;
  min-width: 0;
  height: 34px;
  border: 1px solid #c6d1df;
  border-radius: 7px;
  background: #ffffff;
  color: #1f2a38;
  padding: 0 9px;
  font-size: 12px;
  outline: none;
}

.debug-url-input:focus {
  border-color: #2f6fca;
  box-shadow: 0 0 0 2px rgba(47, 111, 202, 0.14);
}

.debug-icon-button {
  position: relative;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 1px solid #b8c4d2;
  border-radius: 7px;
  background: #f8fafc;
  color: #2b5d9f;
  padding: 0;
}

.debug-icon-button:hover,
.debug-menu-action:hover {
  background: #edf4ff;
}

.debug-icon-button svg,
.debug-menu-action svg {
  width: 18px;
  height: 18px;
}

.debug-icon-button::after {
  position: absolute;
  top: calc(100% + 7px);
  right: 0;
  z-index: 70;
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

.debug-icon-button:hover::after,
.debug-icon-button:focus-visible::after {
  opacity: 1;
  transform: translateY(0);
}

.debug-menu-action {
  min-width: 0;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  border: 1px solid #b8c4d2;
  border-radius: 7px;
  background: #ffffff;
  color: #273446;
  padding: 0 10px;
  font-size: 13px;
  font-weight: 700;
  text-align: left;
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
    grid-template-columns: minmax(0, 1fr) minmax(320px, min(var(--chat-panel-width), 60vw)) 36px;
  }

  .header-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
  }
}
</style>
