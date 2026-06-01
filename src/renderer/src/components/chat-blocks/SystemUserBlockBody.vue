<script setup lang="ts">
import { computed, type ComponentPublicInstance } from 'vue'
import type { DbChatBlock, TextContentPart } from '../../../../shared/types'
import MarkdownView from '../MarkdownView.vue'

interface VisibleTextPart {
  part: TextContentPart
  index: number
}

const props = defineProps<{
  block: DbChatBlock
  sourceBlock: DbChatBlock
  canEdit: boolean
  editing: boolean
  editingPartIndex: number | null
  draft: string
}>()

const emit = defineEmits<{
  'update:draft': [value: string]
  'editor-ref': [element: Element | ComponentPublicInstance | null]
  'auto-save-edit': []
  'start-edit': [partIndex: number]
}>()

const draftModel = computed({
  get: () => props.draft,
  set: value => emit('update:draft', value)
})

const visibleTextParts = computed<VisibleTextPart[]>(() => props.block.contentParts.flatMap((part, index) => (
  part.type === 'text' ? [{ part, index }] : []
)))

function displayTextMarkdown(value: string): string {
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
</script>

<template>
  <div class="block-content">
    <section
      v-for="{ part, index } in visibleTextParts"
      :key="`text-${index}`"
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
</style>
