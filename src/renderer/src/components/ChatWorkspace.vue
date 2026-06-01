<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  MdBook,
  MdCheck,
  MdClose,
  MdMoreVert,
  MdOpenInNew,
  MdSend,
  MdSmartToy,
  MdVisibility
} from 'vue-icons-plus/md'
import type {
  ChatBlock,
  ChatBlockCreatePayload,
  ChatGenerationPreviewMessage,
  ChatGenerationRequest,
  ChatRuntimeConfig,
  ChatSession,
  JsonRecord,
  LlmInstance,
  PluginDescriptor,
  PluginToolCallManifest
} from '../../../shared/types'
import ChatBlockRow from './ChatBlockRow.vue'
import ChatVirtualList from './ChatVirtualList.vue'
import PluginFrame from './PluginFrame.vue'

type ChatListItem =
  { block: ChatBlock; sourceBlock: ChatBlock | null }

interface ChatVirtualListExpose {
  isNearBottom: (threshold?: number) => boolean
  scrollToBottom: () => void
}

interface ChatBlockRowExpose {
  commitEdit: () => ChatBlock | null
  startEdit: () => void
}

const props = defineProps<{
  blocks: ChatBlock[]
  chat: ChatSession
  createChatBlock: (payload: ChatBlockCreatePayload) => Promise<ChatBlock | null>
  deleteChatBlock: (block: ChatBlock) => Promise<void>
  frozen: boolean
  llmInstances: LlmInstance[]
  plugins: PluginDescriptor[]
  prepareChatDisplayBlocks: (chat: ChatSession, blocks: ChatBlock[]) => Promise<ChatBlock[]>
  previewChatGeneration: (payload: ChatGenerationRequest) => Promise<ChatGenerationPreviewMessage[] | null>
  saveChat: (chat: ChatSession) => Promise<void>
  saveChatBlock: (block: ChatBlock) => Promise<void>
  startChatGeneration: (payload: ChatGenerationRequest) => Promise<void>
  stopChatGeneration: (chatId: number) => Promise<void>
}>()

const listRef = ref<ChatVirtualListExpose | null>(null)
const shouldFollow = ref(true)
const titleDraft = ref('')
const userInputDraft = ref('')
const sendingUserMessage = ref(false)
const menuOpen = ref(false)
const menuButtonRef = ref<HTMLButtonElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})
const replyPanelOpen = ref(false)
const replyButtonRef = ref<HTMLButtonElement | null>(null)
const replyPanelRef = ref<HTMLElement | null>(null)
const replyPanelStyle = ref<Record<string, string>>({})
const composerTextareaRef = ref<HTMLTextAreaElement | null>(null)
const chatHtmlPlugin = ref<PluginDescriptor | null>(null)
const contextPreviewMessages = ref<ChatGenerationPreviewMessage[] | null>(null)
const collapsedBlockState = ref<Record<string, boolean>>({})
const displayBlocks = ref<ChatBlock[]>([])
const pluginDataRevision = ref(0)
const blockRowRefs = new Map<number, ChatBlockRowExpose>()
let displayRefreshVersion = 0

