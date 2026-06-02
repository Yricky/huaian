<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  createStreamingMarkdownRenderer,
  getDefaultStyleSheet,
  getDefaultThemeVars,
  type StreamingMarkdownRenderer
} from '../../../../packages/streaming-markdown/src'

const props = defineProps<{
  markdown?: string
}>()

const containerRef = ref<HTMLElement | null>(null)
let renderer: StreamingMarkdownRenderer | null = null
let resizeObserver: ResizeObserver | null = null
let resizeFrame: number | null = null
let lastWidth = 0

function ensureStyle() {
  if (document.getElementById('st-forge-streaming-markdown-style')) return
  const style = document.createElement('style')
  style.id = 'st-forge-streaming-markdown-style'
  style.textContent = getDefaultStyleSheet('sm')
  document.head.append(style)
}

function applyThemeVars(element: HTMLElement) {
  const vars = getDefaultThemeVars('light')
  for (const [key, value] of Object.entries(vars)) {
    element.style.setProperty(key, value)
  }
  element.style.setProperty('--sm-bg', 'transparent')
}

function scheduleLayoutFlush() {
  if (resizeFrame !== null) return
  resizeFrame = window.requestAnimationFrame(() => {
    resizeFrame = null
    renderer?.flush()
  })
}

function observeSize(element: HTMLElement) {
  lastWidth = Math.floor(element.clientWidth)
  resizeObserver = new ResizeObserver((entries) => {
    const width = Math.floor(entries[0]?.contentRect.width ?? element.clientWidth)
    if (width === lastWidth) return
    lastWidth = width
    scheduleLayoutFlush()
  })
  resizeObserver.observe(element)
}

onMounted(() => {
  ensureStyle()
  if (!containerRef.value) return
  applyThemeVars(containerRef.value)
  renderer = createStreamingMarkdownRenderer(containerRef.value, { classPrefix: 'sm' })
  observeSize(containerRef.value)
  renderer.replace(props.markdown ?? '')
  renderer.finalize()
})

watch(() => props.markdown, (markdown) => {
  renderer?.replace(markdown ?? '')
  renderer?.finalize()
})

onBeforeUnmount(() => {
  if (resizeFrame !== null) {
    window.cancelAnimationFrame(resizeFrame)
    resizeFrame = null
  }
  resizeObserver?.disconnect()
  resizeObserver = null
  renderer?.destroy()
  renderer = null
})
</script>

<template>
  <div ref="containerRef" class="markdown-view" />
</template>

<style scoped>
.markdown-view {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}

.markdown-view :deep(.sm-block),
.markdown-view :deep(.sm-paragraph) {
  max-width: 100%;
  min-width: 0;
}

.markdown-view :deep(.sm-line),
.markdown-view :deep(.sm-code-line) {
  min-width: 0;
  overflow-wrap: normal;
  white-space: pre;
}

.markdown-view :deep(.sm-code),
.markdown-view :deep(.sm-table) {
  max-width: 100%;
  overflow-x: auto;
}
</style>
