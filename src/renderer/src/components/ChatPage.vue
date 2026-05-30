<script setup lang="ts">
import { MdAdd } from 'vue-icons-plus/md'
import type { ChatSession } from '../../../shared/types'
import { useProjectWorkbench } from '../composables/useProjectWorkbench'
import ChatWorkspace from './ChatWorkspace.vue'

const {
  chats,
  characters,
  createChat,
  createChatBlock,
  deleteChatBlock,
  deleteSelectedChat,
  generatingChatIds,
  isSelectedChatGenerating,
  llmInstances,
  loreBooks,
  previewChatGeneration,
  saveChat,
  saveChatBlock,
  selectChat,
  selectedChat,
  selectedChatBlocks,
  startChatGeneration,
  stopChatGeneration,
  worldEntries
} = useProjectWorkbench()

function chatKey(chat: ChatSession) {
  return chat.id
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
          <span class="chat-list-updated">{{ new Date(chat.updatedAt).toLocaleString() }}</span>
          <span
            v-if="generatingChatIds.includes(chat.id)"
            class="chat-generating-indicator"
            aria-label="生成中"
            title="生成中"
          />
        </button>
      </div>
    </aside>

    <ChatWorkspace
      v-if="selectedChat"
      :blocks="selectedChatBlocks"
      :chat="selectedChat"
      :characters="characters"
      :create-chat-block="createChatBlock"
      :delete-chat="deleteSelectedChat"
      :delete-chat-block="deleteChatBlock"
      :frozen="isSelectedChatGenerating"
      :llm-instances="llmInstances"
      :lore-books="loreBooks"
      :preview-chat-generation="previewChatGeneration"
      :save-chat="saveChat"
      :save-chat-block="saveChatBlock"
      :start-chat-generation="startChatGeneration"
      :stop-chat-generation="stopChatGeneration"
      :world-entries="worldEntries"
    />

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
  grid-template-columns: minmax(0, 1fr) 22px;
  grid-template-areas:
    "title status"
    "meta status";
  column-gap: 8px;
  row-gap: 4px;
  align-items: center;
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
  grid-area: title;
  color: #243041;
  font-size: 13px;
}

.chat-list-updated {
  grid-area: meta;
  color: #697386;
  font-size: 12px;
}

.chat-generating-indicator {
  grid-area: status;
  position: relative;
  width: 22px;
  height: 22px;
  justify-self: end;
  border-radius: 50%;
}

.chat-generating-indicator::before,
.chat-generating-indicator::after {
  position: absolute;
  inset: 4px;
  content: "";
  border-radius: 50%;
}

.chat-generating-indicator::before {
  border: 2px solid #bfd4f4;
}

.chat-generating-indicator::after {
  border: 2px solid transparent;
  border-top-color: #2f6fca;
  animation: chat-generating-spin 780ms linear infinite;
}

@keyframes chat-generating-spin {
  to {
    transform: rotate(360deg);
  }
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
}
</style>
