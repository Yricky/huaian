<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  MdAdd,
  MdCheck,
  MdClose,
  MdDeleteOutline,
  MdKeyboardArrowDown,
  MdKeyboardArrowUp,
  MdPerson
} from 'vue-icons-plus/md'
import type { ChatCreationDefaults, ChatSession, CharacterEntry, JsonRecord, LoreBook } from '../../../shared/types'
import { useProjectWorkbench } from '../composables/useProjectWorkbench'
import ChatWorkspace from './ChatWorkspace.vue'

const {
  chats,
  characterAssetUrl,
  characters,
  createChat,
  createChatBlock,
  deleteChat,
  deleteChatBlock,
  generatingChatIds,
  isSelectedChatGenerating,
  llmInstances,
  loreBooks,
  previewChatGeneration,
  project,
  saveProjectConfig,
  saveChat,
  saveChatBlock,
  selectChat,
  selectedChat,
  selectedChatBlocks,
  startChatGeneration,
  stopChatGeneration,
  worldEntries
} = useProjectWorkbench()

const newChatDialogOpen = ref(false)
const creatingChat = ref(false)
const newChatButtonRef = ref<HTMLButtonElement | null>(null)
const newChatPopupRef = ref<HTMLElement | null>(null)
const newChatPopupStyle = ref<Record<string, string>>({})
const draftCharacterId = ref<number | null>(null)
const draftLoreBookIds = ref<number[]>([])
const draftCharacterRegexScriptsEnabled = ref(true)
const chatContextMenu = ref<{ chat: ChatSession } | null>(null)
const chatContextMenuStyle = ref<Record<string, string>>({})

const draftSelectedLoreBooks = computed(() => draftLoreBookIds.value
  .map(id => loreBooks.value.find(book => book.id === id))
  .filter((book): book is LoreBook => Boolean(book)))
const draftAvailableLoreBooks = computed(() => {
  const selected = new Set(draftLoreBookIds.value)
  return loreBooks.value.filter(book => !selected.has(book.id))
})

