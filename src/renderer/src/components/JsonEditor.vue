<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  rows?: number
  ariaLabel?: string
}>(), {
  rows: 10,
  ariaLabel: 'JSON'
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  blur: [event: FocusEvent]
}>()

const overlayTransform = ref('translate(0, 0)')

const highlightedJson = computed(() => highlightJson(props.modelValue))

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function tokenClass(token: string) {
  if (/^"/.test(token)) return /:\s*$/.test(token) ? 'key' : 'string'
  if (/^-?\d/.test(token)) return 'number'
  if (token === 'true' || token === 'false') return 'boolean'
  if (token === 'null') return 'null'
  return 'punctuation'
}

function highlightJson(source: string) {
  if (!source) return '<span class="json-token placeholder">&nbsp;</span>'

  const tokenPattern = /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\],:])/g
  let result = ''
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = tokenPattern.exec(source)) !== null) {
    const token = match[0]
    result += escapeHtml(source.slice(lastIndex, match.index))
    result += `<span class="json-token ${tokenClass(token)}">${escapeHtml(token)}</span>`
    lastIndex = match.index + token.length
  }

  result += escapeHtml(source.slice(lastIndex))
  return result
}

function handleInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
}

function handleScroll(event: Event) {
  const textarea = event.target as HTMLTextAreaElement
  overlayTransform.value = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`
}

async function insertIndent(event: KeyboardEvent) {
  const textarea = event.target as HTMLTextAreaElement
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const indent = '  '
  const nextValue = `${textarea.value.slice(0, start)}${indent}${textarea.value.slice(end)}`
  textarea.value = nextValue
  emit('update:modelValue', nextValue)
  await nextTick()
  textarea.selectionStart = start + indent.length
  textarea.selectionEnd = start + indent.length
}
</script>

<template>
  <div class="json-editor">
    <pre class="json-editor-highlight" aria-hidden="true"><code class="json-editor-code" :style="{ transform: overlayTransform }" v-html="highlightedJson" /></pre>
    <textarea
      class="json-editor-input"
      :aria-label="ariaLabel"
      :rows="rows"
      :value="modelValue"
      wrap="off"
      autocomplete="off"
      autocorrect="off"
      autocapitalize="off"
      spellcheck="false"
      @blur="emit('blur', $event)"
      @input="handleInput"
      @scroll="handleScroll"
      @keydown.tab.prevent="insertIndent"
    />
  </div>
</template>

<style scoped>
.json-editor {
  position: relative;
  width: 100%;
  min-width: 0;
  border: 1px solid #cfd7e2;
  border-radius: 8px;
  background: #fbfcfd;
  overflow: hidden;
}

.json-editor:focus-within {
  border-color: #2f6fca;
}

.json-editor-highlight,
.json-editor-input {
  margin: 0;
  padding: 8px 10px;
  font-family: "SFMono-Regular", "Cascadia Code", Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 1.55;
  tab-size: 2;
  white-space: pre;
}

.json-editor-highlight {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  overflow: hidden;
  color: #1f2935;
}

.json-editor-code {
  display: block;
  min-width: max-content;
}

.json-editor-input {
  position: relative;
  z-index: 2;
  display: block;
  width: 100%;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: transparent;
  caret-color: #1f2935;
  outline: none;
  resize: vertical;
  -webkit-text-fill-color: transparent;
}

.json-editor-input::selection {
  background: rgba(47, 111, 202, 0.22);
}

:deep(.json-token.key) {
  color: #8a4b0f;
}

:deep(.json-token.string) {
  color: #1f7a4d;
}

:deep(.json-token.number) {
  color: #1f5fbf;
}

:deep(.json-token.boolean) {
  color: #8d3fb0;
}

:deep(.json-token.null) {
  color: #7d8794;
}

:deep(.json-token.punctuation) {
  color: #4e5b6c;
}

:deep(.json-token.placeholder) {
  color: transparent;
}
</style>