const canGenerateReply = computed(() => Boolean(
  props.chat.runtimeConfig.llmInstanceId && !props.frozen
))
const canSendUserMessage = computed(() => (
  userInputDraft.value.trim().length > 0 && !props.frozen && !sendingUserMessage.value
))
const selectedLlmInstance = computed(() => {
  const id = props.chat.runtimeConfig.llmInstanceId
  return id === null || id === undefined ? null : props.llmInstances.find(instance => instance.id === id) ?? null
})
const activePluginIds = computed(() => new Set(props.chat.runtimeConfig.enabledPluginIds))
const activePlugins = computed(() => props.plugins.filter(plugin => activePluginIds.value.has(plugin.manifest.id)))
const availableToolCalls = computed(() => activePlugins.value.flatMap(plugin => (
  plugin.manifest.entry?.toolCalls?.map(toolCall => ({ plugin, toolCall })) ?? []
)))
const replyButtonLabel = computed(() => selectedLlmInstance.value?.name ?? '未选择 LLM')
const previewMessagesJson = computed(() => formatJson(contextPreviewMessages.value ?? []))
const sourceBlockById = computed(() => new Map(props.blocks.map(block => [block.id, block])))
const displaySignature = computed(() => JSON.stringify({
  chatId: props.chat.id,
  runtimeConfig: props.chat.runtimeConfig,
  pluginDataRevision: pluginDataRevision.value,
  plugins: props.plugins.map(plugin => ({
    id: plugin.manifest.id,
    versionCode: plugin.manifest.versionCode,
    entry: plugin.manifest.entry
  })),
  blocks: props.blocks.map(block => ({
    id: block.id,
    kind: block.kind,
    enabled: block.enabled,
    status: block.status,
    orderIndex: block.orderIndex,
    contentParts: block.contentParts,
    metadata: block.metadata,
    errorText: block.errorText,
    updatedAt: block.updatedAt
  }))
}))
const blockAutoFollowSignature = computed(() => displayBlocks.value.map(block => JSON.stringify({
  id: block.id,
  kind: block.kind,
  enabled: block.enabled,
  status: block.status,
  metadata: { ...block.metadata, uiCollapsed: undefined },
  contentParts: block.contentParts,
  errorText: block.errorText
})).join('\u001f'))
const chatListItems = computed<ChatListItem[]>(() => [
  ...displayBlocks.value.map((block): ChatListItem => ({
    block,
    sourceBlock: block.metadata.virtual === true ? null : sourceBlockById.value.get(block.id) ?? block
  }))
])

watch(() => props.chat.id, () => {
  titleDraft.value = props.chat.title
  userInputDraft.value = ''
  blockRowRefs.clear()
  menuOpen.value = false
  replyPanelOpen.value = false
  chatHtmlPlugin.value = null
  contextPreviewMessages.value = null
  shouldFollow.value = true
  nextTick(() => listRef.value?.scrollToBottom())
}, { immediate: true })

watch(() => props.chat.title, (title) => {
  titleDraft.value = title
})

watch(blockAutoFollowSignature, () => {
  if (shouldFollow.value) {
    nextTick(() => listRef.value?.scrollToBottom())
  }
})

watch(displaySignature, () => {
  void refreshDisplayBlocks()
}, { immediate: true })

watch(menuOpen, (open) => {
  if (open) {
    window.addEventListener('click', closeMenu)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    nextTick(updateMenuPosition)
    return
  }

  removeMenuListeners()
})

watch(replyPanelOpen, (open) => {
  if (open) {
    window.addEventListener('click', closeReplyPanel)
    window.addEventListener('resize', closeReplyPanel)
    window.addEventListener('scroll', closeReplyPanel, true)
    nextTick(updateReplyPanelPosition)
    return
  }

  removeReplyPanelListeners()
})

onBeforeUnmount(() => {
  removeMenuListeners()
  removeReplyPanelListeners()
  window.removeEventListener('st-forge-plugin-data-changed', handlePluginDataChanged)
})

function chatListItemKey(item: ChatListItem) {
  return blockStateKey(item.block)
}

function blockStateKey(block: ChatBlock): string {
  if (block.metadata.virtual !== true) return `block:${block.id}`
  return `virtual:${props.chat.id}:${block.id}:${JSON.stringify(block.metadata)}`
}

function defaultBlockCollapsed(block: ChatBlock): boolean {
  if (typeof block.metadata.uiCollapsed === 'boolean') return block.metadata.uiCollapsed
  return block.kind === 'injection'
}

function isBlockCollapsed(block: ChatBlock): boolean {
  return collapsedBlockState.value[blockStateKey(block)] ?? defaultBlockCollapsed(block)
}

