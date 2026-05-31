<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type ComponentPublicInstance } from 'vue'
import {
  MdCheck,
  MdClose,
  MdCode,
  MdDeleteOutline,
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
import { chatBlockSummary, chatBlockTargetRole, chatBlockTitle } from '../../../shared/chat-blocks'
import type {
  ChatBlock,
  ChatContentPart,
  ChatGenerationPreviewMessage,
  ChatGenerationRequest,
  PluginDescriptor,
  ReasoningContentPart,
  ToolCallContentPart
} from '../../../shared/types'
import JsonDialog from './JsonDialog.vue'
import MarkdownView from './MarkdownView.vue'
import PluginFrame from './PluginFrame.vue'

interface InjectionDetail {
  title: string
  source: string
  sourceName: string
  reason: string
  content: string
  entryId?: number
  loreBookId?: number
}

const props = defineProps<{
  block: ChatBlock
  collapsed: boolean
  frozen: boolean
  plugins: PluginDescriptor[]
  previewChatGeneration: (payload: ChatGenerationRequest) => Promise<ChatGenerationPreviewMessage[] | null>
  sourceBlock?: ChatBlock
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
const llmViewOpen = ref(false)
const llmViewMessages = ref<Array<Omit<ChatGenerationPreviewMessage, 'blockId'>>>([])
const menuOpen = ref(false)
const isCollapsed = ref(props.collapsed)
const editingPartIndex = ref<number | null>(null)
const openReasoningParts = ref<Record<number, boolean>>({})
const openToolCalls = ref<Record<string, boolean>>({})
const editorRef = ref<HTMLTextAreaElement | null>(null)
const menuButtonRef = ref<HTMLButtonElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})

