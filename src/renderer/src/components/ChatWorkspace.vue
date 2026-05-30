<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  MdAutoStories,
  MdBook,
  MdClose,
  MdDeleteOutline,
  MdKeyboardArrowDown,
  MdKeyboardArrowUp,
  MdMoreVert,
  MdPerson,
  MdPostAdd,
  MdSmartToy,
  MdVisibility
} from 'vue-icons-plus/md'
import { buildSillyTavernLikePrompt } from '../../../shared/st-prompt-builder'
import { LOREBOOK_EDIT_TOOL_GROUP, defaultLoreBookEditPrompt } from '../../../shared/lorebook-tooling'
import type {
  ChatBlock,
  ChatBlockCreatePayload,
  ChatGenerationPreview,
  ChatGenerationRequest,
  ChatRuntimeConfig,
  ChatSession,
  CharacterEntry,
  JsonRecord,
  LlmInstance,
  LoreBook,
  WorldEntry
} from '../../../shared/types'
import ChatBlockRow from './ChatBlockRow.vue'
import ChatVirtualList from './ChatVirtualList.vue'
import JsonDialog from './JsonDialog.vue'

type ChatListItem =
  | { type: 'block'; block: ChatBlock }
  | { type: 'actions'; id: string }

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
  characters: CharacterEntry[]
  createChatBlock: (payload: ChatBlockCreatePayload) => Promise<ChatBlock | null>
  deleteChat: () => Promise<void>
  deleteChatBlock: (block: ChatBlock) => Promise<void>
  frozen: boolean
  llmInstances: LlmInstance[]
  loreBooks: LoreBook[]
  previewChatGeneration: (payload: ChatGenerationRequest) => Promise<ChatGenerationPreview | null>
  saveChat: (chat: ChatSession) => Promise<void>
  saveChatBlock: (block: ChatBlock) => Promise<void>
  startChatGeneration: (payload: ChatGenerationRequest) => Promise<void>
  stopChatGeneration: (chatId: number) => Promise<void>
  worldEntries: WorldEntry[]
}>()

const listRef = ref<ChatVirtualListExpose | null>(null)
const shouldFollow = ref(true)
const titleDraft = ref('')
const menuOpen = ref(false)
const menuButtonRef = ref<HTMLButtonElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})
const replyPanelOpen = ref(false)
const replyButtonRef = ref<HTMLButtonElement | null>(null)
const replyPanelRef = ref<HTMLElement | null>(null)
const replyPanelStyle = ref<Record<string, string>>({})
const contextPreview = ref<ChatGenerationPreview | null>(null)
const collapsedBlockState = ref<Record<string, boolean>>({})
const blockRowRefs = new Map<number, ChatBlockRowExpose>()

const hasSystemBlock = computed(() => props.blocks.some(block => block.kind === 'system'))
const canGenerateReply = computed(() => Boolean(
  props.chat.runtimeConfig.llmInstanceId && !props.frozen
))
const selectedCharacter = computed(() => {
  const id = props.chat.runtimeConfig.characterId
  return id === null || id === undefined ? null : props.characters.find(character => character.id === id) ?? null
})
const selectedLlmInstance = computed(() => {
  const id = props.chat.runtimeConfig.llmInstanceId
  return id === null || id === undefined ? null : props.llmInstances.find(instance => instance.id === id) ?? null
})
const selectedLoreBooks = computed(() => props.chat.runtimeConfig.loreBookIds
  .map(id => props.loreBooks.find(book => book.id === id))
  .filter((book): book is LoreBook => Boolean(book)))
