<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { MdAdd, MdChat, MdCheck, MdClose, MdDeleteOutline } from 'vue-icons-plus/md'
import type { ChatSession } from '../../../shared/types'
import { useProjectWorkbench } from '../composables/useProjectWorkbench'
import ChatWorkspace from './ChatWorkspace.vue'

const {
  chats,
  createChat,
  createChatBlock,
  deleteChat,
  deleteChatBlock,
  generatingChatIds,
  isSelectedChatGenerating,
  llmInstances,
  plugins,
  prepareChatDisplayBlocks,
  previewChatGeneration,
  project,
  saveProjectConfig,
  saveChat,
  saveChatBlock,
  selectChat,
  selectedChat,
  selectedChatBlocks,
  startChatGeneration,
  stopChatGeneration
} = useProjectWorkbench()

const newChatDialogOpen = ref(false)
const creatingChat = ref(false)
const newChatButtonRef = ref<HTMLButtonElement | null>(null)
const newChatPopupRef = ref<HTMLElement | null>(null)
const newChatPopupStyle = ref<Record<string, string>>({})
const draftEnabledPluginIds = ref<string[]>([])
const chatContextMenu = ref<{ chat: ChatSession } | null>(null)
const chatContextMenuStyle = ref<Record<string, string>>({})

const projectEnabledPluginIds = computed(() => (
  project.value?.config.plugins.enabledPluginIds ?? plugins.value.map(plugin => plugin.manifest.id)
))

function chatKey(chat: ChatSession) {
  return chat.id
}

function pluginCountLabel(chat: ChatSession): string {
  const count = chat.runtimeConfig.enabledPluginIds.length
  return count > 0 ? `${count} 个插件` : '未启用插件'
}

function isChatGenerating(chat: ChatSession): boolean {
  return generatingChatIds.value.includes(chat.id)
}

watch(chatContextMenu, (menu) => {
  if (menu) {
    window.addEventListener('click', closeChatContextMenu)
    window.addEventListener('resize', closeChatContextMenu)
    window.addEventListener('scroll', closeChatContextMenu, true)
    return
  }

  removeChatContextMenuListeners()
})

watch(newChatDialogOpen, (open) => {
  if (open) {
    window.addEventListener('click', closeNewChatDialog)
    window.addEventListener('resize', closeNewChatDialog)
    nextTick(updateNewChatPopupPosition)
    return
  }

  removeNewChatPopupListeners()
})

onBeforeUnmount(() => {
  removeChatContextMenuListeners()
  removeNewChatPopupListeners()
})

function removeChatContextMenuListeners() {
  window.removeEventListener('click', closeChatContextMenu)
  window.removeEventListener('resize', closeChatContextMenu)
  window.removeEventListener('scroll', closeChatContextMenu, true)
}

function removeNewChatPopupListeners() {
  window.removeEventListener('click', closeNewChatDialog)
  window.removeEventListener('resize', closeNewChatDialog)
}

function openNewChatDialog() {
  closeChatContextMenu()
  draftEnabledPluginIds.value = [...projectEnabledPluginIds.value]
  newChatDialogOpen.value = true
  nextTick(updateNewChatPopupPosition)
}

function closeNewChatDialog() {
  if (creatingChat.value) return
  newChatDialogOpen.value = false
}

function updateNewChatPopupPosition() {
  const button = newChatButtonRef.value
  if (!button) return

  const rect = button.getBoundingClientRect()
  const gap = 6
  const margin = 8
  const width = Math.min(520, window.innerWidth - margin * 2)
  const height = newChatPopupRef.value?.offsetHeight ?? 420
  const left = Math.min(
    window.innerWidth - width - margin,
    Math.max(margin, rect.right - width)
  )
  const preferredTop = rect.bottom + gap
  const top = preferredTop + height > window.innerHeight - margin
    ? Math.max(margin, rect.top - height - gap)
    : preferredTop

  newChatPopupStyle.value = {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`
  }
}

function isDraftPluginEnabled(pluginId: string): boolean {
  return draftEnabledPluginIds.value.includes(pluginId)
}

function toggleDraftPlugin(pluginId: string) {
  draftEnabledPluginIds.value = isDraftPluginEnabled(pluginId)
    ? draftEnabledPluginIds.value.filter(id => id !== pluginId)
    : [...draftEnabledPluginIds.value, pluginId]
}

async function confirmCreateChat() {
  if (creatingChat.value) return
  creatingChat.value = true
  const enabledPluginIds = [...draftEnabledPluginIds.value]
  const saved = await saveProjectConfig({
    chatCreateDefaults: { enabledPluginIds },
    plugins: { enabledPluginIds }
  })
  const chat = saved
    ? await createChat({
      title: '新聊天',
      runtimeConfig: {
        enabledPluginIds,
        pluginData: {}
      }
    })
    : null
  creatingChat.value = false
  if (chat) newChatDialogOpen.value = false
}

function openChatContextMenu(event: MouseEvent, chat: ChatSession) {
  event.preventDefault()
  const width = 184
  const height = 44
  const margin = 8
  const left = Math.min(window.innerWidth - width - margin, Math.max(margin, event.clientX))
  const top = Math.min(window.innerHeight - height - margin, Math.max(margin, event.clientY))
  chatContextMenu.value = { chat }
  chatContextMenuStyle.value = {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`
  }
}

