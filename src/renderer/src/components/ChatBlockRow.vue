<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type ComponentPublicInstance } from 'vue'
import {
  MdCheck,
  MdClose,
  MdCode,
  MdDeleteOutline,
  MdKeyboardArrowDown,
  MdKeyboardArrowUp,
  MdMoreVert,
  MdReplay,
  MdStop,
  MdVisibility,
  MdVisibilityOff
} from 'vue-icons-plus/md'
import { chatBlockSummary, chatBlockTargetRole, chatBlockTitle } from '../../../shared/chat-blocks'
import type {
  ChatBlock,
  ChatGenerationPreviewMessage,
  ChatGenerationRequest
} from '../../../shared/types'
import AssistantBlockBody from './chat-blocks/AssistantBlockBody.vue'
import InjectionBlockBody from './chat-blocks/InjectionBlockBody.vue'
import SystemUserBlockBody from './chat-blocks/SystemUserBlockBody.vue'
import JsonDialog from './JsonDialog.vue'

const props = defineProps<{
  block: ChatBlock
  collapsed: boolean
  frozen: boolean
  previewChatGeneration: (payload: ChatGenerationRequest) => Promise<ChatGenerationPreviewMessage[] | null>
  sourceBlock?: ChatBlock
}>()

const emit = defineEmits<{
  save: [block: ChatBlock]
  delete: [block: ChatBlock]
  'collapse-change': [collapsed: boolean]
  regenerate: [block: ChatBlock]
  stop: [chatId: number]
}>()

const editing = ref(false)
const draft = ref('')
const detailOpen = ref(false)
const llmViewOpen = ref(false)
const llmViewMessages = ref<Array<Omit<ChatGenerationPreviewMessage, 'blockId'>>>([])
const menuOpen = ref(false)
const isCollapsed = ref(props.collapsed)
const editingPartIndex = ref<number | null>(null)
const editorRef = ref<HTMLTextAreaElement | null>(null)
const menuButtonRef = ref<HTMLButtonElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})

const sourceBlock = computed(() => props.sourceBlock ?? props.block)
const text = computed(() => sourceBlock.value.contentParts.filter(part => part.type === 'text').map(part => part.text).join(''))
const displayText = computed(() => props.block.contentParts.filter(part => part.type === 'text').map(part => part.text).join(''))
const isVirtual = computed(() => props.block.metadata.virtual === true)
const numberFormatter = new Intl.NumberFormat()
const targetRole = computed(() => chatBlockTargetRole(props.block))
const roleLabel = computed(() => {
  if (props.block.kind === 'system') return 'system'
  if (props.block.kind === 'assistant') return 'assistant'
  if (props.block.kind === 'injection') return `injection → ${targetRole.value}`
  return 'user'
})
const statusLabel = computed(() => {
  if (props.block.status === 'generating') return '生成中'
  if (props.block.status === 'stopped') return '已停止'
  if (props.block.status === 'error') return '生成失败'
  if (!props.block.enabled) return '不发送'
  return ''
})
const sentAtLabel = computed(() => formatDateTime(props.block.createdAt))
const tokenCount = computed(() => tokenCountFromUsage(props.block.metadata.usage))
const tokenLabel = computed(() => tokenCount.value === null ? 'Token -' : `${numberFormatter.format(tokenCount.value)} tokens`)
const headerTitle = computed(() => chatBlockTitle(props.block) || roleLabel.value)
const blockSubMeta = computed(() => [
  chatBlockSummary(props.block),
  isVirtual.value ? '虚拟注入' : statusLabel.value,
  sentAtLabel.value,
  isVirtual.value ? '' : tokenLabel.value
].filter(Boolean).join(' · '))
const canEdit = computed(() => !props.frozen && sourceBlock.value.status !== 'generating' && !isVirtual.value)
const detailJson = computed(() => ({
  id: props.block.id,
  kind: props.block.kind,
  targetRole: targetRole.value,
  enabled: props.block.enabled,
  status: props.block.status,
  llmInstanceSnapshot: props.block.llmInstanceSnapshot,
  errorText: props.block.errorText,
  content: text.value,
  renderedContent: displayText.value,
  sourceBlock: props.sourceBlock ? sourceBlock.value : null,
  displayBlock: props.sourceBlock ? props.block : null,
  contentParts: props.block.contentParts,
  metadata: props.block.metadata
}))

watch(() => props.block.id, () => {
  editing.value = false
  editingPartIndex.value = null
  menuOpen.value = false
  isCollapsed.value = props.collapsed
  draft.value = text.value
})

watch(() => props.collapsed, (value) => {
  isCollapsed.value = value
})

