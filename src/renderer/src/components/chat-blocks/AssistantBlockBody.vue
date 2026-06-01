<script setup lang="ts">
import { computed, ref, watch, type ComponentPublicInstance } from 'vue'
import { MdCode, MdPsychology } from 'vue-icons-plus/md'
import type {
  ChatBlock,
  ChatContentPart,
  ReasoningContentPart,
  ToolCallContentPart
} from '../../../../shared/types'
import MarkdownView from '../MarkdownView.vue'

interface VisibleContentPart {
  part: ChatContentPart
  index: number
}

const props = defineProps<{
  block: ChatBlock
  sourceBlock: ChatBlock
  canEdit: boolean
  editing: boolean
  editingPartIndex: number | null
  draft: string
}>()

const emit = defineEmits<{
  save: [block: ChatBlock]
  'update:draft': [value: string]
  'editor-ref': [element: Element | ComponentPublicInstance | null]
  'auto-save-edit': []
  'start-edit': [partIndex: number]
}>()

const openReasoningParts = ref<Record<number, boolean>>({})
const openToolCalls = ref<Record<string, boolean>>({})

const draftModel = computed({
  get: () => props.draft,
  set: value => emit('update:draft', value)
})

const visibleContentParts = computed<VisibleContentPart[]>(() => props.block.contentParts
  .map((part, index) => ({ part, index }))
  .filter(item => item.part.type !== 'reasoning' || item.part.text.trim().length > 0))

watch(() => props.block.id, () => {
  openReasoningParts.value = {}
  openToolCalls.value = {}
})

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

function setEditorElement(element: Element | ComponentPublicInstance | null) {
  emit('editor-ref', element)
}

function autoSaveEdit() {
  emit('auto-save-edit')
}

function startEdit(partIndex: number) {
  emit('start-edit', partIndex)
}

function cloneSourceBlock(): ChatBlock {
  return JSON.parse(JSON.stringify(props.sourceBlock)) as ChatBlock
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
  if (!props.canEdit) return
  const next = cloneSourceBlock()
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
  if (!props.canEdit) return
  const next = cloneSourceBlock()
  const part = next.contentParts[partIndex]
  if (part?.type !== 'tool_call') return
  part.sendAsContext = part.sendAsContext !== true
  emit('save', next)
}
</script>

<template>
  <div class="block-content">
    <template v-for="{ part, index } in visibleContentParts" :key="`${part.type}-${index}`">
      <section v-if="part.type === 'reasoning'" class="reasoning-panel content-segment">
        <header class="reasoning-header">
          <button class="reasoning-toggle" type="button" @click="toggleReasoningOpen(index)">
            <MdPsychology class="reasoning-icon" aria-hidden="true" />
            <span>{{ reasoningTitle(index) }}</span>
          </button>
          <button class="tool-call-context" type="button" :disabled="!canEdit" @click="toggleReasoningContext(index)">
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
          <button class="tool-call-context" type="button" :disabled="!canEdit" @click="toggleToolCallContext(index)">
            {{ part.sendAsContext ? '作为上下文' : '不作为上下文' }}
          </button>
        </header>
        <pre v-if="isToolCallOpen(part)" class="tool-call-body">{{ JSON.stringify(toolCallJson(part), null, 2) }}</pre>
      </section>

      <section
        v-else
        class="text-segment content-segment"
        :class="{ editable: canEdit }"
        @dblclick="startEdit(index)"
      >
        <textarea
          v-if="editing && editingPartIndex === index"
          :ref="setEditorElement"
          v-model="draftModel"
          class="block-editor embedded"
          rows="6"
          @blur="autoSaveEdit"
        />
        <MarkdownView v-else :markdown="displayTextMarkdown(part.text)" />
      </section>
    </template>

    <textarea
      v-if="editing && editingPartIndex === sourceBlock.contentParts.length"
      :ref="setEditorElement"
      v-model="draftModel"
      class="block-editor embedded"
      rows="6"
      @blur="autoSaveEdit"
    />
  </div>
</template>

<style scoped>
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

.block-editor {
  display: block;
  min-height: 130px;
}

.block-editor.embedded {
  width: 100%;
  margin-inline: 0;
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
</style>
