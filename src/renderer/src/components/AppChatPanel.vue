<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  MdAddPhotoAlternate,
  MdClose,
  MdCode,
  MdDragIndicator,
  MdImage,
  MdSend,
  MdSmartToy,
  MdStop
} from 'vue-icons-plus/md'
import type { AppChatContentPart, AppChatMessage, AppChatSessionState, UserContentPart } from '../../../shared/types'
import { useProjectWorkbench, type RuntimeAppSession } from '../composables/useProjectWorkbench'
import MarkdownView from './MarkdownView.vue'

type ChatRenderMode = 'raw' | 'markdown'
type ComposerItemKind = 'text' | 'attachment'

const CHAT_UI_CONFIG_PATH = '.huaian/ui-settings.json'
const DEFAULT_CHAT_RENDER_MODE: ChatRenderMode = 'markdown'
const CHAT_PANEL_MIN_WIDTH = 360
const CHAT_PANEL_MAX_WIDTH = 900
const COMPOSER_TEXT_ITEM_ID = '__text__'

interface ComposerAttachment {
  id: string
  name: string
  path: string
  mediaType: string
}

interface ComposerItem {
  id: string
  kind: ComposerItemKind
  label: string
  attachment?: ComposerAttachment
}

const props = defineProps<{
  runtime: RuntimeAppSession
  session: AppChatSessionState
}>()

const emit = defineEmits<{
  panelWidth: [width: number | null]
  resizing: [resizing: boolean]
}>()

const {
  availableLlmInstances,
  changeChatSessionLlmInstance,
  sendUserMessage,
  showToast,
  stopChatReply,
  toggleChatPanel
} = useProjectWorkbench()

const composerDrafts = ref<Record<string, string>>({})
const composerAttachments = ref<Record<string, ComposerAttachment[]>>({})
const composerItemOrders = ref<Record<string, string[]>>({})
const appChatRenderModes = ref<Record<string, ChatRenderMode>>({})
const chatPanelRef = ref<HTMLElement | null>(null)
const chatPanelWidth = ref<number | null>(null)
const imageObjectUrls = ref<Record<string, string>>({})
const draggingComposerItem = ref<{ key: string; itemId: string } | null>(null)
const loadedChatUiSettings = new Set<string>()
const loadingChatUiSettings = new Set<string>()
const loadingImageUrls = new Set<string>()
let chatPanelResizeStart: { startX: number; startWidth: number } | null = null

const runtime = computed(() => props.runtime)
const session = computed(() => props.session)

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizeChatRenderMode(value: unknown): ChatRenderMode {
  return value === 'raw' ? 'raw' : DEFAULT_CHAT_RENDER_MODE
}

function chatRenderMode(): ChatRenderMode {
  return appChatRenderModes.value[runtime.value.app.manifest.id] ?? DEFAULT_CHAT_RENDER_MODE
}

async function loadChatUiSettings(appId: string) {
  if (loadedChatUiSettings.has(appId) || loadingChatUiSettings.has(appId)) return
  loadingChatUiSettings.add(appId)
  try {
    const content = await window.electronAPI.readAppStorageFile('appData', appId, null, CHAT_UI_CONFIG_PATH)
    const config = content.trim() ? JSON.parse(content) as Record<string, unknown> : {}
    if (appChatRenderModes.value[appId] === undefined) {
      appChatRenderModes.value = {
        ...appChatRenderModes.value,
        [appId]: normalizeChatRenderMode(config.chatRenderMode)
      }
    }
    loadedChatUiSettings.add(appId)
  } catch (error) {
    showToast(errorText(error), 'error')
  } finally {
    loadingChatUiSettings.delete(appId)
  }
}

async function saveChatUiSettings(appId: string, mode: ChatRenderMode) {
  try {
    await window.electronAPI.writeAppStorageFile('appData', appId, null, CHAT_UI_CONFIG_PATH, JSON.stringify({
      chatRenderMode: mode
    }, null, 2))
    loadedChatUiSettings.add(appId)
  } catch (error) {
    showToast(errorText(error), 'error')
  }
}

function setChatRenderMode(mode: ChatRenderMode) {
  const appId = runtime.value.app.manifest.id
  appChatRenderModes.value = {
    ...appChatRenderModes.value,
    [appId]: mode
  }
  void saveChatUiSettings(appId, mode)
}

function chatPanelWidthLimit() {
  const viewportMax = Math.max(320, window.innerWidth - 80)
  const max = Math.min(CHAT_PANEL_MAX_WIDTH, viewportMax)
  return {
    min: Math.min(CHAT_PANEL_MIN_WIDTH, max),
    max
  }
}