watch(text, (value) => {
  if (!editing.value) draft.value = value
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

onBeforeUnmount(() => {
  removeMenuListeners()
})

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
  const width = 180
  const gap = 6
  const margin = 8
  const height = menuRef.value?.offsetHeight ?? 244
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

function numberFromMetadata(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function recordFromMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function tokenCountFromUsage(value: unknown): number | null {
  const usage = recordFromMetadata(value)
  const total = numberFromMetadata(usage.totalTokens)
  if (total !== null) return total

  const input = numberFromMetadata(usage.inputTokens)
  const output = numberFromMetadata(usage.outputTokens)
  if (input !== null && output !== null) return input + output
  return output ?? input
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString()
}

function setEditorElement(element: Element | ComponentPublicInstance | null) {
  editorRef.value = element instanceof HTMLTextAreaElement ? element : null
}

function firstTextPartIndex(): number {
  const index = sourceBlock.value.contentParts.findIndex(part => part.type === 'text')
  return index >= 0 ? index : sourceBlock.value.contentParts.length
}

function startEdit(partIndex = firstTextPartIndex()) {
  if (!canEdit.value) return
  const part = sourceBlock.value.contentParts[partIndex]
  draft.value = part?.type === 'text' ? part.text : ''
  editingPartIndex.value = partIndex
  setCollapsed(false)
  editing.value = true
  menuOpen.value = false
  nextTick(() => editorRef.value?.focus())
}

function cancelEdit() {
  draft.value = text.value
  editing.value = false
  editingPartIndex.value = null
  menuOpen.value = false
  if (isEmptyChatBlock(sourceBlock.value)) {
    emit('delete', sourceBlock.value)
  }
}

function editedBlock(): ChatBlock {
  const next = JSON.parse(JSON.stringify(sourceBlock.value)) as ChatBlock
  const partIndex = editingPartIndex.value ?? firstTextPartIndex()
  if (next.contentParts[partIndex]?.type === 'text') {
    next.contentParts[partIndex] = { type: 'text', text: draft.value }
  } else {
    next.contentParts.splice(partIndex, 0, { type: 'text', text: draft.value })
  }
  return next
}

function commitEdit(): ChatBlock | null {
  if (!editing.value) return null
  const next = editedBlock()
  editing.value = false
  editingPartIndex.value = null
  menuOpen.value = false
  return next
}

function saveEdit() {
  const next = commitEdit()
  if (!next) return
  if (isEmptyChatBlock(next)) {
    emit('delete', sourceBlock.value)
    return
  }
  emit('save', next)
}

function autoSaveEdit() {
  if (!editing.value) return
  saveEdit()
}

function isEmptyChatBlock(block: ChatBlock): boolean {
  return block.contentParts.every(part => {
    if (part.type === 'tool_call') return false
    return part.text.trim().length === 0
  })
}

function toggleEnabled() {
  if (!canEdit.value) return
  const next = JSON.parse(JSON.stringify(sourceBlock.value)) as ChatBlock
  next.enabled = !next.enabled
  menuOpen.value = false
  emit('save', next)
}

function saveBodyBlock(block: ChatBlock) {
  emit('save', block)
}

function regenerate() {
  if (isVirtual.value) return
  menuOpen.value = false
  emit('regenerate', sourceBlock.value)
}

function stop() {
  menuOpen.value = false
  emit('stop', sourceBlock.value.chatId)
}

function remove() {
  if (!canEdit.value) return
  menuOpen.value = false
  emit('delete', sourceBlock.value)
}

function openDetails() {
  menuOpen.value = false
  detailOpen.value = true
}

async function openLlmView() {
  menuOpen.value = false
  const messages = await props.previewChatGeneration({ chatId: sourceBlock.value.chatId })
  if (!messages) return
  llmViewMessages.value = messages
    .filter(message => message.blockId === sourceBlock.value.id)
    .map(message => ({
      role: message.role,
      content: message.content
    }))
  llmViewOpen.value = true
}

function toggleCollapsed() {
  if (editing.value) return
  setCollapsed(!isCollapsed.value)
}

function setCollapsed(value: boolean) {
  isCollapsed.value = value
  emit('collapse-change', value)
}

defineExpose({
  commitEdit,
  startEdit
})
</script>

<template>
  <article class="chat-block" :class="[block.kind, block.status, { disabled: !block.enabled, collapsed: isCollapsed }]">
    <header class="chat-block-header">
      <div class="block-meta">
        <strong>{{ headerTitle }}</strong>
        <span>{{ blockSubMeta }}</span>
      </div>

      <div class="block-actions">
        <button class="toolbar-button" type="button" :aria-label="isCollapsed ? '展开块' : '折叠块'"
          :data-tooltip="isCollapsed ? '展开' : '折叠'" :disabled="editing" @click="toggleCollapsed">
          <component :is="isCollapsed ? MdKeyboardArrowDown : MdKeyboardArrowUp" class="toolbar-icon"
            aria-hidden="true" />
        </button>
        <button ref="menuButtonRef" class="toolbar-button" type="button" aria-label="更多操作" data-tooltip="更多操作"
          @click.stop="toggleMenu">
          <MdMoreVert class="toolbar-icon" aria-hidden="true" />
        </button>
      </div>
    </header>

    <template v-if="!isCollapsed">
      <InjectionBlockBody
        v-if="block.kind === 'injection'"
        v-model:draft="draft"
        :block="block"
        :display-text="displayText"
        :editing="editing"
        @auto-save-edit="autoSaveEdit"
        @editor-ref="setEditorElement"
      />
      <AssistantBlockBody
        v-else-if="block.kind === 'assistant'"
        v-model:draft="draft"
        :block="block"
        :can-edit="canEdit"
        :editing="editing"
        :editing-part-index="editingPartIndex"
        :source-block="sourceBlock"
        @auto-save-edit="autoSaveEdit"
        @editor-ref="setEditorElement"
        @save="saveBodyBlock"
        @start-edit="startEdit"
      />
      <SystemUserBlockBody
        v-else
        v-model:draft="draft"
        :block="block"
        :can-edit="canEdit"
        :editing="editing"
        :editing-part-index="editingPartIndex"
        :source-block="sourceBlock"
        @auto-save-edit="autoSaveEdit"
        @editor-ref="setEditorElement"
        @start-edit="startEdit"
      />
    </template>

    <footer v-if="!isCollapsed && block.errorText" class="block-footer">
      <button v-if="block.errorText" type="button" class="error-detail" @click="detailOpen = true">错误详情</button>
    </footer>

    <JsonDialog v-if="detailOpen" title="块详情" :value="detailJson" @close="detailOpen = false" />

    <Teleport to="body">
      <div v-if="menuOpen" ref="menuRef" class="block-menu" :style="menuStyle" @click.stop>
        <button v-if="editing" type="button" @click="saveEdit">
          <MdCheck class="menu-icon" aria-hidden="true" />保存
        </button>
        <button v-if="editing" type="button" @click="cancelEdit">
          <MdClose class="menu-icon" aria-hidden="true" />取消
        </button>
        <button v-if="block.status === 'generating'" type="button" @click="stop">
          <MdStop class="menu-icon" aria-hidden="true" />停止
        </button>
        <button v-if="!editing && !isVirtual" type="button" :disabled="!canEdit" @click="toggleEnabled">
          <component :is="block.enabled ? MdVisibilityOff : MdVisibility" class="menu-icon" aria-hidden="true" />
          {{ block.enabled ? '禁用' : '启用' }}
        </button>
        <button v-if="block.kind === 'assistant' && block.status !== 'generating'" type="button" :disabled="frozen"
          @click="regenerate">
          <MdReplay class="menu-icon" aria-hidden="true" />重新生成
        </button>
        <button type="button" @click="openDetails">
          <MdVisibility class="menu-icon" aria-hidden="true" />详情
        </button>
        <button type="button" @click="openLlmView">
          <MdCode class="menu-icon" aria-hidden="true" />LLM 视角
        </button>
        <button v-if="!isVirtual" class="danger-menu-item" type="button" :disabled="!canEdit" @click="remove">
          <MdDeleteOutline class="menu-icon" aria-hidden="true" />删除
        </button>
      </div>
    </Teleport>
  </article>

  <JsonDialog v-if="llmViewOpen" title="LLM 视角" :value="llmViewMessages" @close="llmViewOpen = false" />
</template>

<style scoped>
.chat-block {
  --chat-block-content-inset: 72px;
  min-width: 0;
  max-width: 100%;
  display: grid;
  gap: 8px;
  overflow: visible;
  border-bottom: 1px solid #edf0f4;
  padding: 6px 12px;
  background: #ffffff;
}

.chat-block.disabled {
  opacity: 0.58;
}

.chat-block.system {
  background: #fbfcfd;
}

.chat-block.injection {
  background: #fffdf7;
}

.chat-block.error {
  background: #fff8f8;
}

.chat-block.collapsed {
  gap: 0;
}

.chat-block-header,
.block-footer {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.block-meta {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.block-meta strong {
  min-width: 0;
  color: #273245;
  font-size: 12px;
  line-height: 1.2;
}

.block-footer button {
  color: #6b7583;
  font-size: 12px;
}

.block-meta span {
  min-width: 0;
  overflow: hidden;
  color: #7a8594;
  font-size: 11px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.block-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.block-menu {
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

.block-menu button {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #303a49;
  padding: 7px 8px;
  text-align: left;
  font-size: 12px;
}

.block-menu button:hover:not(:disabled) {
  background: #f1f5fa;
}

.block-menu button:disabled {
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

.block-footer {
  justify-content: flex-start;
  margin-inline: var(--chat-block-content-inset);
}

.block-footer button {
  border: 1px solid #d8dee7;
  border-radius: 7px;
  background: #ffffff;
  padding: 4px 7px;
}

.error-detail {
  color: #9d2c2c !important;
}
</style>
