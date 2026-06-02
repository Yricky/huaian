<script setup lang="ts">
import { computed, type ComponentPublicInstance } from 'vue'
import type { DbChatBlock, JsonRecord, JsonRecordValue } from '../../../../shared/types'

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
  block: DbChatBlock
  displayText: string
  editing: boolean
  draft: string
}>()

const emit = defineEmits<{
  'update:draft': [value: string]
  'editor-ref': [element: Element | ComponentPublicInstance | null]
  'auto-save-edit': []
}>()

const draftModel = computed({
  get: () => props.draft,
  set: value => emit('update:draft', value)
})

const injectionDetails = computed(() => {
  const raw = props.block.metadata.injectionDetails
  if (!Array.isArray(raw)) return []
  return raw.map(injectionDetailFromMetadata).filter((detail): detail is InjectionDetail => detail !== null)
})

const hasInjectionDetails = computed(() => injectionDetails.value.length > 0)

function numberFromMetadata(value: JsonRecordValue): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function recordFromMetadata(value: JsonRecordValue): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function stringFromMetadata(value: JsonRecordValue, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function optionalNumberFromMetadata(value: JsonRecordValue): number | undefined {
  return numberFromMetadata(value) ?? undefined
}

function injectionDetailFromMetadata(value: JsonRecordValue): InjectionDetail | null {
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

function setEditorElement(element: Element | ComponentPublicInstance | null) {
  emit('editor-ref', element)
}

function autoSaveEdit() {
  emit('auto-save-edit')
}
</script>

<template>
  <div class="injection-body">
    <textarea
      v-if="editing"
      :ref="setEditorElement"
      v-model="draftModel"
      class="block-editor embedded"
      rows="6"
      @blur="autoSaveEdit"
    />

    <div v-else class="injection-detail-list">
      <section
        v-for="(detail, index) in injectionDetails"
        :key="`${detail.source}-${detail.entryId ?? index}`"
        class="injection-detail-item"
      >
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
</template>

<style scoped>
.injection-body {
  width: auto;
  margin-inline: var(--chat-block-content-inset);
  display: grid;
  gap: 10px;
  min-width: 0;
}

.block-editor {
  display: block;
  min-height: 130px;
}

.block-editor.embedded {
  width: 100%;
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
</style>
