<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { MdAdd, MdDeleteOutline, MdPlayArrow, MdPostAdd } from 'vue-icons-plus/md'
import type { ChatBlock, ChatSession } from '../../../shared/types'
import { useProjectWorkbench } from '../composables/useProjectWorkbench'
import ChatBlockRow from './ChatBlockRow.vue'
import VirtualList from './VirtualList.vue'

interface VirtualListExpose {
  isNearBottom: (threshold?: number) => boolean
  scrollToBottom: () => void
}

const {
  chats,
  createChat,
  createChatBlock,
  deleteChatBlock,
  deleteSelectedChat,
  generatingChatIds,
  isSelectedChatGenerating,
  llmInstances,
  saveChat,
  saveChatBlock,
  selectChat,
  selectedChat,
  selectedChatBlocks,
  startChatGeneration,
  stopChatGeneration
} = useProjectWorkbench()

const listRef = ref<VirtualListExpose | null>(null)
const composerText = ref('')
const shouldFollow = ref(true)
const titleDraft = ref('')

const hasSystemBlock = computed(() => selectedChatBlocks.value.some(block => block.kind === 'system'))
const hasSendableBlocks = computed(() => selectedChatBlocks.value.some(block => (
  block.enabled && block.contentParts.some(part => (
    part.type === 'text'
      ? part.text.trim()
      : block.kind === 'assistant' && block.metadata.sendReasoning === true && part.text.trim()
  ))
)))
const selectedChatFrozen = computed(() => isSelectedChatGenerating.value)

watch(() => selectedChat.value?.id, () => {
  titleDraft.value = selectedChat.value?.title ?? ''
  shouldFollow.value = true
  nextTick(() => listRef.value?.scrollToBottom())
}, { immediate: true })

watch(() => selectedChat.value?.title, (title) => {
  titleDraft.value = title ?? ''
})

watch(selectedChatBlocks, () => {
  if (shouldFollow.value) {
    nextTick(() => listRef.value?.scrollToBottom())
  }
}, { deep: true })

function chatKey(chat: ChatSession) {
  return chat.id
}

function blockKey(block: ChatBlock) {
  return block.id
}

function beforeListMutation() {
  shouldFollow.value = listRef.value?.isNearBottom(100) ?? true
}

async function saveTitle() {
  if (!selectedChat.value) return
  selectedChat.value.title = titleDraft.value.trim() || '新聊天'
  await saveChat(selectedChat.value)
}

async function selectLlmInstance(event: Event) {
  if (!selectedChat.value) return
  const value = (event.target as HTMLSelectElement).value
  selectedChat.value.llmInstanceId = value ? Number(value) : null
  await saveChat(selectedChat.value)
}

async function addSystemBlock() {
  if (!selectedChat.value || selectedChatFrozen.value) return
  beforeListMutation()
  await createChatBlock({
    chatId: selectedChat.value.id,
    kind: 'system',
    targetRole: 'system',
    enabled: true,
    title: '系统提示词',
    summary: '',
    contentParts: [{ type: 'text', text: '' }],
    metadata: {}
  })
}

async function addUserBlock() {
  if (!selectedChat.value || selectedChatFrozen.value) return null
  const content = composerText.value
  if (!content.trim()) return null
  beforeListMutation()
  const block = await createChatBlock({
    chatId: selectedChat.value.id,
    kind: 'user',
    targetRole: 'user',
    enabled: true,
    title: '',
    summary: '',
    contentParts: [{ type: 'text', text: content }],
    metadata: {}
  })
  if (block) composerText.value = ''
  return block
}

async function addOnly() {
  await addUserBlock()
}

async function send() {
  if (!selectedChat.value || selectedChatFrozen.value) return
  if (composerText.value.trim()) {
    const block = await addUserBlock()
    if (!block) return
  }
  beforeListMutation()
  await startChatGeneration({ chatId: selectedChat.value.id })
}

async function regenerate(block: ChatBlock) {
  if (!selectedChat.value || selectedChatFrozen.value) return
  beforeListMutation()
  await startChatGeneration({ chatId: selectedChat.value.id, regenerateBlockId: block.id })
}

async function removeBlock(block: ChatBlock) {
  if (selectedChatFrozen.value || !window.confirm('删除这个聊天块？')) return
  beforeListMutation()
  await deleteChatBlock(block)
}

function handleComposerKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return
  if (event.shiftKey) return
  event.preventDefault()
  if (event.metaKey || event.ctrlKey) {
    void addOnly()
  } else {
    void send()
  }
}
</script>