async function setBlockCollapsed(block: ChatBlock, sourceBlock: ChatBlock | null, collapsed: boolean) {
  const key = blockStateKey(block)
  collapsedBlockState.value = {
    ...collapsedBlockState.value,
    [key]: collapsed
  }
  if (!sourceBlock || sourceBlock.metadata.uiCollapsed === collapsed) return
  await props.saveChatBlock({
    ...sourceBlock,
    metadata: {
      ...sourceBlock.metadata,
      uiCollapsed: collapsed
    }
  })
}

function isChatBlockRowExpose(element: unknown): element is ChatBlockRowExpose {
  return Boolean(
    element &&
    typeof (element as ChatBlockRowExpose).commitEdit === 'function' &&
    typeof (element as ChatBlockRowExpose).startEdit === 'function'
  )
}

function setBlockRowRef(blockId: number, element: unknown) {
  if (isChatBlockRowExpose(element)) {
    blockRowRefs.set(blockId, element)
    return
  }

  blockRowRefs.delete(blockId)
}

function handlePluginDataChanged() {
  pluginDataRevision.value += 1
}

async function refreshDisplayBlocks() {
  const version = ++displayRefreshVersion
  const blocks = await props.prepareChatDisplayBlocks(props.chat, props.blocks)
  if (version !== displayRefreshVersion) return
  displayBlocks.value = blocks
}

onMounted(() => {
  window.addEventListener('st-forge-plugin-data-changed', handlePluginDataChanged)
})

function beforeListMutation() {
  shouldFollow.value = listRef.value?.isNearBottom(100) ?? true
}

function removeMenuListeners() {
  window.removeEventListener('click', closeMenu)
  window.removeEventListener('resize', closeMenu)
  window.removeEventListener('scroll', closeMenu, true)
}

function closeMenu() {
  menuOpen.value = false
}

function toggleMenu() {
  menuOpen.value = !menuOpen.value
  if (menuOpen.value) {
    nextTick(updateMenuPosition)
  }
}