function clampChatPanelWidth(width: number): number {
  const { min, max } = chatPanelWidthLimit()
  return Math.min(max, Math.max(min, Math.round(width)))
}

function handleChatPanelResizeMove(event: PointerEvent) {
  if (!chatPanelResizeStart) return
  chatPanelWidth.value = clampChatPanelWidth(
    chatPanelResizeStart.startWidth + chatPanelResizeStart.startX - event.clientX
  )
  emit('panelWidth', chatPanelWidth.value)
}

function stopChatPanelResize() {
  if (!chatPanelResizeStart) return
  chatPanelResizeStart = null
  emit('resizing', false)
  document.removeEventListener('pointermove', handleChatPanelResizeMove)
  document.removeEventListener('pointerup', stopChatPanelResize)
  document.removeEventListener('pointercancel', stopChatPanelResize)
  document.documentElement.classList.remove('resizing-chat-panel')
}

function startChatPanelResize(event: PointerEvent) {
  if (event.button !== 0) return
  const panelWidth = chatPanelRef.value?.getBoundingClientRect().width ?? chatPanelWidth.value ?? 680
  chatPanelResizeStart = {
    startX: event.clientX,
    startWidth: clampChatPanelWidth(panelWidth)
  }
  chatPanelWidth.value = chatPanelResizeStart.startWidth
  emit('panelWidth', chatPanelWidth.value)
  emit('resizing', true)
  ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
  document.addEventListener('pointermove', handleChatPanelResizeMove)
  document.addEventListener('pointerup', stopChatPanelResize)
  document.addEventListener('pointercancel', stopChatPanelResize)
  document.documentElement.classList.add('resizing-chat-panel')
}

function roleLabel(role: AppChatMessage['role']): string {
  if (role === 'assistant') return 'AI'
  if (role === 'system') return '系统'
  return '用户'
}

function messageStatus(message: AppChatMessage): string {
  return message.role === 'assistant' ? message.status : 'idle'
}

function messageErrorText(message: AppChatMessage): string {
  return message.role === 'assistant' ? message.errorText : ''
}

function composerKey(): string {
  return `${runtime.value.key}:${session.value.id}`
}

function composerText(): string {
  return (composerDrafts.value[composerKey()] ?? '').trim()
}

function composerAttachmentList(): ComposerAttachment[] {
  return composerAttachments.value[composerKey()] ?? []
}

function normalizedComposerOrder(key: string, text: string, attachments: ComposerAttachment[]): string[] {
  const attachmentIds = attachments.map(attachment => attachment.id)
  const defaultOrder = text ? [COMPOSER_TEXT_ITEM_ID, ...attachmentIds] : attachmentIds
  const currentIds = new Set(defaultOrder)
  const existing = (composerItemOrders.value[key] ?? []).filter(id => currentIds.has(id))
  if (!existing.length) return defaultOrder
  const missing = defaultOrder.filter(id => !existing.includes(id))
  const withText = text && !existing.includes(COMPOSER_TEXT_ITEM_ID)
    ? [COMPOSER_TEXT_ITEM_ID, ...existing]
    : existing
  return [...withText, ...missing.filter(id => id !== COMPOSER_TEXT_ITEM_ID)]
}

function composerItems(): ComposerItem[] {
  const key = composerKey()
  const text = composerText()
  const attachments = composerAttachmentList()
  const attachmentById = new Map(attachments.map(attachment => [attachment.id, attachment]))
  const items: ComposerItem[] = []
  for (const id of normalizedComposerOrder(key, text, attachments)) {
    if (id === COMPOSER_TEXT_ITEM_ID) {
      if (text) items.push({ id, kind: 'text', label: text.slice(0, 1).toUpperCase() })
      continue
    }
    const attachment = attachmentById.get(id)
    if (attachment) items.push({ id, kind: 'attachment', label: attachment.name, attachment })
  }
  return items
}

function composerContentParts(): UserContentPart[] {
  const text = composerText()
  const parts: UserContentPart[] = []
  for (const item of composerItems()) {
    if (item.kind === 'text') {
      if (text) parts.push({ type: 'text', text })
      continue
    }
    if (!item.attachment) continue
    parts.push({
      type: 'image',
      file: { scope: 'save', path: item.attachment.path },
      mediaType: item.attachment.mediaType,
      filename: item.attachment.name
    })
  }
  return parts
}