<template>
  <section class="chat-page">
    <aside class="chat-list-pane">
      <div class="pane-header">
        <h2>聊天</h2>
        <button class="toolbar-button" type="button" aria-label="新建聊天" data-tooltip="新建聊天" @click="createChat">
          <MdAdd class="toolbar-icon" aria-hidden="true" />
        </button>
      </div>

      <div class="chat-list">
        <button
          v-for="chat in chats"
          :key="chatKey(chat)"
          class="chat-list-item"
          :class="{ selected: selectedChat?.id === chat.id }"
          type="button"
          @click="selectChat(chat)"
        >
          <strong>{{ chat.title }}</strong>
          <span>{{ generatingChatIds.includes(chat.id) ? '生成中' : new Date(chat.updatedAt).toLocaleString() }}</span>
        </button>
      </div>
    </aside>

    <main v-if="selectedChat" class="chat-workspace">
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
          <button v-if="!hasSystemBlock" class="outline-button" type="button" :disabled="selectedChatFrozen" @click="addSystemBlock">添加系统提示词</button>
          <button class="toolbar-button" type="button" aria-label="删除聊天" data-tooltip="删除聊天" :disabled="selectedChatFrozen" @click="deleteSelectedChat">
            <MdDeleteOutline class="toolbar-icon" aria-hidden="true" />
          </button>
        </div>
      </header>

      <VirtualList
        ref="listRef"
        class="chat-block-list"
        :items="selectedChatBlocks"
        :item-key="blockKey"
        :estimated-item-height="180"
        :buffer-size="6"
      >
        <template #item="{ item: block }">
          <ChatBlockRow
            :block="block"
            :frozen="selectedChatFrozen"
            @save="saveChatBlock"
            @delete="removeBlock"
            @regenerate="regenerate"
            @stop="stopChatGeneration"
          />
        </template>
      </VirtualList>

      <footer class="composer">
        <div class="composer-box">
          <textarea
            v-model="composerText"
            :disabled="selectedChatFrozen"
            rows="3"
            placeholder="输入用户消息"
            @keydown="handleComposerKeydown"
          />
          <div class="composer-bottom">
            <select class="composer-model-select" :value="selectedChat.llmInstanceId ?? ''" :disabled="selectedChatFrozen" aria-label="LLM 实例" @change="selectLlmInstance">
              <option value="">未选择 LLM 实例</option>
              <option v-for="instance in llmInstances" :key="instance.id" :value="instance.id">
                {{ instance.name }} · {{ instance.modelId }}
              </option>
            </select>
            <div class="composer-actions">
              <button class="outline-button composer-action-button" type="button" :disabled="selectedChatFrozen || !composerText.trim()" @click="addOnly">
                <MdPostAdd class="button-icon" aria-hidden="true" />添加
              </button>
              <button
                class="primary-button composer-action-button"
                type="button"
                :disabled="selectedChatFrozen || !selectedChat.llmInstanceId || (!composerText.trim() && !hasSendableBlocks)"
                @click="send"
              >
                <MdPlayArrow class="button-icon" aria-hidden="true" />发送
              </button>
            </div>
          </div>
        </div>
      </footer>
    </main>

    <main v-else class="chat-empty">
      <button class="primary-button" type="button" @click="createChat">新建聊天</button>
    </main>
  </section>
</template>

<style scoped>
.chat-page {
  display: grid;
  grid-template-columns: 280px 1fr;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background: #ffffff;
}

.chat-list-pane {
  min-width: 0;
  overflow: auto;
  border-right: 1px solid #dde3eb;
  padding: 0 10px 12px;
}

.chat-list {
  display: grid;
  gap: 6px;
}

.chat-list-item {
  min-width: 0;
  display: grid;
  gap: 4px;
  text-align: left;
  border: 1px solid #d4dbe4;
  border-radius: 8px;
  background: #ffffff;
  padding: 9px;
}

.chat-list-item.selected {
  border-color: #2f6fca;
  background: #f4f8ff;
}

.chat-list-item strong,
.chat-list-item span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-list-item strong {
  color: #243041;
  font-size: 13px;
}

.chat-list-item span {
  color: #697386;
  font-size: 12px;
}

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
  overflow-y: auto;
}

.composer {
  min-width: 0;
  border-top: 1px solid #dce3ec;
  background: #ffffff;
  padding: 10px 12px;
}

.composer-box {
  min-width: 0;
  display: grid;
  gap: 8px;
  border: 1px solid #cfd7e2;
  border-radius: 8px;
  background: #ffffff;
  padding: 8px;
}

.composer-box:focus-within {
  border-color: #2f6fca;
}

.composer-box textarea {
  min-height: 72px;
  border: 0;
  background: transparent;
  padding: 4px 6px;
  resize: none;
}

.composer-box textarea:focus {
  border-color: transparent;
}

.composer-bottom {
  min-width: 0;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px;
}

.composer-model-select {
  width: min(360px, 52%);
  min-width: 180px;
  height: 32px;
  border: 0;
  border-radius: 6px;
  background: #f4f6f9;
  color: #445064;
  padding: 4px 28px 4px 8px;
  font-size: 13px;
}

.composer-model-select:hover:not(:disabled) {
  background: #eef2f7;
}

.composer-model-select:focus {
  border-color: transparent;
  box-shadow: 0 0 0 2px rgba(47, 111, 202, 0.16);
}

.composer-actions {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  flex-shrink: 0;
}

.composer-action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  padding: 5px 8px;
  font-size: 13px;
  white-space: nowrap;
}

.composer-action-button:hover:not(:disabled) {
  background: #eef2f7;
}

.composer-action-button.primary-button {
  color: #174f99;
  background: #eef5ff;
}

.composer-action-button.primary-button:hover:not(:disabled) {
  background: #e1edff;
}

.composer-action-button:focus-visible {
  box-shadow: 0 0 0 2px rgba(47, 111, 202, 0.16);
}

.button-icon {
  width: 18px;
  height: 18px;
  margin-right: 4px;
  vertical-align: -4px;
}

.chat-empty {
  display: grid;
  place-items: center;
  background: #ffffff;
}

@media (max-width: 980px) {
  .chat-page {
    grid-template-columns: 230px 1fr;
  }

  .composer-bottom {
    align-items: stretch;
    flex-direction: column;
  }

  .composer-model-select {
    width: 100%;
    min-width: 0;
  }

  .composer-actions {
    justify-content: flex-end;
  }
}
</style>