function closeChatContextMenu() {
  chatContextMenu.value = null
}

async function deleteContextChat() {
  const chat = chatContextMenu.value?.chat
  if (!chat || isChatGenerating(chat)) return
  closeChatContextMenu()
  await deleteChat(chat)
}
</script>

<template>
  <section class="chat-page">
    <aside class="chat-list-pane">
      <div class="pane-header">
        <h2>聊天</h2>
        <button ref="newChatButtonRef" class="toolbar-button" type="button" aria-label="新建聊天" data-tooltip="新建聊天" @click.stop="openNewChatDialog">
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
          @contextmenu.prevent="openChatContextMenu($event, chat)"
        >
          <span class="chat-list-avatar">
            <MdChat class="chat-list-avatar-icon" aria-hidden="true" />
          </span>
          <span class="chat-list-copy">
            <strong>{{ chat.title }}</strong>
            <span class="chat-list-meta">{{ pluginCountLabel(chat) }}</span>
            <span class="chat-list-updated">{{ new Date(chat.updatedAt).toLocaleString() }}</span>
          </span>
          <span
            v-if="isChatGenerating(chat)"
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
      :create-chat-block="createChatBlock"
      :delete-chat-block="deleteChatBlock"
      :frozen="isSelectedChatGenerating"
      :llm-instances="llmInstances"
      :plugins="plugins"
      :prepare-chat-display-blocks="prepareChatDisplayBlocks"
      :preview-chat-generation="previewChatGeneration"
      :save-chat="saveChat"
      :save-chat-block="saveChatBlock"
      :start-chat-generation="startChatGeneration"
      :stop-chat-generation="stopChatGeneration"
    />

    <main v-else class="chat-empty">
      <button class="primary-button" type="button" @click.stop="openNewChatDialog">新建聊天</button>
    </main>

    <Teleport to="body">
      <div v-if="chatContextMenu" class="chat-context-menu" :style="chatContextMenuStyle" @click.stop>
        <button class="danger-menu-item" type="button" :disabled="isChatGenerating(chatContextMenu.chat)" @click="deleteContextChat">
          <MdDeleteOutline class="menu-icon" aria-hidden="true" />删除聊天
        </button>
      </div>
    </Teleport>

    <Teleport to="body">
      <section v-if="newChatDialogOpen" ref="newChatPopupRef" class="new-chat-popup" :style="newChatPopupStyle" role="dialog" aria-modal="false" aria-labelledby="new-chat-title" @click.stop>
        <header class="dialog-header">
          <h2 id="new-chat-title">新建聊天</h2>
          <button class="toolbar-button" type="button" aria-label="关闭" data-tooltip="关闭" :disabled="creatingChat" @click="closeNewChatDialog">
            <MdClose class="toolbar-icon" aria-hidden="true" />
          </button>
        </header>

        <div class="dialog-body">
          <section class="dialog-section">
            <h3>启用插件</h3>
            <div class="choice-list">
              <button
                v-for="plugin in plugins"
                :key="plugin.manifest.id"
                class="dialog-choice-row"
                type="button"
                :class="{ selected: isDraftPluginEnabled(plugin.manifest.id) }"
                @click="toggleDraftPlugin(plugin.manifest.id)"
              >
                <span class="dialog-choice-copy">
                  <strong>{{ plugin.manifest.name || plugin.manifest.id }}</strong>
                  <span>{{ plugin.manifest.description || plugin.manifest.id }}</span>
                </span>
                <span class="setting-check" aria-hidden="true">
                  <MdCheck v-if="isDraftPluginEnabled(plugin.manifest.id)" class="setting-check-icon" />
                </span>
              </button>
              <p v-if="!plugins.length" class="empty-row">当前项目还没有插件。</p>
            </div>
          </section>
        </div>

        <footer class="dialog-actions">
          <button class="outline-button" type="button" :disabled="creatingChat" @click="closeNewChatDialog">取消</button>
          <button class="primary-button" type="button" :disabled="creatingChat" @click="confirmCreateChat">
            {{ creatingChat ? '创建中' : '创建' }}
          </button>
        </footer>
      </section>
    </Teleport>
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
  display: flex;
  flex-direction: column;
}

