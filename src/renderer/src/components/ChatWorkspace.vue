<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { MdDeleteOutline, MdMoreVert, MdPostAdd, MdVisibility } from 'vue-icons-plus/md'
import type {
  ChatBlock,
  ChatBlockCreatePayload,
  ChatGenerationPreview,
  ChatGenerationRequest,
  ChatSession,
  LlmInstance
} from '../../../shared/types'
import ChatBlockRow from './ChatBlockRow.vue'
import JsonDialog from './JsonDialog.vue'
import VirtualList from './VirtualList.vue'

type ChatListItem =
  | { type: 'block'; block: ChatBlock }
  | { type: 'actions'; id: string }

interface VirtualListExpose {
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
  deleteChat: () => Promise<void>
  deleteChatBlock: (block: ChatBlock) => Promise<void>
  frozen: boolean
  llmInstances: LlmInstance[]
  previewChatGeneration: (payload: ChatGenerationRequest) => Promise<ChatGenerationPreview | null>
  saveChat: (chat: ChatSession) => Promise<void>
  saveChatBlock: (block: ChatBlock) => Promise<void>
  startChatGeneration: (payload: ChatGenerationRequest) => Promise<void>
  stopChatGeneration: (chatId: number) => Promise<void>
}>()

const listRef = ref<VirtualListExpose | null>(null)
const shouldFollow = ref(true)
const titleDraft = ref('')
const menuOpen = ref(false)
const menuButtonRef = ref<HTMLButtonElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})
const contextPreview = ref<ChatGenerationPreview | null>(null)
const blockRowRefs = new Map<number, ChatBlockRowExpose>()

const hasSystemBlock = computed(() => props.blocks.some(block => block.kind === 'system'))
const canGenerateReply = computed(() => Boolean(
  props.chat.llmInstanceId && !props.frozen
))
const chatListItems = computed<ChatListItem[]>(() => [
  ...props.blocks.map((block): ChatListItem => ({ type: 'block', block })),
  { type: 'actions', id: `chat-actions-${props.chat.id}` }
])

watch(() => props.chat.id, () => {
  titleDraft.value = props.chat.title
  blockRowRefs.clear()
  menuOpen.value = false
  contextPreview.value = null
  shouldFollow.value = true
  nextTick(() => listRef.value?.scrollToBottom())
}, { immediate: true })

watch(() => props.chat.title, (title) => {
  titleDraft.value = title
})

watch(() => props.blocks, () => {
  if (shouldFollow.value) {
    nextTick(() => listRef.value?.scrollToBottom())
  }
}, { deep: true })

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

onBeforeUnmount(() => {
  removeMenuListeners()
})

