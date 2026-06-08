<script setup lang="ts">
import { computed } from 'vue'
import { MdClose } from 'vue-icons-plus/md'

const props = defineProps<{
  title: string
  value: object | string | number | boolean | null | undefined
}>()

const emit = defineEmits<{
  close: []
}>()

const jsonText = computed(() => JSON.stringify(props.value, null, 2) ?? 'undefined')
const tokens = computed(() => tokenizeJson(jsonText.value))

type JsonTokenType = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punctuation' | 'plain'

interface JsonToken {
  text: string
  type: JsonTokenType
}

function tokenizeJson(value: string): JsonToken[] {
  const tokenPattern = /("(?:\\.|[^"\\])*"(?=\s*:))|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\bnull\b|([{}\[\],:])/g
  const result: JsonToken[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = tokenPattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      result.push({ text: value.slice(lastIndex, match.index), type: 'plain' })
    }

    if (match[1]) result.push({ text: match[1], type: 'key' })
    else if (match[2]) result.push({ text: match[2], type: 'string' })
    else if (match[3]) result.push({ text: match[3], type: 'number' })
    else if (match[4]) result.push({ text: match[4], type: 'boolean' })
    else if (match[0] === 'null') result.push({ text: match[0], type: 'null' })
    else result.push({ text: match[0], type: 'punctuation' })

    lastIndex = tokenPattern.lastIndex
  }

  if (lastIndex < value.length) {
    result.push({ text: value.slice(lastIndex), type: 'plain' })
  }

  return result
}
</script>

<template>
  <Teleport to="body">
    <div class="json-dialog" role="dialog" aria-modal="true" @click.self="emit('close')">
      <div class="json-dialog-panel">
        <header>
          <strong>{{ title }}</strong>
          <button class="toolbar-button" type="button" aria-label="关闭" data-tooltip="关闭" @click="emit('close')">
            <MdClose class="toolbar-icon" aria-hidden="true" />
          </button>
        </header>
        <pre class="json-code" tabindex="0"><code><span
          v-for="(token, index) in tokens"
          :key="index"
          :class="`json-token-${token.type}`"
        >{{ token.text }}</span></code></pre>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.json-dialog {
  position: fixed;
  inset: 0;
  z-index: 160;
  display: grid;
  place-items: center;
  background: var(--overlay-scrim-soft);
  padding: 24px;
}

.json-dialog-panel {
  width: min(860px, 92vw);
  max-height: min(760px, 86vh);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border-radius: 8px;
  background: var(--surface-raised);
  box-shadow: 0 18px 50px var(--shadow-color-strong);
}

.json-dialog-panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-subtle);
  padding: 8px 10px;
}

.json-code {
  min-width: 0;
  overflow: auto;
  margin: 0;
  border: 0;
  background: var(--surface-panel);
  color: var(--text-primary);
  padding: 14px 16px;
  font: 12px/1.55 "SF Mono", "Cascadia Code", "Roboto Mono", ui-monospace, Menlo, Monaco, Consolas, monospace;
  tab-size: 2;
  white-space: pre;
}

.json-code:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: -2px;
}

.json-token-key {
  color: var(--syntax-key);
}

.json-token-string {
  color: var(--syntax-string);
}

.json-token-number {
  color: var(--syntax-number);
}

.json-token-boolean {
  color: var(--syntax-boolean);
}

.json-token-null {
  color: var(--syntax-null);
}

.json-token-punctuation {
  color: var(--syntax-punctuation);
}
</style>