.chat-list-item {
  min-width: 0;
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) 22px;
  column-gap: 10px;
  align-items: center;
  text-align: left;
  border: 0;
  border-bottom: 1px solid #edf0f4;
  border-radius: 0;
  background: #ffffff;
  padding: 8px 6px;
  color: #243041;
}

.chat-list-item.selected {
  background: #edf5ff;
}

.chat-list-item:hover {
  background: #f6f9fd;
}

.chat-list-avatar {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 50%;
  background: #edf2f7;
  color: #5d6b7e;
}

.chat-list-avatar-icon {
  width: 21px;
  height: 21px;
}

.chat-list-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.chat-list-copy strong,
.chat-list-copy span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-list-copy strong {
  color: #243041;
  font-size: 13px;
}

.chat-list-meta,
.chat-list-updated {
  color: #697386;
  font-size: 11px;
}

.chat-generating-indicator {
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

.chat-context-menu,
.new-chat-popup {
  position: fixed;
  border: 1px solid #d7dee8;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(32, 39, 49, 0.14);
}

.chat-context-menu {
  z-index: 130;
  padding: 6px;
}

.chat-context-menu button {
  width: 100%;
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

.chat-context-menu button:hover:not(:disabled) {
  background: #f1f5fa;
}

.chat-context-menu button:disabled {
  cursor: default;
  opacity: 0.45;
}

.danger-menu-item {
  color: #9d2c2c !important;
}

.menu-icon {
  width: 17px;
  height: 17px;
  flex-shrink: 0;
}

.new-chat-popup {
  z-index: 125;
  max-height: min(720px, calc(100vh - 32px));
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
}

.dialog-header,
.dialog-actions {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid #edf0f4;
  padding: 8px 12px;
}

.dialog-header h2 {
  margin: 0;
  color: #243041;
  font-size: 14px;
  font-weight: 700;
}

.dialog-body {
  min-width: 0;
  overflow: auto;
  display: grid;
  gap: 14px;
  padding: 12px;
}

.dialog-section {
  min-width: 0;
  display: grid;
  gap: 8px;
}

.dialog-section h3 {
  margin: 0;
  color: #465469;
  font-size: 12px;
  font-weight: 700;
}

.choice-list {
  min-width: 0;
  max-height: 260px;
  overflow: auto;
  display: grid;
  border: 1px solid #e1e7ef;
  border-radius: 8px;
}

.dialog-choice-row {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 24px;
  align-items: center;
  gap: 9px;
  border: 0;
  border-bottom: 1px solid #edf0f4;
  background: #ffffff;
  padding: 8px;
  text-align: left;
}

.dialog-choice-row:last-child {
  border-bottom: 0;
}

.dialog-choice-row:hover {
  background: #f6f9fd;
}

.dialog-choice-row.selected {
  background: #edf5ff;
}

.dialog-choice-copy,
.dialog-choice-copy strong,
.dialog-choice-copy span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dialog-choice-copy {
  display: grid;
  gap: 2px;
}

.dialog-choice-copy strong {
  color: #243041;
  font-size: 13px;
}

.dialog-choice-copy span {
  color: #697386;
  font-size: 12px;
}

.setting-check {
  width: 18px;
  height: 18px;
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  color: #2f6fca;
}

.setting-check-icon {
  width: 18px;
  height: 18px;
}

.empty-row {
  min-width: 0;
  border: 1px dashed #d7dee8;
  border-radius: 7px;
  color: #7a8594;
  font-size: 12px;
  padding: 9px;
  text-align: center;
}

.dialog-actions {
  justify-content: flex-end;
  border-top: 1px solid #edf0f4;
  border-bottom: 0;
}

@media (max-width: 980px) {
  .chat-page {
    grid-template-columns: 230px 1fr;
  }
}
</style>