function createAttachmentId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function imageExtension(mediaType: string, filename: string): string {
  if (mediaType === 'image/png') return 'png'
  if (mediaType === 'image/jpeg') return 'jpg'
  if (mediaType === 'image/webp') return 'webp'
  if (mediaType === 'image/gif') return 'gif'
  if (mediaType === 'image/avif') return 'avif'
  if (mediaType === 'image/apng') return 'apng'
  if (mediaType === 'image/svg+xml') return 'svg'
  const match = /\.([A-Za-z0-9]+)$/.exec(filename)
  return match?.[1]?.toLowerCase() || 'img'
}

async function uploadComposerAttachments(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length || session.value.status === 'generating') return
  const key = composerKey()
  const nextAttachments = [...composerAttachmentList()]
  const nextOrder = normalizedComposerOrder(key, composerText(), nextAttachments)

  for (const file of files) {
    const mediaType = file.type || ''
    if (!mediaType.startsWith('image/')) {
      showToast(`只支持图片附件：${file.name}`, 'error')
      continue
    }
    const id = createAttachmentId()
    const extension = imageExtension(mediaType, file.name)
    const path = `.huaian/uploads/${session.value.id}/${Date.now()}-${id}.${extension}`
    await window.electronAPI.writeAppStorageFileBytes('save', runtime.value.app.manifest.id, runtime.value.record.id, path, await file.arrayBuffer())
    nextAttachments.push({ id, name: file.name || `image.${extension}`, path, mediaType })
    nextOrder.push(id)
  }

  composerAttachments.value = { ...composerAttachments.value, [key]: nextAttachments }
  composerItemOrders.value = { ...composerItemOrders.value, [key]: nextOrder }
}

async function removeComposerAttachment(attachmentId: string) {
  const key = composerKey()
  const attachment = composerAttachmentList().find(item => item.id === attachmentId)
  composerAttachments.value = {
    ...composerAttachments.value,
    [key]: composerAttachmentList().filter(attachment => attachment.id !== attachmentId)
  }
  composerItemOrders.value = {
    ...composerItemOrders.value,
    [key]: (composerItemOrders.value[key] ?? []).filter(id => id !== attachmentId)
  }
  if (!attachment) return
  try {
    await window.electronAPI.deleteAppStoragePath('save', runtime.value.app.manifest.id, runtime.value.record.id, attachment.path)
  } catch (error) {
    showToast(errorText(error), 'error')
  }
}