const availableLoreBooks = computed(() => {
  const selected = new Set(props.chat.runtimeConfig.loreBookIds)
  return props.loreBooks.filter(book => !selected.has(book.id))
})
const promptPreview = computed(() => buildSillyTavernLikePrompt({
  chat: props.chat,
  characters: props.characters,
  loreBooks: props.loreBooks,
  worldEntries: props.worldEntries,
  blocks: props.blocks
}))
const replyButtonLabel = computed(() => {
  const character = selectedCharacter.value ? characterName(selectedCharacter.value) : '无角色'
  const instance = selectedLlmInstance.value?.name ?? '未选择 LLM'
  return `${character} · ${instance}`
})
const blockAutoFollowSignature = computed(() => props.blocks.map(block => JSON.stringify({
  id: block.id,
  kind: block.kind,
  targetRole: block.targetRole,
  enabled: block.enabled,
  status: block.status,
  title: block.title,
  summary: block.summary,
  contentParts: block.contentParts,
  requestBlockIds: block.requestBlockIds,
  errorText: block.errorText
})).join('\u001f'))
const chatListItems = computed<ChatListItem[]>(() => {
  const startBlocks: ChatBlock[] = []
  const endBlocks: ChatBlock[] = []
  const before = new Map<number, ChatBlock[]>()
  const after = new Map<number, ChatBlock[]>()

  for (const block of promptPreview.value.virtualBlocks) {
    const metadata = block.metadata
    const beforeBlockId = numberFromMetadata(metadata.displayBeforeBlockId)
    const afterBlockId = numberFromMetadata(metadata.displayAfterBlockId)
    if (beforeBlockId !== null) {
      const list = before.get(beforeBlockId) ?? []
      list.push(block)
      before.set(beforeBlockId, list)
      continue
    }
    if (afterBlockId !== null) {
      const list = after.get(afterBlockId) ?? []
      list.push(block)
      after.set(afterBlockId, list)
      continue
    }
    if (metadata.displaySlot === 'end') endBlocks.push(block)
    else startBlocks.push(block)
  }

  const items: ChatListItem[] = startBlocks.map((block): ChatListItem => ({ type: 'block', block }))
  for (const block of props.blocks) {
    for (const injection of before.get(block.id) ?? []) items.push({ type: 'block', block: injection })
    items.push({ type: 'block', block })
    for (const injection of after.get(block.id) ?? []) items.push({ type: 'block', block: injection })
  }
  for (const block of endBlocks) items.push({ type: 'block', block })
  items.push({ type: 'actions', id: `chat-actions-${props.chat.id}` })
  return items
})

watch(() => props.chat.id, () => {
  titleDraft.value = props.chat.title
  blockRowRefs.clear()
  menuOpen.value = false
  replyPanelOpen.value = false
  contextPreview.value = null
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
})

function chatListItemKey(item: ChatListItem) {
  if (item.type !== 'block') return item.id
  return blockStateKey(item.block)
}

function blockStateKey(block: ChatBlock): string {
  return block.metadata.virtual === true
    ? [
        'virtual',
        props.chat.id,
        block.id,
        stringFromJson(block.metadata.displaySlot),
        numberFromMetadata(block.metadata.displayBeforeBlockId) ?? '',
        numberFromMetadata(block.metadata.displayAfterBlockId) ?? '',
        Array.isArray(block.metadata.activatedEntryIds) ? block.metadata.activatedEntryIds.join(',') : ''
      ].join(':')
    : `block:${block.id}`
}

function defaultBlockCollapsed(block: ChatBlock): boolean {
  if (typeof block.metadata.uiCollapsed === 'boolean') return block.metadata.uiCollapsed
  return block.kind === 'injection'
}

function isBlockCollapsed(block: ChatBlock): boolean {
  return collapsedBlockState.value[blockStateKey(block)] ?? defaultBlockCollapsed(block)
}