const sourceBlock = computed(() => props.sourceBlock ?? props.block)
const text = computed(() => sourceBlock.value.contentParts.filter(part => part.type === 'text').map(part => part.text).join(''))
const displayContentParts = computed(() => props.block.contentParts)
const displayText = computed(() => displayContentParts.value.filter(part => part.type === 'text').map(part => part.text).join(''))
const isVirtual = computed(() => props.block.metadata.virtual === true)
const isInjection = computed(() => props.block.kind === 'injection')
const isToolDefinition = computed(() => props.block.kind === 'tool_definition')
const numberFormatter = new Intl.NumberFormat()
const targetRole = computed(() => chatBlockTargetRole(props.block))
const roleLabel = computed(() => {
  if (props.block.kind === 'system') return 'system'
  if (props.block.kind === 'assistant') return 'assistant'
  if (props.block.kind === 'injection') return `injection → ${targetRole.value}`
  if (props.block.kind === 'tool_definition') return 'tool definition'
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
const showMarkdown = computed(() => !isCollapsed.value && props.block.kind !== 'injection')
const toolDefinition = computed(() => recordFromMetadata(props.block.metadata.toolDefinition))
const toolDefinitionPluginId = computed(() => stringFromMetadata(toolDefinition.value.pluginId))
const toolDefinitionToolCallName = computed(() => stringFromMetadata(toolDefinition.value.toolCallName))
const selectedToolPlugin = computed(() => props.plugins.find(plugin => plugin.manifest.id === toolDefinitionPluginId.value) ?? null)
const selectedToolCall = computed(() => (
  selectedToolPlugin.value?.manifest.entry?.toolCalls?.find(toolCall => toolCall.name === toolDefinitionToolCallName.value) ?? null
))
const selectedToolCommonArgs = computed(() => recordFromMetadata(toolDefinition.value.commonArgs))
const selectedToolSettingsHtml = computed(() => selectedToolCall.value?.settingsHtml ?? '')
const selectedToolLabel = computed(() => selectedToolCall.value?.label || selectedToolCall.value?.name || '工具调用')
const selectedToolPluginLabel = computed(() => selectedToolPlugin.value?.manifest.name || selectedToolPlugin.value?.manifest.id || '未知插件')
const selectedToolNames = computed(() => selectedToolCall.value?.tools?.map(tool => tool.name).join(', ') || '')
const injectionDetails = computed(() => {
  const raw = props.block.metadata.injectionDetails
  if (!Array.isArray(raw)) return []
  return raw.map(injectionDetailFromMetadata).filter((detail): detail is InjectionDetail => detail !== null)
})
const hasInjectionDetails = computed(() => injectionDetails.value.length > 0)
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
const visibleContentParts = computed(() => displayContentParts.value
  .map((part, index) => ({ part, index }))
  .filter(item => item.part.type !== 'reasoning' || item.part.text.trim().length > 0))

watch(() => props.block.id, () => {
  editing.value = false
  editingPartIndex.value = null
  menuOpen.value = false
  openReasoningParts.value = {}
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

function stringFromMetadata(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function displayTextMarkdown(value: string): string {
  return value
}

function displayReasoningMarkdown(value: string): string {
  return value
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
    source: stringFromMetadata(record.source, 'plugin'),
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

function reasoningSendsAsContext(part: ReasoningContentPart): boolean {
  return part.sendAsContext === true
}

function isReasoningOpen(partIndex: number): boolean {
  return openReasoningParts.value[partIndex] === true
}

function toggleReasoningOpen(partIndex: number) {
  openReasoningParts.value = {
    ...openReasoningParts.value,
    [partIndex]: !isReasoningOpen(partIndex)
  }
}

function toggleReasoningContext(partIndex: number) {
  if (!canEdit.value) return
  const next = JSON.parse(JSON.stringify(sourceBlock.value)) as ChatBlock
  const part = next.contentParts[partIndex]
  if (part?.type !== 'reasoning') return
  part.sendAsContext = !reasoningSendsAsContext(part)
  emit('save', next)
}

function reasoningTitle(partIndex: number): string {
  const reasoningIndex = visibleContentParts.value
    .filter(item => item.part.type === 'reasoning' && item.index <= partIndex)
    .length
  return reasoningIndex > 1 ? `思考 ${reasoningIndex}` : '思考'
}

function reasoningSummary(part: ReasoningContentPart): string {
  return reasoningSendsAsContext(part) ? '作为上下文' : '不作为上下文'
}

function toolCallTitle(part: ToolCallContentPart): string {
  if (part.status === 'pending') return `准备调用：${part.toolName}`
  if (part.status === 'error') return `调用失败：${part.toolName}`
  return `工具调用：${part.toolName}`
}

function toolCallSummary(part: ToolCallContentPart): string {
  const extension = recordFromMetadata(part.extensions.pluginTool)
  const pluginId = stringFromMetadata(extension.pluginId)
  const toolCallName = stringFromMetadata(extension.toolCallName)
  return [toolCallStatusLabel(part), pluginId, toolCallName].filter(Boolean).join(' · ')
}

function toolCallStatusLabel(part: ToolCallContentPart): string {
  if (part.status === 'pending') return '待调用'
  if (part.status === 'error') return '失败'
  return '成功'
}

function toolCallJson(part: ToolCallContentPart): Record<string, unknown> {
  return {
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    status: part.status,
    input: part.input,
    output: part.output,
    error: part.error,
    extensions: part.extensions
  }
}

function isToolCallOpen(part: ToolCallContentPart): boolean {
  return openToolCalls.value[part.toolCallId] === true
}

function toggleToolCallOpen(part: ToolCallContentPart) {
  openToolCalls.value = {
    ...openToolCalls.value,
    [part.toolCallId]: !isToolCallOpen(part)
  }
}

function toggleToolCallContext(partIndex: number) {
  if (!canEdit.value) return
  const next = JSON.parse(JSON.stringify(sourceBlock.value)) as ChatBlock
  const part = next.contentParts[partIndex]
  if (part?.type !== 'tool_call') return
  part.sendAsContext = part.sendAsContext !== true
  emit('save', next)
}

function updateToolCommonArgs(commonArgs: Record<string, unknown>) {
  if (!canEdit.value) return
  const next = JSON.parse(JSON.stringify(sourceBlock.value)) as ChatBlock
  next.metadata = {
    ...next.metadata,
    toolDefinition: {
      ...toolDefinition.value,
      commonArgs
    }
  }
  emit('save', next)
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

function insertToolDefinition(placement: 'before' | 'after') {
  if (props.frozen || isVirtual.value) return
  menuOpen.value = false
  emit('insert-tool-definition', sourceBlock.value, placement)
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
      <div v-if="isInjection" class="injection-body">
        <textarea v-if="editing" :ref="setEditorElement" v-model="draft" class="block-editor embedded" rows="6"
          @blur="autoSaveEdit" />

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
          <section v-if="!hasInjectionDetails" class="injection-detail-item">
            <header>
              <strong>注入内容</strong>
              <span>未记录结构来源</span>
            </header>
            <pre>{{ displayText }}</pre>
          </section>
        </div>
      </div>

      <div v-else-if="isToolDefinition" class="tool-definition-body">
        <div class="tool-definition-summary">
          <strong>{{ selectedToolLabel }}</strong>
          <span>{{ selectedToolPluginLabel }}</span>
          <small v-if="selectedToolNames">工具：{{ selectedToolNames }}</small>
        </div>
        <p v-if="!selectedToolCall" class="tool-definition-note invalid">当前工具调用插件不可用。</p>
        <PluginFrame
          v-else-if="selectedToolSettingsHtml"
          :plugin-id="toolDefinitionPluginId"
          :html-path="selectedToolSettingsHtml"
          :common-args="selectedToolCommonArgs"
          @update:common-args="updateToolCommonArgs"
        />
        <div class="block-content tool-definition-prompt">
          <textarea v-if="editing" :ref="setEditorElement" v-model="draft" class="block-editor embedded" rows="8"
            @blur="autoSaveEdit" />
          <MarkdownView v-else :markdown="displayText" />
        </div>
      </div>

      <div v-else-if="showMarkdown" class="block-content">
        <template v-for="{ part, index } in visibleContentParts" :key="`${part.type}-${index}`">
          <section v-if="part.type === 'reasoning'" class="reasoning-panel content-segment">
            <header class="reasoning-header">
              <button class="reasoning-toggle" type="button" @click="toggleReasoningOpen(index)">
                <MdPsychology class="reasoning-icon" aria-hidden="true" />
                <span>{{ reasoningTitle(index) }}</span>
              </button>
              <button class="tool-call-context" type="button" :disabled="!canEdit"
                @click="toggleReasoningContext(index)">
                {{ reasoningSummary(part) }}
              </button>
            </header>
            <div v-if="isReasoningOpen(index)" class="reasoning-body">
              <MarkdownView :markdown="displayReasoningMarkdown(part.text)" />
            </div>
          </section>

          <section v-else-if="part.type === 'tool_call'" class="tool-call-panel content-segment" :class="part.status">
            <header class="tool-call-header">
              <button class="tool-call-toggle" type="button" @click="toggleToolCallOpen(part)">
                <MdCode class="tool-call-icon" aria-hidden="true" />
                <span>{{ toolCallTitle(part) }}</span>
                <small>{{ toolCallSummary(part) }}</small>
              </button>
              <button class="tool-call-context" type="button" :disabled="!canEdit"
                @click="toggleToolCallContext(index)">
                {{ part.sendAsContext ? '作为上下文' : '不作为上下文' }}
              </button>
            </header>
            <pre v-if="isToolCallOpen(part)"
              class="tool-call-body">{{ JSON.stringify(toolCallJson(part), null, 2) }}</pre>
          </section>

          <section v-else class="text-segment content-segment" :class="{ editable: canEdit }"
            @dblclick="startEdit(index)">
            <textarea v-if="editing && editingPartIndex === index" :ref="setEditorElement" v-model="draft"
              class="block-editor embedded" rows="6" @blur="autoSaveEdit" />
            <MarkdownView v-else :markdown="displayTextMarkdown(part.text)" />
          </section>
        </template>

        <textarea v-if="editing && editingPartIndex === sourceBlock.contentParts.length" :ref="setEditorElement"
          v-model="draft" class="block-editor embedded" rows="6" @blur="autoSaveEdit" />
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
        <button v-if="!editing && !isVirtual" type="button" :disabled="frozen" @click="insertToolDefinition('before')">
          <MdLibraryAdd class="menu-icon" aria-hidden="true" />上方插入工具
        </button>
        <button v-if="!editing && !isVirtual" type="button" :disabled="frozen" @click="insertToolDefinition('after')">
          <MdLibraryAdd class="menu-icon" aria-hidden="true" />下方插入工具
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

.chat-block.tool_definition {
  background: #f7fbff;
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

.block-editor {
  display: block;
  width: auto;
  margin-inline: var(--chat-block-content-inset);
  min-height: 130px;
}

.block-editor.embedded {
  width: 100%;
  margin-inline: 0;
}

.block-content {
  margin-inline: var(--chat-block-content-inset);
  min-width: 0;
  display: grid;
  gap: 8px;
}

.content-segment {
  min-width: 0;
}

.text-segment {
  display: grid;
  gap: 6px;
}

.text-segment.editable {
  cursor: text;
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

.reasoning-header {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
}

.reasoning-toggle {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 7px;
  border: 0;
  background: transparent;
  color: #526173;
  padding: 3px 0;
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

.tool-call-panel {
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  border: 1px solid #d8dee7;
  border-radius: 8px;
  background: #fbfaf7;
}

.tool-call-panel.success {
  border-color: #cadfce;
  background: #f8fcf8;
}

.tool-call-panel.error {
  border-color: #efcaca;
  background: #fff8f8;
}

.tool-call-header {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
}

.tool-call-toggle {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 7px;
  border: 0;
  background: transparent;
  color: #526173;
  padding: 3px 0;
  text-align: left;
}

.tool-call-toggle span,
.tool-call-toggle small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-call-toggle span {
  color: #334052;
  font-size: 13px;
  font-weight: 600;
}

.tool-call-toggle small {
  color: #7a8797;
  font-size: 12px;
}

.tool-call-icon {
  width: 17px;
  height: 17px;
  flex-shrink: 0;
}

.tool-call-context {
  min-height: 26px;
  flex-shrink: 0;
  border: 1px solid #d8dee7;
  border-radius: 7px;
  background: #ffffff;
  color: #657085;
  padding: 0 8px;
  font-size: 12px;
}

.tool-call-context:hover:not(:disabled) {
  background: #f4f8ff;
  color: #174f99;
}

.tool-call-context:disabled {
  cursor: default;
  opacity: 0.45;
}

.tool-call-body {
  max-height: 360px;
  overflow: auto;
  margin: 0;
  border-top: 1px solid #e4e9f0;
  background: #ffffff;
  color: #303a49;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  padding: 10px;
  white-space: pre-wrap;
  word-break: break-word;
}

.injection-body,
.tool-definition-body {
  width: auto;
  margin-inline: var(--chat-block-content-inset);
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
