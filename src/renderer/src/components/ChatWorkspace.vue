<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { MdDeleteOutline, MdPlayArrow, MdPostAdd } from 'vue-icons-plus/md'
import type {
  ChatBlock,
  ChatBlockCreatePayload,
  ChatGenerationRequest,
  ChatSession,
  LlmInstance
} from '../../../shared/types'
import ChatBlockRow from './ChatBlockRow.vue'
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
  saveChat: (chat: ChatSession) => Promise<void>
  saveChatBlock: (block: ChatBlock) => Promise<void>
  startChatGeneration: (payload: ChatGenerationRequest) => Promise<void>
  stopChatGeneration: (chatId: number) => Promise<void>
}>()

const listRef = ref<VirtualListExpose | null>(null)
const shouldFollow = ref(true)
const titleDraft = ref('')
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
        <input
          v-model="titleDraft"
          class="chat-title-input"
          aria-label="聊天名称"
          @blur="saveTitle"
          @keydown.enter.prevent="saveTitle"
        />
      </div>

      <div class="button-row">
        <button v-if="!hasSystemBlock" class="outline-button" type="button" :disabled="frozen" @click="addSystemBlock">添加系统提示词</button>
        <button class="toolbar-button" type="button" aria-label="删除聊天" data-tooltip="删除聊天" :disabled="frozen" @click="deleteChat">
          <MdDeleteOutline class="toolbar-icon" aria-hidden="true" />
        </button>
      </div>
    </header>

    <VirtualList
      ref="listRef"
      class="chat-block-list"
      :items="chatListItems"
      :item-key="chatListItemKey"
      :estimated-item-height="180"
      :buffer-size="6"
    >
      <template #item="{ item: chatItem }">
        <ChatBlockRow
          v-if="chatItem.type === 'block'"
          :ref="(element) => setBlockRowRef(chatItem.block.id, element)"
          :block="chatItem.block"
          :frozen="frozen"
          @save="saveChatBlock"
          @delete="removeBlock"
          @regenerate="regenerate"
          @stop="stopChatGeneration"
        />
        <div v-else class="chat-action-strip">
          <button
            class="md3-pill-button input-pill"
            type="button"
            :disabled="frozen"
            @click="addUserBlockForEditing"
          >
            <MdPostAdd class="button-icon" aria-hidden="true" />输入用户内容
          </button>

          <div class="md3-pill-combo">
            <button class="md3-pill-combo-trigger" type="button" :disabled="!canGenerateReply" @click="generateReply">
              <MdPlayArrow class="button-icon" aria-hidden="true" />使用
            </button>
            <select
              class="md3-pill-select"
              :value="chat.llmInstanceId ?? ''"
              :disabled="frozen"
              aria-label="LLM 实例"
              @change="selectLlmInstance"
            >
              <option value="">未选择 LLM 实例</option>
              <option v-for="instance in llmInstances" :key="instance.id" :value="instance.id">
                {{ instance.name }} · {{ instance.modelId }}
              </option>
            </select>
            <button class="md3-pill-combo-trigger trailing" type="button" :disabled="!canGenerateReply" @click="generateReply">
              生成回复
            </button>
          </div>
        </div>
      </template>
    </VirtualList>
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
</style>