function chatListItemKey(item: ChatListItem) {
  return item.type === 'block' ? `block-${item.block.id}` : item.id
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
  const width = 220
  const gap = 6
  const margin = 8
  const height = menuRef.value?.offsetHeight ?? 48
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

async function saveTitle() {
  await props.saveChat({
    ...props.chat,
    title: titleDraft.value.trim() || '新聊天'
  })
}

async function selectLlmInstance(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  await props.saveChat({
    ...props.chat,
    llmInstanceId: value ? Number(value) : null
  })
}

async function addSystemBlock() {
  if (props.frozen) return
  beforeListMutation()
  await props.createChatBlock({
    chatId: props.chat.id,
    kind: 'system',
    targetRole: 'system',
    enabled: true,
    title: '系统提示词',
    summary: '',
    contentParts: [{ type: 'text', text: '' }],
    metadata: {}
  })
}

async function addUserBlockForEditing() {
  if (props.frozen) return
  beforeListMutation()
  const block = await props.createChatBlock({
    chatId: props.chat.id,
    kind: 'user',
    targetRole: 'user',
    enabled: true,
    title: '',
    summary: '',
    contentParts: [{ type: 'text', text: '' }],
    metadata: {}
  })
  if (!block) return
  await nextTick()
  listRef.value?.scrollToBottom()
  await nextTick()
  blockRowRefs.get(block.id)?.startEdit()
}

async function saveEditingBlocks() {
  const editedBlocks = Array.from(blockRowRefs.values())
    .map(row => row.commitEdit())
    .filter((block): block is ChatBlock => block !== null)

  for (const block of editedBlocks) {
    await props.saveChatBlock(block)
  }
}

async function showGenerationPreview() {
  if (props.frozen) return
  menuOpen.value = false
  await saveEditingBlocks()
  const preview = await props.previewChatGeneration({ chatId: props.chat.id })
  if (preview) contextPreview.value = preview
}

async function deleteCurrentChat() {
  if (props.frozen) return
  menuOpen.value = false
  await props.deleteChat()
}

async function generateReply() {
  if (!canGenerateReply.value) return
  beforeListMutation()
  await saveEditingBlocks()
  await props.startChatGeneration({ chatId: props.chat.id })
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
        <button v-if="!hasSystemBlock" class="outline-button" type="button" :disabled="frozen"
          @click="addSystemBlock">添加系统提示词</button>
        <button ref="menuButtonRef" class="toolbar-button" type="button" aria-label="更多操作" data-tooltip="更多操作"
          :disabled="frozen" @click.stop="toggleMenu">
          <MdMoreVert class="toolbar-icon" aria-hidden="true" />
        </button>
      </div>
    </header>

    <VirtualList ref="listRef" class="chat-block-list" :items="chatListItems" :item-key="chatListItemKey"
      :estimated-item-height="180" :buffer-size="6">
      <template #item="{ item: chatItem }">
        <ChatBlockRow v-if="chatItem.type === 'block'" :ref="(element) => setBlockRowRef(chatItem.block.id, element)"
          :block="chatItem.block" :frozen="frozen" @save="saveChatBlock" @delete="removeBlock" @regenerate="regenerate"
          @stop="stopChatGeneration" />
        <div v-else class="chat-action-strip">
          <button class="md3-pill-button input-pill" type="button" :disabled="frozen" @click="addUserBlockForEditing">
            <MdPostAdd class="button-icon" aria-hidden="true" />输入用户内容
          </button>

          <div class="md3-pill-combo">
            <select class="md3-pill-select" :value="chat.llmInstanceId ?? ''" :disabled="frozen" aria-label="LLM 实例"
              @change="selectLlmInstance">
              <option value="">未选择 LLM 实例</option>
              <option v-for="instance in llmInstances" :key="instance.id" :value="instance.id">
                {{ instance.name }}
              </option>
            </select>
            <button class="md3-pill-combo-trigger trailing" type="button" :disabled="!canGenerateReply"
              @click="generateReply">
              生成回复
            </button>
          </div>
        </div>
      </template>
    </VirtualList>

    <Teleport to="body">
      <div v-if="menuOpen" ref="menuRef" class="workspace-menu" :style="menuStyle" @click.stop>
        <button type="button" @click="showGenerationPreview">
          <MdVisibility class="menu-icon" aria-hidden="true" />查看将要发送的上下文
        </button>
        <button class="danger-menu-item" type="button" @click="deleteCurrentChat">
          <MdDeleteOutline class="menu-icon" aria-hidden="true" />删除聊天
        </button>
      </div>
    </Teleport>

    <JsonDialog
      v-if="contextPreview"
      title="将要发送的上下文"
      :value="contextPreview"
      @close="contextPreview = null"
    />
  </main>
</template>

<style scoped>
.chat-workspace {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
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
  overflow-y: auto;
}

.chat-action-strip {
  min-width: 0;
  min-height: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  border-bottom: 1px solid #edf0f4;
  background: #ffffff;
  padding: 14px;
}

.md3-pill-button,
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
  transition: background 140ms ease, opacity 140ms ease, box-shadow 140ms ease;
  white-space: nowrap;
}

.md3-pill-button {
  border-radius: 999px;
  padding: 0 18px 0 16px;
  box-shadow: inset 0 0 0 1px rgba(24, 86, 63, 0.1);
}

.input-pill {
  background: #e7f4ef;
  color: #0f513a;
}

.input-pill:hover:not(:disabled) {
  background: #dcefe7;
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
  background: transparent;
  color: inherit;
  padding: 0 14px 0 16px;
}

.md3-pill-combo-trigger.trailing {
  padding: 0 18px 0 14px;
}

.md3-pill-combo-trigger:hover:not(:disabled),
.md3-pill-select:hover:not(:disabled) {
  background: rgba(47, 111, 202, 0.08);
}

.md3-pill-button:disabled,
.md3-pill-combo-trigger:disabled {
  cursor: default;
  opacity: 0.5;
}

.md3-pill-button:focus-visible,
.md3-pill-combo-trigger:focus-visible,
.md3-pill-select:focus-visible {
  outline: 2px solid #446bd7;
  outline-offset: 2px;
}

.md3-pill-select {
  width: auto;
  min-width: 190px;
  max-width: 340px;
  height: 40px;
  border: 0;
  border-inline: 1px solid rgba(47, 111, 202, 0.14);
  border-radius: 0;
  background: transparent;
  color: #174f99;
  font-size: 13px;
  font-weight: 600;
  padding: 0 30px 0 12px;
}

.md3-pill-select:focus {
  border-color: rgba(47, 111, 202, 0.14);
  box-shadow: inset 0 0 0 2px rgba(47, 111, 202, 0.18);
}

.button-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  margin-right: 4px;
  vertical-align: -4px;
}

.workspace-menu {
  position: fixed;
  z-index: 120;
  display: grid;
  gap: 2px;
  border: 1px solid #d7dee8;
  border-radius: 8px;
  background: #ffffff;
  padding: 4px;
  box-shadow: 0 8px 24px rgba(32, 39, 49, 0.14);
}

.workspace-menu button {
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

.workspace-menu button:hover:not(:disabled) {
  background: #f1f5fa;
}

.danger-menu-item {
  color: #9d2c2c !important;
}

.menu-icon {
  width: 17px;
  height: 17px;
  flex-shrink: 0;
}
</style>