function chatKey(chat: ChatSession) {
  return chat.id
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

function recordFromJson(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function stringFromJson(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function characterName(character: CharacterEntry): string {
  const data = recordFromJson(character.stData.data)
  return stringFromJson(data.name, `角色 #${character.id}`).trim() || `角色 #${character.id}`
}

function chatCharacter(chat: ChatSession): CharacterEntry | null {
  const id = chat.runtimeConfig.characterId
  return id === null || id === undefined ? null : characters.value.find(character => character.id === id) ?? null
}

function chatCharacterLabel(chat: ChatSession): string {
  const character = chatCharacter(chat)
  return character ? characterName(character) : '无角色'
}

function chatAvatarUrl(chat: ChatSession): string {
  const character = chatCharacter(chat)
  return character ? characterAssetUrl(character) : ''
}

function isChatGenerating(chat: ChatSession): boolean {
  return generatingChatIds.value.includes(chat.id)
}

function normalizeCreationDefaults(defaults?: ChatCreationDefaults): ChatCreationDefaults {
  const characterId = defaults?.characterId ?? null
  const existingCharacterId = characterId !== null && characters.value.some(character => character.id === characterId)
    ? characterId
    : null
  const existingLoreBookIds = new Set(loreBooks.value.map(book => book.id))
  const loreBookIds = [...new Set(defaults?.loreBookIds ?? [])].filter(id => existingLoreBookIds.has(id))

  return {
    characterId: existingCharacterId,
    loreBookIds,
    characterRegexScriptsEnabled: defaults?.characterRegexScriptsEnabled !== false
  }
}

function currentDraftDefaults(): ChatCreationDefaults {
  return normalizeCreationDefaults({
    characterId: draftCharacterId.value,
    loreBookIds: draftLoreBookIds.value,
    characterRegexScriptsEnabled: draftCharacterRegexScriptsEnabled.value
  })
}

function openNewChatDialog() {
  closeChatContextMenu()
  const defaults = normalizeCreationDefaults(project.value?.config.chatCreateDefaults)
  draftCharacterId.value = defaults.characterId
  draftLoreBookIds.value = defaults.loreBookIds
  draftCharacterRegexScriptsEnabled.value = defaults.characterRegexScriptsEnabled
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
  const height = newChatPopupRef.value?.offsetHeight ?? 620
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

async function confirmCreateChat() {
  if (creatingChat.value) return
  const defaults = currentDraftDefaults()
  const character = defaults.characterId === null
    ? null
    : characters.value.find(item => item.id === defaults.characterId) ?? null
  const title = character ? characterName(character) : '新聊天'

  creatingChat.value = true
  const saved = await saveProjectConfig({ chatCreateDefaults: defaults })
  const chat = saved
    ? await createChat({
      title,
      runtimeConfig: {
        characterId: defaults.characterId,
        loreBookIds: defaults.loreBookIds,
        characterRegexScriptsEnabled: defaults.characterRegexScriptsEnabled
      }
    })
    : null
  creatingChat.value = false
  if (chat) newChatDialogOpen.value = false
}

function selectDraftCharacter(characterId: number | null) {
  draftCharacterId.value = characterId
}

function addDraftLoreBook(event: Event) {
  const select = event.target as HTMLSelectElement
  const id = Number(select.value)
  select.value = ''
  if (!Number.isInteger(id) || draftLoreBookIds.value.includes(id)) return
  draftLoreBookIds.value = [...draftLoreBookIds.value, id]
}

function removeDraftLoreBook(id: number) {
  draftLoreBookIds.value = draftLoreBookIds.value.filter(loreBookId => loreBookId !== id)
}

function moveDraftLoreBook(id: number, direction: -1 | 1) {
  const ids = [...draftLoreBookIds.value]
  const index = ids.indexOf(id)
  const nextIndex = index + direction
  if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return
  const [item] = ids.splice(index, 1)
  ids.splice(nextIndex, 0, item)
  draftLoreBookIds.value = ids
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
            <img v-if="chatAvatarUrl(chat)" :src="chatAvatarUrl(chat)" alt="" />
            <MdPerson v-else class="chat-list-avatar-icon" aria-hidden="true" />
          </span>
          <span class="chat-list-copy">
            <strong>{{ chat.title }}</strong>
            <span class="chat-list-meta">{{ chatCharacterLabel(chat) }}</span>
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
      :characters="characters"
      :create-chat-block="createChatBlock"
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
              <h3>角色卡</h3>
              <div class="choice-list">
                <button class="dialog-choice-row" type="button" :class="{ selected: draftCharacterId === null }" @click="selectDraftCharacter(null)">
                  <span class="dialog-avatar placeholder">
                    <MdPerson class="dialog-avatar-icon" aria-hidden="true" />
                  </span>
                  <span class="dialog-choice-copy">
                    <strong>无角色</strong>
                  </span>
                </button>
                <button
                  v-for="character in characters"
                  :key="character.id"
                  class="dialog-choice-row"
                  type="button"
                  :class="{ selected: draftCharacterId === character.id }"
                  @click="selectDraftCharacter(character.id)"
                >
                  <span class="dialog-avatar">
                    <img v-if="characterAssetUrl(character)" :src="characterAssetUrl(character)" alt="" />
                    <MdPerson v-else class="dialog-avatar-icon" aria-hidden="true" />
                  </span>
                  <span class="dialog-choice-copy">
                    <strong>{{ characterName(character) }}</strong>
                  </span>
                </button>
              </div>
            </section>

            <section class="dialog-section">
              <h3>聊天设置</h3>
              <button
                class="setting-row"
                type="button"
                :aria-pressed="draftCharacterRegexScriptsEnabled"
                :class="{ selected: draftCharacterRegexScriptsEnabled }"
                title="仅在展示和发送给模型时应用角色卡 extensions.regex_scripts；保存内容保持原始文本。"
                @click="draftCharacterRegexScriptsEnabled = !draftCharacterRegexScriptsEnabled"
              >
                <span class="setting-row-text">角色正则脚本</span>
                <span class="setting-check" aria-hidden="true">
                  <MdCheck v-if="draftCharacterRegexScriptsEnabled" class="setting-check-icon" />
                </span>
              </button>
            </section>

            <section class="dialog-section">
              <h3>世界书</h3>
              <select class="dialog-select" :disabled="draftAvailableLoreBooks.length === 0" aria-label="添加世界书" @change="addDraftLoreBook">
                <option value="">添加世界书</option>
                <option v-for="book in draftAvailableLoreBooks" :key="book.id" :value="book.id">{{ book.name }}</option>
              </select>
              <div class="ordered-list">
                <div v-for="(book, index) in draftSelectedLoreBooks" :key="book.id" class="ordered-row">
                  <span>{{ book.name }}</span>
                  <div class="row-actions">
                    <button class="icon-button compact" type="button" :disabled="index === 0" :aria-label="`上移 ${book.name}`" data-tooltip="上移" @click="moveDraftLoreBook(book.id, -1)">
                      <MdKeyboardArrowUp class="menu-icon" aria-hidden="true" />
                    </button>
                    <button class="icon-button compact" type="button" :disabled="index === draftSelectedLoreBooks.length - 1" :aria-label="`下移 ${book.name}`" data-tooltip="下移" @click="moveDraftLoreBook(book.id, 1)">
                      <MdKeyboardArrowDown class="menu-icon" aria-hidden="true" />
                    </button>
                    <button class="icon-button compact" type="button" :aria-label="`移除 ${book.name}`" data-tooltip="移除" @click="removeDraftLoreBook(book.id)">
                      <MdClose class="menu-icon" aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <div v-if="draftSelectedLoreBooks.length === 0" class="empty-row">未绑定世界书</div>
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

.chat-list-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
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

.chat-context-menu {
  position: fixed;
  z-index: 130;
  border: 1px solid #d7dee8;
  border-radius: 8px;
  background: #ffffff;
  padding: 6px;
  box-shadow: 0 8px 24px rgba(32, 39, 49, 0.14);
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
  position: fixed;
  z-index: 125;
  max-height: min(720px, calc(100vh - 32px));
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
  border: 1px solid #d7dee8;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 18px 42px rgba(32, 39, 49, 0.18);
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
  max-height: 236px;
  overflow: auto;
  display: grid;
  border: 1px solid #e1e7ef;
  border-radius: 8px;
}

.dialog-choice-row {
  min-width: 0;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
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

.dialog-avatar {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 50%;
  background: #edf2f7;
  color: #5d6b7e;
}

.dialog-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.dialog-avatar-icon {
  width: 20px;
  height: 20px;
}

.dialog-choice-copy,
.dialog-choice-copy strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dialog-choice-copy strong {
  color: #243041;
  font-size: 13px;
}

.setting-row {
  min-width: 0;
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid #e1e7ef;
  border-radius: 7px;
  background: #fbfcfd;
  color: #303a49;
  cursor: pointer;
  font-size: 12px;
  padding: 7px 8px;
}

.setting-row:hover {
  background: #f1f5fa;
}

.setting-row.selected {
  border-color: #2f6fca;
  background: #f4f8ff;
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

.setting-check-icon {
  width: 18px;
  height: 18px;
}

.dialog-select {
  width: 100%;
  min-width: 0;
  height: 34px;
  border: 1px solid #d7dee8;
  border-radius: 7px;
  background: #ffffff;
  color: #273245;
  font-size: 12px;
  padding: 0 8px;
}

.ordered-list {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.ordered-row {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid #e1e7ef;
  border-radius: 7px;
  background: #fbfcfd;
  padding: 7px 8px;
}

.ordered-row span {
  min-width: 0;
  overflow: hidden;
  color: #303a49;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.icon-button.compact {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  padding: 0;
}

.icon-button.compact:hover:not(:disabled) {
  background: #e8edf4;
}

.icon-button.compact:disabled {
  cursor: default;
  opacity: 0.45;
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