function beginComposerItemDrag(event: DragEvent, itemId: string) {
  const key = composerKey()
  draggingComposerItem.value = { key, itemId }
  event.dataTransfer?.setData('text/plain', itemId)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function clearComposerItemDrag() {
  draggingComposerItem.value = null
}

function dropComposerItem(targetItemId: string) {
  const key = composerKey()
  const source = draggingComposerItem.value
  clearComposerItemDrag()
  if (!source || source.key !== key || source.itemId === targetItemId) return
  const ids = composerItems().map(item => item.id)
  const sourceIndex = ids.indexOf(source.itemId)
  const targetIndex = ids.indexOf(targetItemId)
  if (sourceIndex < 0 || targetIndex < 0) return
  ids.splice(sourceIndex, 1)
  ids.splice(targetIndex, 0, source.itemId)
  composerItemOrders.value = { ...composerItemOrders.value, [key]: ids }
}

function saveImageCacheKey(path: string): string {
  return `${runtime.value.key}:save:${path}`
}

async function loadSaveImageUrl(path: string, key: string) {
  if (loadingImageUrls.has(key)) return
  loadingImageUrls.add(key)
  try {
    const bytes = await window.electronAPI.readAppStorageFileBytes('save', runtime.value.app.manifest.id, runtime.value.record.id, path)
    const blob = new Blob([bytes])
    const url = URL.createObjectURL(blob)
    const previous = imageObjectUrls.value[key]
    if (previous) URL.revokeObjectURL(previous)
    imageObjectUrls.value = { ...imageObjectUrls.value, [key]: url }
  } catch (error) {
    showToast(errorText(error), 'error')
  } finally {
    loadingImageUrls.delete(key)
  }
}

function imageResourceUrl(part: Extract<AppChatContentPart, { type: 'image' }>): string {
  if (part.file.scope === 'app') return window.electronAPI.appAssetUrl(runtime.value.app.manifest.id, part.file.path)
  const key = saveImageCacheKey(part.file.path)
  const cached = imageObjectUrls.value[key]
  if (!cached) void loadSaveImageUrl(part.file.path, key)
  return cached ?? ''
}

function attachmentPreviewUrl(attachment: ComposerAttachment): string {
  return imageResourceUrl({
    type: 'image',
    file: { scope: 'save', path: attachment.path },
    mediaType: attachment.mediaType,
    filename: attachment.name
  })
}

function attachmentTitle(item: ComposerItem): string {
  return item.kind === 'text' ? '文本内容' : item.label
}

function canShowComposerItems(): boolean {
  return composerAttachmentList().length > 0
}

function canSendComposer(): boolean {
  return session.value.allowUserReply && session.value.status !== 'generating' && composerContentParts().length > 0
}

function llmSelectValue(): string {
  return availableLlmInstances.value.some(instance => instance.id === session.value.llmInstanceId)
    ? String(session.value.llmInstanceId)
    : ''
}

function handleLlmSelect(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (!value) return
  changeChatSessionLlmInstance(runtime.value, session.value.id, Number(value))
}

function partKey(message: AppChatMessage, part: AppChatContentPart, index: number): string {
  return part.type === 'tool_call' ? `${message.id}:tool:${part.toolCallId}` : `${message.id}:${part.type}:${index}`
}

function toolStatusLabel(status: Extract<AppChatContentPart, { type: 'tool_call' }>['status']): string {
  if (status === 'pending') return '等待中'
  if (status === 'error') return '失败'
  return '完成'
}

function reasoningContextLabel(part: Extract<AppChatContentPart, { type: 'reasoning' }>): string {
  return part.sendAsContext ? '作为上下文' : '不作为上下文'
}

function jsonPreview(value: unknown): string {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

async function sendComposer() {
  const key = composerKey()
  const contentParts = composerContentParts()
  if (!contentParts.length) return
  composerDrafts.value = { ...composerDrafts.value, [key]: '' }
  composerAttachments.value = { ...composerAttachments.value, [key]: [] }
  composerItemOrders.value = { ...composerItemOrders.value, [key]: [] }
  await sendUserMessage(runtime.value, session.value.id, 'composer', contentParts)
}

async function chooseOption(option: string) {
  await sendUserMessage(runtime.value, session.value.id, 'option', [{ type: 'text', text: option }])
}

watch(() => runtime.value.app.manifest.id, appId => {
  if (appId) void loadChatUiSettings(appId)
}, { immediate: true })

onBeforeUnmount(() => {
  stopChatPanelResize()
  for (const url of Object.values(imageObjectUrls.value)) URL.revokeObjectURL(url)
})
</script>

<template>
  <aside ref="chatPanelRef" class="chat-panel">
    <button class="chat-panel-resizer" type="button" aria-label="调整聊天窗口宽度"
      @pointerdown.prevent="startChatPanelResize"></button>
    <header class="chat-panel-header">
      <span class="chat-panel-title">
        <strong>{{ session.title }}</strong>
        <small>{{ session.status }}</small>
      </span>
      <div class="chat-panel-actions">
        <div class="chat-render-toggle" role="group" aria-label="聊天内容格式">
          <button type="button" :class="{ active: chatRenderMode() === 'raw' }" @click="setChatRenderMode('raw')">
            原始
          </button>
          <button type="button" :class="{ active: chatRenderMode() === 'markdown' }" @click="setChatRenderMode('markdown')">
            Markdown
          </button>
        </div>
        <button class="icon-button" type="button" aria-label="收起" data-tooltip="收起"
          @click="toggleChatPanel(runtime, session.id)">
          <MdClose aria-hidden="true" />
        </button>
      </div>
    </header>

    <div class="message-list">
      <article v-for="message in session.messages" :key="message.id" class="message-bubble"
        :class="[message.role, messageStatus(message)]">
        <header>
          <span>{{ roleLabel(message.role) }}</span>
          <small v-if="messageStatus(message) !== 'idle'">{{ messageStatus(message) }}</small>
        </header>
        <template v-for="(part, partIndex) in message.contentParts" :key="partKey(message, part, partIndex)">
          <MarkdownView v-if="part.type === 'text' && part.text && chatRenderMode() === 'markdown'"
            class="message-markdown" :markdown="part.text" />
          <pre v-else-if="part.type === 'text' && part.text" class="message-raw">{{ part.text }}</pre>
          <figure v-else-if="part.type === 'image'" class="message-image-part">
            <img v-if="imageResourceUrl(part)" :src="imageResourceUrl(part)"
              :alt="part.alt || part.filename || part.file.path" />
            <span v-else class="image-placeholder">
              <MdImage aria-hidden="true" />
            </span>
            <figcaption v-if="part.filename || part.alt">{{ part.alt || part.filename }}</figcaption>
          </figure>
          <details v-else-if="part.type === 'reasoning' && part.text" class="reasoning-part">
            <summary>
              <span>思考</span>
              <small :class="{ active: part.sendAsContext === true }">{{ reasoningContextLabel(part) }}</small>
            </summary>
            <MarkdownView v-if="chatRenderMode() === 'markdown'" class="message-markdown" :markdown="part.text" />
            <pre v-else class="message-raw">{{ part.text }}</pre>
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
        <em v-if="messageErrorText(message)">{{ messageErrorText(message) }}</em>
      </article>
    </div>

    <div v-if="session.options.length" class="option-list">
      <button v-for="option in session.options" :key="option" type="button" @click="chooseOption(option)">
        {{ option }}
      </button>
    </div>

    <footer class="chat-composer">
      <form class="composer-form" @submit.prevent="sendComposer">
        <textarea v-model="composerDrafts[composerKey()]" class="composer-input"
          rows="2" :placeholder="session.allowUserReply ? '输入消息...' : '当前对话不允许用户回复'"
          :disabled="!session.allowUserReply || session.status === 'generating'"
          @keydown.enter.exact.prevent="sendComposer" />

        <div v-if="canShowComposerItems()" class="composer-attachment-list">
          <div v-for="item in composerItems()" :key="item.id"
            class="composer-attachment-item" :class="[item.kind, { dragging: draggingComposerItem?.itemId === item.id }]"
            draggable="true" :title="attachmentTitle(item)"
            @dragstart="beginComposerItemDrag($event, item.id)"
            @dragover.prevent
            @drop.prevent="dropComposerItem(item.id)"
            @dragend="clearComposerItemDrag">
            <span v-if="item.kind === 'text'" class="text-attachment-icon">{{ item.label }}</span>
            <img v-else-if="item.attachment && attachmentPreviewUrl(item.attachment)"
              :src="attachmentPreviewUrl(item.attachment)" :alt="item.attachment.name" />
            <span v-else class="file-attachment-icon"><MdImage aria-hidden="true" /></span>
            <MdDragIndicator class="attachment-drag-icon" aria-hidden="true" />
            <button v-if="item.kind === 'attachment'" class="attachment-remove-button" type="button"
              aria-label="删除附件" data-tooltip="删除附件"
              @click.stop="removeComposerAttachment(item.id)">
              <MdClose aria-hidden="true" />
            </button>
          </div>
        </div>

        <div class="composer-controls">
          <div class="composer-left">
            <label class="composer-upload-button" aria-label="上传图片" data-tooltip="上传图片">
              <MdAddPhotoAlternate aria-hidden="true" />
              <input type="file" accept="image/*" multiple
                :disabled="!session.allowUserReply || session.status === 'generating'"
                @change="uploadComposerAttachments" />
            </label>
            <label class="model-pill llm-select-pill">
              <span class="model-pill-icon" aria-hidden="true">
                <MdSmartToy class="model-pill-symbol" />
              </span>
              <select class="llm-select" :value="llmSelectValue()"
                :disabled="session.status === 'generating' || !availableLlmInstances.length"
                aria-label="选择 LLM 实例" @change="handleLlmSelect">
                <option value="" disabled>未选择 LLM</option>
                <option v-for="instance in availableLlmInstances" :key="instance.id" :value="String(instance.id)">
                  {{ instance.name }}
                </option>
              </select>
            </label>
            <span class="model-pill tool-pill">
              <span class="model-pill-icon" aria-hidden="true">
                <MdCode class="model-pill-symbol" />
              </span>
              <span class="model-pill-label">工具 {{ session.tools.length }}</span>
            </span>
          </div>

          <div class="composer-right">
            <button v-if="session.status === 'generating'" class="composer-action-button stop"
              type="button" aria-label="停止" data-tooltip="停止"
              @click="stopChatReply(runtime, session.id)">
              <MdStop size="16" />
            </button>
            <button v-else class="composer-action-button" type="submit" :disabled="!canSendComposer()"
              aria-label="发送" data-tooltip="发送">
              <MdSend size="16" />
            </button>
          </div>
        </div>
      </form>
    </footer>
  </aside>
</template>

<style scoped>
.chat-panel {
  position: relative;
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

.chat-panel-resizer {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: 20;
  width: 14px;
  border: 0;
  background: transparent;
  padding: 0;
  cursor: col-resize;
  touch-action: none;
}

.chat-panel-resizer::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 2px;
  background: transparent;
  content: "";
  transition: background 120ms ease;
}

.chat-panel-resizer:hover::before,
.chat-panel-resizer:focus-visible::before,
:global(.resizing-chat-panel) .chat-panel-resizer::before {
  background: #2f6fca;
}

:global(.resizing-chat-panel),
:global(.resizing-chat-panel *) {
  cursor: col-resize !important;
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

.chat-panel-title {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.chat-panel-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.chat-render-toggle {
  height: 30px;
  display: inline-flex;
  align-items: center;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #eef2f7;
  padding: 2px;
}

.chat-render-toggle button {
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #526071;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 800;
}

.chat-render-toggle button.active {
  background: #ffffff;
  color: #174f99;
  box-shadow: 0 1px 3px rgba(34, 43, 56, 0.14);
}

.chat-render-toggle button:focus-visible {
  outline: 2px solid #446bd7;
  outline-offset: 1px;
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
  width: auto;
  min-width: min(240px, 100%);
  max-width: 100%;
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

.message-raw {
  min-width: 0;
  margin: 0;
  color: #202a38;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.message-image-part {
  min-width: 0;
  max-width: min(320px, 100%);
  display: grid;
  gap: 5px;
  margin: 0;
}

.message-image-part img,
.image-placeholder {
  width: 100%;
  max-height: 320px;
  border: 1px solid #d8e0ea;
  border-radius: 8px;
  background: #f3f6f9;
  object-fit: contain;
}

.image-placeholder {
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  color: #8a96a8;
}

.image-placeholder svg {
  width: 30px;
  height: 30px;
}

.message-image-part figcaption {
  min-width: 0;
  overflow: hidden;
  color: #6b7788;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  gap: 10px;
  color: #667286;
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
}

.reasoning-part summary small {
  flex: 0 0 auto;
  border: 1px solid #c9d2dc;
  border-radius: 999px;
  padding: 2px 7px;
  color: #6d7888;
  background: #ffffff;
  font-size: 11px;
  line-height: 1.2;
}

.reasoning-part summary small.active {
  border-color: #7fb39f;
  color: #245f51;
  background: #e6f5ee;
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
  grid-template-rows: minmax(70px, 1fr) auto auto;
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

.composer-attachment-list {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 4px;
}

.composer-attachment-item {
  position: relative;
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid #d4dde8;
  border-radius: 8px;
  background: #f8fafc;
  color: #344256;
  cursor: grab;
}

.composer-attachment-item.dragging {
  opacity: 0.5;
}

.composer-attachment-item:active {
  cursor: grabbing;
}

.composer-attachment-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.text-attachment-icon,
.file-attachment-icon {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  background: #edf4ff;
  color: #24579b;
  font-size: 17px;
  font-weight: 800;
}

.file-attachment-icon svg {
  width: 20px;
  height: 20px;
}

.attachment-drag-icon {
  position: absolute;
  left: 2px;
  bottom: 2px;
  width: 14px;
  height: 14px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.84);
  color: #667286;
}

.attachment-remove-button {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 17px;
  height: 17px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: rgba(30, 36, 46, 0.74);
  color: #ffffff;
  padding: 0;
}

.attachment-remove-button svg {
  width: 12px;
  height: 12px;
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

.composer-upload-button {
  position: relative;
  width: 28px;
  height: 28px;
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  background: #f0f2f5;
  color: #4b5a70;
  cursor: pointer;
}

.composer-upload-button:hover {
  background: #e4e8ee;
}

.composer-upload-button svg {
  width: 16px;
  height: 16px;
}

.composer-upload-button input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.composer-upload-button:has(input:disabled) {
  cursor: default;
  opacity: 0.45;
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

.llm-select-pill {
  width: min(220px, 100%);
  max-width: min(220px, 100%);
  padding-right: 6px;
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

.llm-select {
  min-width: 0;
  flex: 1;
  border: 0;
  background: transparent;
  color: #1f242b;
  font: inherit;
  outline: none;
}

.llm-select:disabled {
  cursor: default;
  opacity: 0.62;
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

.icon-button svg {
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

@media (max-width: 900px) {
  .chat-panel {
    min-width: 0;
  }

  .chat-panel-header {
    gap: 8px;
  }

  .chat-render-toggle button {
    padding: 0 6px;
  }
}
</style>
