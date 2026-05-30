<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  MdCheck,
  MdClose,
  MdCode,
  MdDeleteOutline,
  MdEdit,
  MdFormatListBulleted,
  MdLibraryAdd,
  MdKeyboardArrowDown,
  MdKeyboardArrowUp,
  MdMoreVert,
  MdPsychology,
  MdReplay,
  MdStop,
  MdVisibility,
  MdVisibilityOff
} from 'vue-icons-plus/md'
import { LOREBOOK_EDIT_TOOL_GROUP, defaultLoreBookEditPrompt } from '../../../shared/lorebook-tooling'
import type { InjectionDetail } from '../../../shared/st-prompt-builder'
import type { ChatBlock, LoreBook } from '../../../shared/types'
import JsonDialog from './JsonDialog.vue'
import MarkdownView from './MarkdownView.vue'

type InjectionViewMode = 'markdown' | 'structured'

const props = defineProps<{
  block: ChatBlock
  collapsed: boolean
  frozen: boolean
  loreBooks: LoreBook[]
}>()

const emit = defineEmits<{
  save: [block: ChatBlock]
  delete: [block: ChatBlock]
  'collapse-change': [collapsed: boolean]
  regenerate: [block: ChatBlock]
  stop: [chatId: number]
  'insert-tool-definition': [block: ChatBlock, placement: 'before' | 'after']
}>()

const editing = ref(false)
const draft = ref('')
const detailOpen = ref(false)
const menuOpen = ref(false)
const isCollapsed = ref(props.collapsed)
const injectionViewMode = ref<InjectionViewMode>('structured')
const reasoningOpen = ref(false)
const editorRef = ref<HTMLTextAreaElement | null>(null)
const menuButtonRef = ref<HTMLButtonElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})