async function setBlockCollapsed(block: ChatBlock, collapsed: boolean) {
  collapsedBlockState.value = {
    ...collapsedBlockState.value,
    [blockStateKey(block)]: collapsed
  }
  if (block.metadata.virtual === true || block.metadata.uiCollapsed === collapsed) return
  await props.saveChatBlock({
    ...block,
    metadata: {
      ...block.metadata,
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
  const width = 420
  const gap = 8
  const margin = 8
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

function numberFromMetadata(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
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

function runtimeConfigWith(patch: Partial<ChatRuntimeConfig>): ChatRuntimeConfig {
  return {
    characterId: patch.characterId === undefined ? props.chat.runtimeConfig.characterId : patch.characterId,
    llmInstanceId: patch.llmInstanceId === undefined ? props.chat.runtimeConfig.llmInstanceId : patch.llmInstanceId,
    loreBookIds: patch.loreBookIds === undefined ? [...props.chat.runtimeConfig.loreBookIds] : [...patch.loreBookIds]
  }
}

async function saveRuntimeConfig(config: ChatRuntimeConfig) {
  await props.saveChat({
    ...props.chat,
    runtimeConfig: config
  })
}

async function selectReplyCharacter(characterId: number | null) {
  await saveRuntimeConfig(runtimeConfigWith({ characterId }))
}

async function selectReplyLlmInstance(llmInstanceId: number | null) {
  await saveRuntimeConfig(runtimeConfigWith({ llmInstanceId }))
}

async function setChatLoreBookIds(loreBookIds: number[]) {
  await saveRuntimeConfig(runtimeConfigWith({ loreBookIds: [...new Set(loreBookIds)] }))
}

async function addLoreBook(event: Event) {
  const select = event.target as HTMLSelectElement
  const id = Number(select.value)
  select.value = ''
  if (!Number.isInteger(id)) return
  await setChatLoreBookIds([...props.chat.runtimeConfig.loreBookIds, id])
}

async function removeLoreBook(id: number) {
  await setChatLoreBookIds(props.chat.runtimeConfig.loreBookIds.filter(loreBookId => loreBookId !== id))
}

async function moveLoreBook(id: number, direction: -1 | 1) {
  const ids = [...props.chat.runtimeConfig.loreBookIds]
  const index = ids.indexOf(id)
  const nextIndex = index + direction
  if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return
  const [item] = ids.splice(index, 1)
  ids.splice(nextIndex, 0, item)
  await setChatLoreBookIds(ids)
}

async function saveTitle() {
  await props.saveChat({
    ...props.chat,
    title: titleDraft.value.trim() || '新聊天'
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

async function insertToolDefinitionBlock(relativeBlock: ChatBlock, placement: 'before' | 'after') {
  if (props.frozen) return
  beforeListMutation()
  await saveEditingBlocks()
  await props.createChatBlock({
    chatId: props.chat.id,
    kind: 'tool_definition',
    targetRole: 'system',
    enabled: true,
    title: '世界书编辑工具',
    summary: '工具定义',
    contentParts: [{ type: 'text', text: defaultLoreBookEditPrompt(null) }],
    metadata: {
      toolDefinition: {
        group: LOREBOOK_EDIT_TOOL_GROUP,
        loreBookId: null,
        enabledTools: ['list_lorebook_entries', 'get_lorebook_entries_json', 'test_lorebook_trigger', 'upsert_lorebook_entry']
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
  replyPanelOpen.value = false
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

    <ChatVirtualList ref="listRef" class="chat-block-list" :items="chatListItems" :item-key="chatListItemKey"
      :estimated-item-height="180" :buffer-size="6">
      <template #item="{ item: chatItem }">
        <ChatBlockRow v-if="chatItem.type === 'block'" :ref="(element) => setBlockRowRef(chatItem.block.id, element)"
          :block="chatItem.block" :collapsed="isBlockCollapsed(chatItem.block)" :frozen="frozen" :lore-books="loreBooks"
          @collapse-change="setBlockCollapsed(chatItem.block, $event)" @save="saveChatBlock" @delete="removeBlock"
          @regenerate="regenerate" @stop="stopChatGeneration" @insert-tool-definition="insertToolDefinitionBlock" />
        <div v-else class="chat-action-strip">
          <button class="md3-pill-button input-pill" type="button" :disabled="frozen" @click="addUserBlockForEditing">
            <MdPostAdd class="button-icon" aria-hidden="true" />输入用户内容
          </button>

          <div class="md3-pill-combo">
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
      </template>
    </ChatVirtualList>

    <Teleport to="body">
      <div v-if="menuOpen" ref="menuRef" class="workspace-menu" :style="menuStyle" @click.stop>
        <section class="popup-section">
          <div class="popup-section-title">
            <MdAutoStories class="menu-icon" aria-hidden="true" />世界书
          </div>
          <select class="popup-select" :disabled="availableLoreBooks.length === 0" aria-label="添加世界书"
            @change="addLoreBook">
            <option value="">添加世界书</option>
            <option v-for="book in availableLoreBooks" :key="book.id" :value="book.id">{{ book.name }}</option>
          </select>
          <div class="ordered-list">
            <div v-for="(book, index) in selectedLoreBooks" :key="book.id" class="ordered-row">
              <span>{{ book.name }}</span>
              <div class="row-actions">
                <button class="icon-button compact" type="button" :disabled="index === 0"
                  :aria-label="`上移 ${book.name}`" data-tooltip="上移" @click="moveLoreBook(book.id, -1)">
                  <MdKeyboardArrowUp class="menu-icon" aria-hidden="true" />
                </button>
                <button class="icon-button compact" type="button" :disabled="index === selectedLoreBooks.length - 1"
                  :aria-label="`下移 ${book.name}`" data-tooltip="下移" @click="moveLoreBook(book.id, 1)">
                  <MdKeyboardArrowDown class="menu-icon" aria-hidden="true" />
                </button>
                <button class="icon-button compact" type="button" :aria-label="`移除 ${book.name}`" data-tooltip="移除"
                  @click="removeLoreBook(book.id)">
                  <MdClose class="menu-icon" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div v-if="selectedLoreBooks.length === 0" class="empty-row">未绑定世界书</div>
          </div>
        </section>

        <section class="popup-section">
          <button type="button" @click="showGenerationPreview">
            <MdVisibility class="menu-icon" aria-hidden="true" />查看将要发送的上下文
          </button>
          <button class="danger-menu-item" type="button" @click="deleteCurrentChat">
            <MdDeleteOutline class="menu-icon" aria-hidden="true" />删除聊天
          </button>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="replyPanelOpen" ref="replyPanelRef" class="reply-panel" :style="replyPanelStyle" @click.stop>
        <section class="popup-section">
          <div class="popup-section-title">
            <MdPerson class="menu-icon" aria-hidden="true" />角色卡
          </div>
          <button class="choice-row" type="button" :class="{ selected: chat.runtimeConfig.characterId === null }"
            @click="selectReplyCharacter(null)">
            <span>无角色</span>
          </button>
          <button v-for="character in characters" :key="character.id" class="choice-row" type="button"
            :class="{ selected: chat.runtimeConfig.characterId === character.id }"
            @click="selectReplyCharacter(character.id)">
            <span>{{ characterName(character) }}</span>
          </button>
        </section>

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
  overflow-y: hidden;
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

.md3-pill-button:disabled,
.md3-pill-combo-trigger:disabled {
  cursor: default;
  opacity: 0.5;
}

.md3-pill-button:focus-visible,
.md3-pill-combo-trigger:focus-visible {
  outline: 2px solid #446bd7;
  outline-offset: 2px;
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

.workspace-menu button:disabled,
.reply-panel button:disabled {
  cursor: default;
  opacity: 0.45;
}

.popup-section {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.popup-section + .popup-section {
  border-top: 1px solid #edf0f4;
  padding-top: 8px;
}

.popup-section-title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  color: #465469;
  font-size: 12px;
  font-weight: 700;
}

.popup-select {
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

.ordered-row,
.choice-row {
  min-width: 0;
  display: flex !important;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid #e1e7ef !important;
  border-radius: 7px !important;
  background: #fbfcfd !important;
  padding: 7px 8px !important;
}

.ordered-row span,
.choice-row span {
  min-width: 0;
  overflow: hidden;
  color: #303a49;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.choice-row.selected {
  border-color: #2f6fca !important;
  background: #f4f8ff !important;
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
  justify-content: center;
  padding: 0 !important;
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

.danger-menu-item {
  color: #9d2c2c !important;
}

.menu-icon {
  width: 17px;
  height: 17px;
  flex-shrink: 0;
}
</style>