function updateMenuPosition() {
  const button = menuButtonRef.value
  if (!button) return

  const rect = button.getBoundingClientRect()
  const width = 360
  const gap = 6
  const margin = 8
  const height = menuRef.value?.offsetHeight ?? 260
  const left = Math.min(
    window.innerWidth - width - margin,
    Math.max(margin, rect.right - width)
  )
  const preferredTop = rect.bottom + gap
  const top = preferredTop + height > window.innerHeight - margin
    ? Math.max(margin, rect.top - height - gap)
    : preferredTop

  menuStyle.value = {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`
  }
}

function removeReplyPanelListeners() {
  window.removeEventListener('click', closeReplyPanel)
  window.removeEventListener('resize', closeReplyPanel)
  window.removeEventListener('scroll', closeReplyPanel, true)
}

function closeReplyPanel() {
  replyPanelOpen.value = false
}

function toggleReplyPanel() {
  replyPanelOpen.value = !replyPanelOpen.value
  if (replyPanelOpen.value) {
    nextTick(updateReplyPanelPosition)
  }
}

function updateReplyPanelPosition() {
  const button = replyButtonRef.value
  if (!button) return

  const rect = button.getBoundingClientRect()
  const gap = 8
  const margin = 8
  const width = Math.min(420, window.innerWidth - margin * 2)
  const height = replyPanelRef.value?.offsetHeight ?? 360
  const left = Math.min(
    window.innerWidth - width - margin,
    Math.max(margin, rect.left)
  )
  const preferredTop = rect.top - height - gap
  const top = preferredTop < margin
    ? Math.min(window.innerHeight - height - margin, rect.bottom + gap)
    : preferredTop

  replyPanelStyle.value = {
    left: `${left}px`,
    top: `${Math.max(margin, top)}px`,
    width: `${width}px`
  }
}

function recordFromJson(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? 'undefined'
}

function runtimeConfigWith(patch: Partial<ChatRuntimeConfig>): ChatRuntimeConfig {
  return {
    llmInstanceId: patch.llmInstanceId === undefined ? props.chat.runtimeConfig.llmInstanceId : patch.llmInstanceId,
    enabledPluginIds: patch.enabledPluginIds === undefined
      ? [...props.chat.runtimeConfig.enabledPluginIds]
      : [...patch.enabledPluginIds],
    pluginData: patch.pluginData === undefined
      ? recordFromJson(props.chat.runtimeConfig.pluginData)
      : recordFromJson(patch.pluginData)
  }
}

async function saveRuntimeConfig(config: ChatRuntimeConfig) {
  await props.saveChat({
    ...props.chat,
    runtimeConfig: config
  })
}

async function toggleChatPlugin(pluginId: string) {
  const current = new Set(props.chat.runtimeConfig.enabledPluginIds)
  if (current.has(pluginId)) current.delete(pluginId)
  else current.add(pluginId)
  await saveRuntimeConfig(runtimeConfigWith({ enabledPluginIds: [...current] }))
}

function pluginChatHtmlPath(plugin: PluginDescriptor): string {
  return plugin.manifest.entry?.chatHtml ?? ''
}

function openPluginChatHtml(plugin: PluginDescriptor) {
  if (!pluginChatHtmlPath(plugin) || !activePluginIds.value.has(plugin.manifest.id)) return
  menuOpen.value = false
  chatHtmlPlugin.value = plugin
}

function closePluginChatHtml() {
  chatHtmlPlugin.value = null
}

function handlePluginChatUpdated() {
  pluginDataRevision.value += 1
}

async function selectReplyLlmInstance(llmInstanceId: number | null) {
  await saveRuntimeConfig(runtimeConfigWith({ llmInstanceId }))
}

async function saveTitle() {
  await props.saveChat({
    ...props.chat,
    title: titleDraft.value.trim() || '新聊天'
  })
}

function toolDefinitionPrompt(toolCall: PluginToolCallManifest): string {
  return toolCall.prompt?.trim() || `你可以使用 ${toolCall.label || toolCall.name}。`
}

async function insertToolDefinitionBlock(relativeBlock: ChatBlock, placement: 'before' | 'after') {
  if (props.frozen) return
  const selected = availableToolCalls.value[0]
  if (!selected) {
    window.alert('当前聊天没有启用可插入的工具调用插件。')
    return
  }
  beforeListMutation()
  await saveEditingBlocks()
  await props.createChatBlock({
    chatId: props.chat.id,
    kind: 'tool_definition',
    enabled: true,
    contentParts: [{ type: 'text', text: toolDefinitionPrompt(selected.toolCall) }],
    metadata: {
      toolDefinition: {
        pluginId: selected.plugin.manifest.id,
        toolCallName: selected.toolCall.name,
        label: selected.toolCall.label || selected.toolCall.name,
        commonArgs: {}
      }
    },
    insertRelativeBlockId: relativeBlock.id,
    insertPlacement: placement
  })
}

async function saveEditingBlocks() {
  const editedBlocks = Array.from(blockRowRefs.values())
    .map(row => row.commitEdit())
    .filter((block): block is ChatBlock => block !== null)

  for (const block of editedBlocks) {
    if (isEmptyChatBlock(block)) {
      await props.deleteChatBlock(block)
    } else {
      await props.saveChatBlock(block)
    }
  }
}

function isEmptyChatBlock(block: ChatBlock): boolean {
  return block.contentParts.every(part => {
    if (part.type === 'tool_call') return false
    return part.text.trim().length === 0
  })
}

async function showGenerationPreview() {
  if (props.frozen) return
  menuOpen.value = false
  await saveEditingBlocks()
  const messages = await props.previewChatGeneration({ chatId: props.chat.id })
  if (messages) contextPreviewMessages.value = messages
}

async function generateReply() {
  if (!canGenerateReply.value) return
  replyPanelOpen.value = false
  beforeListMutation()
  await saveEditingBlocks()
  await props.startChatGeneration({ chatId: props.chat.id })
}

async function sendUserMessage() {
  if (!canSendUserMessage.value) return
  const text = userInputDraft.value.trim()
  if (!text) return

  sendingUserMessage.value = true
  try {
    replyPanelOpen.value = false
    shouldFollow.value = true
    await saveEditingBlocks()

    const block = await props.createChatBlock({
      chatId: props.chat.id,
      kind: 'user',
      enabled: true,
      contentParts: [{ type: 'text', text }],
      metadata: {}
    })

    if (!block) return

    userInputDraft.value = ''
    await nextTick()
    listRef.value?.scrollToBottom()

    if (props.chat.runtimeConfig.llmInstanceId) {
      await props.startChatGeneration({ chatId: props.chat.id })
    }
  } finally {
    sendingUserMessage.value = false
  }
}

function handleComposerEnter(event: KeyboardEvent) {
  if (event.isComposing) return
  event.preventDefault()
  void sendUserMessage()
}

async function regenerate(block: ChatBlock) {
  if (props.frozen) return
  beforeListMutation()
  await saveEditingBlocks()
  await props.startChatGeneration({ chatId: props.chat.id, regenerateBlockId: block.id })
}

async function removeBlock(block: ChatBlock) {
  if (props.frozen || !window.confirm('删除这个聊天块？')) return
  beforeListMutation()
  await props.deleteChatBlock(block)
}
</script>

<template>
  <main class="chat-workspace">
    <header class="chat-header">
      <div class="chat-title-area">
        <input v-model="titleDraft" class="chat-title-input" aria-label="聊天名称" @blur="saveTitle"
          @keydown.enter.prevent="saveTitle" />
      </div>

      <div class="button-row">
        <button ref="menuButtonRef" class="toolbar-button" type="button" aria-label="更多操作" data-tooltip="更多操作"
          :disabled="frozen" @click.stop="toggleMenu">
          <MdMoreVert class="toolbar-icon" aria-hidden="true" />
        </button>
      </div>
    </header>

    <ChatVirtualList ref="listRef" class="chat-block-list" :items="chatListItems" :item-key="chatListItemKey"
      :estimated-item-height="180" :buffer-size="6">
      <template #item="{ item: chatItem }">
        <ChatBlockRow :ref="(element) => setBlockRowRef(chatItem.block.id, element)"
          :block="chatItem.block" :collapsed="isBlockCollapsed(chatItem.block)" :frozen="frozen"
          :plugins="plugins"
          :source-block="chatItem.sourceBlock || undefined"
          :preview-chat-generation="previewChatGeneration"
          @collapse-change="setBlockCollapsed(chatItem.block, chatItem.sourceBlock, $event)" @save="saveChatBlock" @delete="removeBlock"
          @regenerate="regenerate" @stop="stopChatGeneration" @insert-tool-definition="insertToolDefinitionBlock" />
      </template>
    </ChatVirtualList>

    <footer class="chat-composer">
      <form class="composer-form" @submit.prevent="sendUserMessage">
        <textarea
          ref="composerTextareaRef"
          v-model="userInputDraft"
          class="composer-input"
          rows="2"
          placeholder="输入用户内容"
          :disabled="frozen || sendingUserMessage"
          @keydown.enter.exact="handleComposerEnter"
        />

        <div class="composer-controls">
          <div class="composer-left">
            <div class="md3-pill-combo composer-llm-combo">
              <button ref="replyButtonRef" class="md3-pill-combo-trigger config-trigger" type="button" :disabled="frozen"
                @click.stop="toggleReplyPanel">
                <MdSmartToy class="button-icon" aria-hidden="true" /><span class="button-label">{{ replyButtonLabel }}</span>
              </button>
              <button class="md3-pill-combo-trigger trailing" type="button" :disabled="!canGenerateReply"
                @click="generateReply">
                生成回复
              </button>
            </div>
          </div>

          <div class="composer-right">
            <button class="send-button" type="submit" :disabled="!canSendUserMessage" aria-label="发送" data-tooltip="发送">
              <MdSend class="send-icon" aria-hidden="true" />
            </button>
          </div>
        </div>
      </form>
    </footer>

    <Teleport to="body">
      <div v-if="menuOpen" ref="menuRef" class="workspace-menu" :style="menuStyle" @click.stop>
        <section class="popup-section">
          <div class="popup-section-title">
            <MdBook class="menu-icon" aria-hidden="true" />插件
          </div>
          <div
            v-for="plugin in plugins"
            :key="plugin.manifest.id"
            class="setting-row"
            :class="{ selected: activePluginIds.has(plugin.manifest.id) }"
          >
            <button
              class="setting-row-main"
              type="button"
              :aria-pressed="activePluginIds.has(plugin.manifest.id)"
              @click="toggleChatPlugin(plugin.manifest.id)"
            >
              <span class="setting-row-text">{{ plugin.manifest.name || plugin.manifest.id }}</span>
              <span class="setting-check" aria-hidden="true">
                <MdCheck v-if="activePluginIds.has(plugin.manifest.id)" class="setting-check-icon" />
              </span>
            </button>
            <button
              v-if="activePluginIds.has(plugin.manifest.id) && pluginChatHtmlPath(plugin)"
              class="setting-row-action"
              type="button"
              aria-label="打开插件页面"
              data-tooltip="打开插件页面"
              @click.stop="openPluginChatHtml(plugin)"
            >
              <MdOpenInNew class="setting-row-action-icon" aria-hidden="true" />
            </button>
          </div>
        </section>

        <section class="popup-section">
          <button type="button" @click="showGenerationPreview">
            <MdVisibility class="menu-icon" aria-hidden="true" />查看将要发送的上下文
          </button>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="replyPanelOpen" ref="replyPanelRef" class="reply-panel" :style="replyPanelStyle" @click.stop>
        <section class="popup-section">
          <div class="popup-section-title">
            <MdBook class="menu-icon" aria-hidden="true" />LLM 实例
          </div>
          <button class="choice-row" type="button" :class="{ selected: chat.runtimeConfig.llmInstanceId === null }"
            @click="selectReplyLlmInstance(null)">
            <span>未选择 LLM</span>
          </button>
          <button v-for="instance in llmInstances" :key="instance.id" class="choice-row" type="button"
            :class="{ selected: chat.runtimeConfig.llmInstanceId === instance.id }"
            @click="selectReplyLlmInstance(instance.id)">
            <span>{{ instance.name }}</span>
          </button>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="chatHtmlPlugin" class="plugin-chat-dialog" role="dialog" aria-modal="true" @click.self="closePluginChatHtml">
        <section class="plugin-chat-panel">
          <header class="plugin-chat-header">
            <div>
              <h2>{{ chatHtmlPlugin.manifest.name || chatHtmlPlugin.manifest.id }}</h2>
              <p>{{ chatHtmlPlugin.manifest.description }}</p>
            </div>
            <button class="toolbar-button" type="button" aria-label="关闭" data-tooltip="关闭" @click="closePluginChatHtml">
              <MdClose class="toolbar-icon" aria-hidden="true" />
            </button>
          </header>
          <div class="plugin-chat-body">
            <PluginFrame
              :chat="chat"
              :html-path="pluginChatHtmlPath(chatHtmlPlugin)"
              :plugin-id="chatHtmlPlugin.manifest.id"
              @update:chat="handlePluginChatUpdated"
            />
          </div>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="contextPreviewMessages" class="preview-dialog" role="dialog" aria-modal="true"
        @click.self="contextPreviewMessages = null">
        <section class="preview-panel">
          <header class="preview-header">
            <div>
              <h2>将要发送的上下文</h2>
              <p>{{ contextPreviewMessages.length }} 条最终 messages</p>
            </div>
            <button class="toolbar-button" type="button" aria-label="关闭" data-tooltip="关闭"
              @click="contextPreviewMessages = null">
              <MdClose class="toolbar-icon" aria-hidden="true" />
            </button>
          </header>

          <div class="preview-body">
            <section class="preview-section">
              <pre class="json-preview">{{ previewMessagesJson }}</pre>
            </section>
          </div>
        </section>
      </div>
    </Teleport>
  </main>
</template>

<style scoped>
.chat-workspace {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  height: 100%;
  overflow: hidden;
}

.chat-header {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid #edf0f4;
  padding: 6px 12px;
}

.chat-title-area {
  min-width: 0;
  width: min(360px, 100%);
}

.chat-title-input {
  font-weight: 600;
}

.chat-block-list {
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: hidden;
}

.chat-composer {
  min-width: 0;
  border-top: 1px solid #dfe6ef;
  background: #ffffff;
  padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px));
}

.composer-form {
  min-width: 0;
  display: grid;
  gap: 8px;
}

.composer-input {
  width: 100%;
  min-width: 0;
  min-height: 54px;
  max-height: 136px;
  resize: none;
  overflow: auto;
  border: 1px solid #cfd8e4;
  border-radius: 8px;
  background: #fbfcfd;
  color: #263242;
  padding: 10px 12px;
  line-height: 1.45;
}

.composer-input:focus {
  outline: 2px solid #9fc1f6;
  outline-offset: 0;
  border-color: #6d9de3;
  background: #ffffff;
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
  gap: 10px;
}

.composer-left,
.composer-right {
  min-width: 0;
  display: flex;
  align-items: center;
}

.composer-left {
  justify-content: flex-start;
}

.composer-right {
  justify-content: flex-end;
}

.composer-llm-combo {
  max-width: min(560px, 100%);
}

.composer-llm-combo .config-trigger {
  flex: 1 1 auto;
}

.md3-pill-combo-trigger {
  min-width: 0;
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  font-size: 14px;
  font-weight: 600;
  padding: 0;
  white-space: nowrap;
}

.md3-pill-combo {
  min-width: 0;
  min-height: 40px;
  display: inline-flex;
  align-items: stretch;
  overflow: hidden;
  border-radius: 999px;
  background: #eef5ff;
  color: #174f99;
  box-shadow: inset 0 0 0 1px rgba(47, 111, 202, 0.12);
}

.md3-pill-combo-trigger {
  min-width: 0;
  background: transparent;
  color: inherit;
  padding: 0 14px 0 16px;
}

.config-trigger {
  max-width: min(420px, 48vw);
  gap: 4px;
  overflow: hidden;
  border-right: 1px solid rgba(47, 111, 202, 0.14);
  text-overflow: ellipsis;
}

.md3-pill-combo-trigger.trailing {
  padding: 0 18px 0 14px;
}

.md3-pill-combo-trigger:hover:not(:disabled) {
  background: rgba(47, 111, 202, 0.08);
}

.md3-pill-combo-trigger:disabled {
  cursor: default;
  opacity: 0.5;
}

.button-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  margin-right: 4px;
  vertical-align: -4px;
}

.button-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.send-button {
  position: relative;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: #216f54;
  color: #ffffff;
  padding: 0;
  transition: background 140ms ease, opacity 140ms ease;
}

.send-button:hover:not(:disabled) {
  background: #185b45;
}

.send-button:disabled {
  cursor: default;
  opacity: 0.45;
}

.send-button::after {
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

.send-button:hover::after,
.send-button:focus-visible::after {
  opacity: 1;
  transform: translateY(0);
}

.send-button:focus-visible {
  outline: 2px solid #446bd7;
  outline-offset: 2px;
}

.send-icon {
  width: 20px;
  height: 20px;
}

.workspace-menu,
.reply-panel {
  position: fixed;
  z-index: 120;
  display: grid;
  gap: 8px;
  max-height: min(620px, calc(100vh - 16px));
  overflow: auto;
  border: 1px solid #d7dee8;
  border-radius: 8px;
  background: #ffffff;
  padding: 8px;
  box-shadow: 0 8px 24px rgba(32, 39, 49, 0.14);
}

.workspace-menu button,
.reply-panel button {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #303a49;
  padding: 8px;
  text-align: left;
  font-size: 12px;
}

.workspace-menu button:hover:not(:disabled),
.reply-panel button:hover:not(:disabled) {
  background: #f1f5fa;
}

.popup-section {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.popup-section+.popup-section {
  border-top: 1px solid #edf0f4;
  padding-top: 8px;
}

.popup-section-title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  color: #66758a;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 4px;
  text-transform: uppercase;
}

.setting-row,
.choice-row {
  justify-content: space-between;
}

.setting-row {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 2px;
  border-radius: 6px;
}

.setting-row-main {
  width: 100%;
  justify-content: space-between;
}

.setting-row-action {
  width: 32px;
  height: 32px;
  justify-content: center;
  padding: 0;
}

.setting-row-action-icon {
  width: 16px;
  height: 16px;
}

.setting-row.selected,
.choice-row.selected {
  background: #edf5ff;
  color: #174f99;
}

.setting-row-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.setting-check {
  width: 18px;
  height: 18px;
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  color: #2f6fca;
}

.setting-check-icon,
.menu-icon {
  width: 17px;
  height: 17px;
  flex-shrink: 0;
}

.plugin-chat-dialog {
  position: fixed;
  inset: 0;
  z-index: 150;
  display: grid;
  place-items: center;
  background: rgba(25, 31, 39, 0.34);
  padding: 24px;
}

.plugin-chat-panel {
  width: min(720px, 94vw);
  height: min(680px, 86vh);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 18px 50px rgba(26, 33, 42, 0.26);
}

.plugin-chat-header {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid #edf0f4;
  padding: 12px 14px;
}

.plugin-chat-header h2 {
  margin: 0;
  color: #253041;
  font-size: 15px;
}

.plugin-chat-header p {
  margin: 3px 0 0;
  color: #66758a;
  font-size: 12px;
}

.plugin-chat-body {
  min-width: 0;
  min-height: 0;
}

.preview-dialog {
  position: fixed;
  inset: 0;
  z-index: 160;
  display: grid;
  place-items: center;
  background: rgba(25, 31, 39, 0.34);
  padding: 24px;
}

.preview-panel {
  width: min(1040px, 94vw);
  max-height: min(820px, 88vh);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 18px 50px rgba(26, 33, 42, 0.26);
}

.preview-header {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid #edf0f4;
  padding: 10px 12px;
}

.preview-header h2 {
  margin: 0;
  color: #253044;
  font-size: 16px;
}

.preview-header p {
  margin: 3px 0 0;
  color: #6a7687;
  font-size: 12px;
}

.preview-body {
  min-width: 0;
  overflow: auto;
  display: grid;
  background: #fbfcfd;
  padding: 14px;
}

.preview-section {
  min-width: 0;
  display: grid;
}

.json-preview {
  min-width: 0;
  overflow: auto;
  margin: 0;
  border: 1px solid #edf0f4;
  border-radius: 6px;
  background: #f7f9fb;
  color: #273245;
  padding: 9px 10px;
  font: 12px/1.55 "SF Mono", "Cascadia Code", "Roboto Mono", ui-monospace, Menlo, Monaco, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 760px) {
  .chat-composer {
    padding: 8px 10px calc(8px + env(safe-area-inset-bottom, 0px));
  }

  .composer-controls {
    grid-template-columns: minmax(0, 1fr);
  }

  .composer-llm-combo {
    width: 100%;
  }

  .config-trigger {
    max-width: none;
  }
}
</style>