const text = computed(() => props.block.contentParts.filter(part => part.type === 'text').map(part => part.text).join(''))
const reasoningText = computed(() => props.block.contentParts.filter(part => part.type === 'reasoning').map(part => part.text).join(''))
const hasReasoning = computed(() => reasoningText.value.trim().length > 0)
const sendsReasoning = computed(() => props.block.metadata.sendReasoning === true)
const isVirtual = computed(() => props.block.metadata.virtual === true)
const isInjection = computed(() => props.block.kind === 'injection')
const isToolDefinition = computed(() => props.block.kind === 'tool_definition')
const isToolCall = computed(() => props.block.kind === 'tool_call')
const numberFormatter = new Intl.NumberFormat()
const roleLabel = computed(() => {
  if (props.block.kind === 'system') return 'system'
  if (props.block.kind === 'assistant') return 'assistant'
  if (props.block.kind === 'injection') return `injection → ${props.block.targetRole}`
  if (props.block.kind === 'tool_definition') return 'tool definition'
  if (props.block.kind === 'tool_call') return 'tool call'
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
const headerTitle = computed(() => props.block.title.trim() || roleLabel.value)
const blockSubMeta = computed(() => [
  props.block.summary,
  isVirtual.value ? '虚拟注入' : statusLabel.value,
  sentAtLabel.value,
  isVirtual.value ? '' : tokenLabel.value
].filter(Boolean).join(' · '))
const isEmptySystem = computed(() => props.block.kind === 'system' && text.value.trim().length === 0)
const canEdit = computed(() => !props.frozen && props.block.status !== 'generating' && !isVirtual.value && !isToolCall.value)
const showMarkdown = computed(() => !isCollapsed.value && !editing.value && !isEmptySystem.value && props.block.kind !== 'injection')
const toolDefinition = computed(() => recordFromMetadata(props.block.metadata.toolDefinition))
const toolDefinitionLoreBookId = computed(() => numberFromMetadata(toolDefinition.value.loreBookId))
const selectedToolLoreBook = computed(() => {
  const id = toolDefinitionLoreBookId.value
  return id === null ? null : props.loreBooks.find(book => book.id === id) ?? null
})
const injectionDetails = computed(() => {
  const raw = props.block.metadata.injectionDetails
  if (!Array.isArray(raw)) return []
  return raw.map(injectionDetailFromMetadata).filter((detail): detail is InjectionDetail => detail !== null)
})
const hasInjectionDetails = computed(() => injectionDetails.value.length > 0)
const currentInjectionViewMode = computed<InjectionViewMode>(() => (
  injectionViewMode.value === 'structured' && hasInjectionDetails.value ? 'structured' : 'markdown'
))
const detailJson = computed(() => ({
  id: props.block.id,
  kind: props.block.kind,
  targetRole: props.block.targetRole,
  enabled: props.block.enabled,
  status: props.block.status,
  requestBlockIds: props.block.requestBlockIds,
  sendReasoning: props.block.metadata.sendReasoning === true,
  llmInstanceSnapshot: props.block.llmInstanceSnapshot,
  errorText: props.block.errorText,
  content: text.value,
  metadata: props.block.metadata
}))

watch(() => props.block.id, () => {
  editing.value = false
  menuOpen.value = false
  isCollapsed.value = props.collapsed
  injectionViewMode.value = 'structured'
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

function stringFromMetadata(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function optionalNumberFromMetadata(value: unknown): number | undefined {
  return numberFromMetadata(value) ?? undefined
}

function injectionDetailFromMetadata(value: unknown): InjectionDetail | null {
  const record = recordFromMetadata(value)
  const content = stringFromMetadata(record.content).trim()
  if (!content) return null
  return {
    title: stringFromMetadata(record.title, '注入内容'),
    source: record.source === 'worldInfo' ? 'worldInfo' : 'character',
    sourceName: stringFromMetadata(record.sourceName, '未知来源'),
    reason: stringFromMetadata(record.reason, '未记录原因'),
    content,
    entryId: optionalNumberFromMetadata(record.entryId),
    loreBookId: optionalNumberFromMetadata(record.loreBookId)
  }
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

function startEdit() {
  if (!canEdit.value) return
  draft.value = text.value
  setCollapsed(false)
  editing.value = true
  menuOpen.value = false
  nextTick(() => editorRef.value?.focus())
}

function cancelEdit() {
  draft.value = text.value
  editing.value = false
  menuOpen.value = false
}

function editedBlock(): ChatBlock {
  const next = JSON.parse(JSON.stringify(props.block)) as ChatBlock
  const reasoningParts = next.contentParts.filter(part => part.type === 'reasoning')
  next.contentParts = [...reasoningParts, { type: 'text', text: draft.value }]
  return next
}

function commitEdit(): ChatBlock | null {
  if (!editing.value) return null
  const next = editedBlock()
  editing.value = false
  menuOpen.value = false
  return next
}

function saveEdit() {
  const next = commitEdit()
  if (!next) return
  emit('save', next)
}

function toggleEnabled() {
  if (!canEdit.value) return
  const next = JSON.parse(JSON.stringify(props.block)) as ChatBlock
  next.enabled = !next.enabled
  menuOpen.value = false
  emit('save', next)
}

function toggleSendReasoning() {
  if (!canEdit.value) return
  const next = JSON.parse(JSON.stringify(props.block)) as ChatBlock
  next.metadata = {
    ...next.metadata,
    sendReasoning: next.metadata.sendReasoning !== true
  }
  menuOpen.value = false
  emit('save', next)
}

function nextToolSessionId(): string {
  const randomId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `lorebook-edit-${randomId}`
}

function updateToolTargetLine(value: string, loreBook: LoreBook | null): string {
  const targetLine = loreBook
    ? `当前绑定世界书：${loreBook.name}（ID ${loreBook.id}）。`
    : '当前工具定义块尚未绑定世界书。'
  if (!value.trim()) return defaultLoreBookEditPrompt(loreBook)
  const pattern = /当前绑定世界书：.*?。\n?|当前工具定义块尚未绑定世界书。\n?/
  return pattern.test(value) ? value.replace(pattern, `${targetLine}\n`) : value
}

function updateToolLoreBook(event: Event) {
  if (!canEdit.value) return
  const value = (event.target as HTMLSelectElement).value
  const loreBookId = value ? Number(value) : null
  const loreBook = loreBookId === null ? null : props.loreBooks.find(book => book.id === loreBookId) ?? null
  const currentDefinition = toolDefinition.value
  const next = JSON.parse(JSON.stringify(props.block)) as ChatBlock
  next.metadata = {
    ...next.metadata,
    toolDefinition: {
      ...currentDefinition,
      group: LOREBOOK_EDIT_TOOL_GROUP,
      toolSessionId: stringFromMetadata(currentDefinition.toolSessionId) || stringFromMetadata(currentDefinition.id) || nextToolSessionId(),
      loreBookId: loreBook?.id ?? null
    }
  }
  next.contentParts = [{ type: 'text', text: updateToolTargetLine(text.value, loreBook) }]
  emit('save', next)
}

function regenerate() {
  if (isVirtual.value) return
  menuOpen.value = false
  emit('regenerate', props.block)
}

function stop() {
  menuOpen.value = false
  emit('stop', props.block.chatId)
}

function remove() {
  if (!canEdit.value) return
  menuOpen.value = false
  emit('delete', props.block)
}

function insertToolDefinition(placement: 'before' | 'after') {
  if (props.frozen || isVirtual.value) return
  menuOpen.value = false
  emit('insert-tool-definition', props.block, placement)
}

function openDetails() {
  menuOpen.value = false
  detailOpen.value = true
}

function toggleCollapsed() {
  if (editing.value) return
  setCollapsed(!isCollapsed.value)
}

function switchInjectionViewMode(mode: InjectionViewMode) {
  injectionViewMode.value = mode
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
          <component :is="isCollapsed ? MdKeyboardArrowDown : MdKeyboardArrowUp" class="toolbar-icon" aria-hidden="true" />
        </button>
        <button ref="menuButtonRef" class="toolbar-button" type="button" aria-label="更多操作" data-tooltip="更多操作"
          @click.stop="toggleMenu">
          <MdMoreVert class="toolbar-icon" aria-hidden="true" />
        </button>
      </div>
    </header>

    <textarea v-if="editing" ref="editorRef" v-model="draft" class="block-editor" rows="6" />
    <template v-else-if="!isCollapsed">
      <button v-if="isEmptySystem" class="system-hint" type="button" :disabled="!canEdit" @click="startEdit">
        点击可输入系统提示词
      </button>

      <div v-else-if="isInjection" class="injection-body">
        <div class="injection-mode-tabs" aria-label="注入内容展示方式">
          <button type="button" :class="{ selected: currentInjectionViewMode === 'markdown' }"
            @click="switchInjectionViewMode('markdown')">
            <MdCode class="tab-icon" aria-hidden="true" />Markdown
          </button>
          <button type="button" :disabled="!hasInjectionDetails"
            :class="{ selected: currentInjectionViewMode === 'structured' }"
            @click="switchInjectionViewMode('structured')">
            <MdFormatListBulleted class="tab-icon" aria-hidden="true" />结构
          </button>
        </div>

        <div v-if="currentInjectionViewMode === 'markdown'" class="block-content injection-markdown">
          <MarkdownView :markdown="text" />
        </div>

        <div v-else class="injection-detail-list">
          <section v-for="(detail, index) in injectionDetails" :key="`${detail.source}-${detail.entryId ?? index}`"
            class="injection-detail-item">
            <header>
              <strong>{{ detail.title }}</strong>
              <span>{{ detail.sourceName }}</span>
            </header>
            <p>{{ detail.reason }}</p>
            <pre>{{ detail.content }}</pre>
          </section>
        </div>
      </div>

      <div v-else-if="isToolDefinition" class="tool-definition-body">
        <label class="tool-definition-selector">
          <span>绑定世界书</span>
          <select :value="toolDefinitionLoreBookId ?? ''" :disabled="!canEdit" @change="updateToolLoreBook">
            <option value="">未选择世界书</option>
            <option v-for="book in loreBooks" :key="book.id" :value="book.id">{{ book.name }}</option>
          </select>
        </label>
        <p v-if="selectedToolLoreBook" class="tool-definition-note">世界书编辑工具组已绑定：{{ selectedToolLoreBook.name }}</p>
        <p v-else class="tool-definition-note invalid">未绑定有效世界书时，此工具定义不会发送给 LLM。</p>
        <div class="block-content tool-definition-prompt">
          <MarkdownView :markdown="text" />
        </div>
      </div>

      <div v-else-if="showMarkdown" class="block-content">
        <section v-if="hasReasoning" class="reasoning-panel">
          <button class="reasoning-toggle" type="button" @click="reasoningOpen = !reasoningOpen">
            <MdPsychology class="reasoning-icon" aria-hidden="true" />
            <span>思考</span>
            <small @click="toggleSendReasoning">{{ sendsReasoning ? '作为上下文' : '不作为上下文' }}</small>
          </button>
          <div v-if="reasoningOpen" class="reasoning-body">
            <MarkdownView :markdown="reasoningText" />
          </div>
        </section>
        <MarkdownView :markdown="text" />
      </div>
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
        <button v-if="!editing && !isVirtual" type="button" :disabled="!canEdit" @click="startEdit">
          <MdEdit class="menu-icon" aria-hidden="true" />编辑
        </button>
        <button v-if="!editing && !isVirtual" type="button" :disabled="frozen" @click="insertToolDefinition('before')">
          <MdLibraryAdd class="menu-icon" aria-hidden="true" />上方插入工具
        </button>
        <button v-if="!editing && !isVirtual" type="button" :disabled="frozen" @click="insertToolDefinition('after')">
          <MdLibraryAdd class="menu-icon" aria-hidden="true" />下方插入工具
        </button>
        <button type="button" @click="openDetails">
          <MdVisibility class="menu-icon" aria-hidden="true" />详情
        </button>
        <button v-if="!isVirtual" class="danger-menu-item" type="button" :disabled="!canEdit" @click="remove">
          <MdDeleteOutline class="menu-icon" aria-hidden="true" />删除
        </button>
      </div>
    </Teleport>
  </article>
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
  padding: 12px 14px;
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

.chat-block.tool_definition {
  background: #f7fbff;
}

.chat-block.tool_call {
  background: #fbfaf7;
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
  text-transform: uppercase;
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

.block-editor {
  display: block;
  width: auto;
  margin-inline: var(--chat-block-content-inset);
  min-height: 130px;
}

.block-content {
  margin-inline: var(--chat-block-content-inset);
  min-width: 0;
  display: grid;
  gap: 8px;
}

.reasoning-panel {
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  border: 1px solid #dbe2ec;
  border-radius: 8px;
  background: #fbfcfd;
}

.reasoning-toggle {
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  border: 0;
  background: transparent;
  color: #526173;
  padding: 8px 10px;
  text-align: left;
}

.reasoning-toggle span {
  color: #334052;
  font-size: 13px;
  font-weight: 600;
}

.reasoning-toggle small {
  margin-left: auto;
  color: #7a8797;
  font-size: 12px;
}

.reasoning-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.reasoning-body {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  border-top: 1px solid #e4e9f0;
  padding: 10px;
  color: #4e5d70;
}

.system-hint,
.injection-body,
.tool-definition-body {
  width: auto;
  margin-inline: var(--chat-block-content-inset);
}

.system-hint {
  border: 1px dashed #cdd6e2;
  border-radius: 8px;
  background: transparent;
  color: #6b7583;
  padding: 14px;
  text-align: left;
}

.injection-body {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.tool-definition-body {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.tool-definition-selector {
  width: min(420px, 100%);
  min-width: 0;
  display: grid;
  gap: 5px;
}

.tool-definition-selector span {
  color: #526173;
  font-size: 12px;
  font-weight: 600;
}

.tool-definition-note {
  margin: 0;
  color: #526173;
  font-size: 12px;
}

.tool-definition-note.invalid {
  color: #9d2c2c;
}

.tool-definition-prompt {
  margin-inline: 0;
  border: 1px solid #dce6f2;
  border-radius: 8px;
  background: #ffffff;
  padding: 10px;
}

.injection-mode-tabs {
  width: fit-content;
  min-width: 0;
  display: inline-flex;
  overflow: hidden;
  border: 1px solid #d8dee7;
  border-radius: 8px;
  background: #ffffff;
}

.injection-mode-tabs button {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  border-right: 1px solid #e1e7ef;
  background: transparent;
  color: #526173;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 600;
}

.injection-mode-tabs button:last-child {
  border-right: 0;
}

.injection-mode-tabs button:hover:not(:disabled),
.injection-mode-tabs button.selected {
  background: #f4f8ff;
  color: #174f99;
}

.injection-mode-tabs button:disabled {
  cursor: default;
  opacity: 0.45;
}

.tab-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.injection-markdown {
  margin-inline: 0;
}

.injection-detail-list {
  min-width: 0;
  display: grid;
  gap: 8px;
}

.injection-detail-item {
  min-width: 0;
  display: grid;
  gap: 6px;
  border: 1px solid #e2d7b8;
  border-radius: 8px;
  background: #fffefa;
  padding: 10px;
}

.injection-detail-item header {
  min-width: 0;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.injection-detail-item strong,
.injection-detail-item span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.injection-detail-item strong {
  color: #4b3b12;
  font-size: 13px;
}

.injection-detail-item span {
  color: #7a6b43;
  font-size: 12px;
}

.injection-detail-item p {
  margin: 0;
  color: #657085;
  font-size: 12px;
  line-height: 1.45;
}

.injection-detail-item pre {
  max-height: 360px;
  overflow: auto;
  margin: 0;
  border-radius: 7px;
  background: #fbf7ec;
  color: #303a49;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  padding: 9px;
  white-space: pre-wrap;
  word-break: break-word;
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
