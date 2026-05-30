<script setup lang="ts" generic="T">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'

type ItemKey = string | number

interface Props<T> {
  items: T[]
  itemKey: (item: T, index: number) => ItemKey
  estimatedItemHeight?: number
  bufferSize?: number
}

interface VisibleItem<T> {
  item: T
  index: number
}

const props = withDefaults(defineProps<Props<T>>(), {
  estimatedItemHeight: 180,
  bufferSize: 6
})

const containerRef = ref<HTMLElement | null>(null)
const containerHeight = ref(0)
const windowStartIndex = ref(0)
const windowEndIndex = ref(0)
const windowTop = ref(0)
const windowStartKey = ref<string | null>(null)
const measureVersion = ref(0)
const rowRefs = new Map<number, HTMLElement>()
const measuredHeights = new Map<string, number>()

let rowResizeObserver: ResizeObserver | null = null
let containerResizeObserver: ResizeObserver | null = null
let lastTouchY: number | null = null

const itemKeys = computed(() => props.items.map((item, index) => normalizeKey(props.itemKey(item, index))))

const itemSignature = computed(() => itemKeys.value.join('\u001f'))

const heightPrefix = computed(() => {
  measureVersion.value
  const prefix = [0]
  for (let index = 0; index < props.items.length; index += 1) {
    prefix.push(prefix[index] + heightForIndex(index))
  }
  return prefix
})

const totalHeight = computed(() => heightPrefix.value[heightPrefix.value.length - 1] ?? 0)

const visibleItems = computed<VisibleItem<T>[]>(() => {
  const count = props.items.length
  if (!count) return []

  const start = clamp(windowStartIndex.value, 0, count - 1)
  const end = clamp(Math.max(windowEndIndex.value, start + 1), start + 1, count)
  return props.items.slice(start, end).map((item, offset) => ({
    item,
    index: start + offset
  }))
})

function normalizeKey(key: ItemKey): string {
  return `${typeof key}:${String(key)}`
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function estimatedHeight() {
  return Math.max(1, props.estimatedItemHeight)
}

function bufferDistance() {
  return Math.max(0, estimatedHeight() * props.bufferSize)
}

function heightForIndex(index: number) {
  const key = itemKeys.value[index]
  if (!key) return estimatedHeight()
  return measuredHeights.get(key) ?? estimatedHeight()
}

function rangeHeight(start: number, end: number) {
  return (heightPrefix.value[end] ?? 0) - (heightPrefix.value[start] ?? 0)
}

function currentOffset() {
  if (!props.items.length) return 0
  const start = clamp(windowStartIndex.value, 0, props.items.length - 1)
  return (heightPrefix.value[start] ?? 0) - windowTop.value
}

function maxOffset() {
  return Math.max(0, totalHeight.value - containerHeight.value)
}

function stripBottom(start: number, top: number, end: number) {
  return top + rangeHeight(start, end)
}

function commitWindow(start: number, top: number, end: number) {
  const count = props.items.length
  if (!count) {
    windowStartIndex.value = 0
    windowEndIndex.value = 0
    windowTop.value = 0
    windowStartKey.value = null
    return
  }

  const nextStart = clamp(start, 0, count - 1)
  const nextEnd = clamp(Math.max(end, nextStart + 1), nextStart + 1, count)
  windowStartIndex.value = nextStart
  windowEndIndex.value = nextEnd
  windowTop.value = top
  windowStartKey.value = itemKeys.value[nextStart] ?? null
}

function findIndexAtOffset(offset: number) {
  if (!props.items.length) return 0
  if (offset <= 0) return 0
  if (offset >= totalHeight.value) return props.items.length - 1

  const prefix = heightPrefix.value
  let low = 0
  let high = props.items.length - 1
  let index = props.items.length - 1

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if ((prefix[middle + 1] ?? 0) > offset) {
      index = middle
      high = middle - 1
    } else {
      low = middle + 1
    }
  }

  return index
}

function setWindowFromOffset(offset: number) {
  if (!props.items.length) {
    commitWindow(0, 0, 0)
    return
  }

  const targetOffset = clamp(offset, 0, maxOffset())
  let start = findIndexAtOffset(targetOffset)
  let top = (heightPrefix.value[start] ?? 0) - targetOffset
  let end = start + 1
  const buffer = bufferDistance()

  while (start > 0 && top > -buffer) {
    start -= 1
    top -= heightForIndex(start)
  }

  while (end < props.items.length && stripBottom(start, top, end) < containerHeight.value + buffer) {
    end += 1
  }

  commitWindow(start, top, end)
}

function rebalanceWindow(allowTopBoundaryChanges: boolean) {
  const count = props.items.length
  if (!count) {
    commitWindow(0, 0, 0)
    return
  }

  let start = clamp(windowStartIndex.value, 0, count - 1)
  let end = clamp(Math.max(windowEndIndex.value, start + 1), start + 1, count)
  let top = windowTop.value
  const buffer = bufferDistance()

  if (allowTopBoundaryChanges) {
    while (start < end - 1 && top + heightForIndex(start) < -buffer) {
      top += heightForIndex(start)
      start += 1
    }

    while (start > 0 && top > -buffer) {
      start -= 1
      top -= heightForIndex(start)
    }
  }

  while (end < count && stripBottom(start, top, end) < containerHeight.value + buffer) {
    end += 1
  }

  const trimBottom = containerHeight.value + buffer * 2
  while (end > start + 1 && stripBottom(start, top, end - 1) > trimBottom) {
    end -= 1
  }

  commitWindow(start, top, end)
}

function scrollBy(delta: number) {
  if (!Number.isFinite(delta) || delta === 0 || !props.items.length) return

  const beforeOffset = currentOffset()
  const targetOffset = clamp(beforeOffset + delta, 0, maxOffset())
  windowTop.value -= targetOffset - beforeOffset
  rebalanceWindow(true)
}

function normalizedWheelDelta(event: WheelEvent) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * Math.max(1, containerHeight.value)
  return event.deltaY
}

function handleWheel(event: WheelEvent) {
  if (event.ctrlKey || isEditableTarget(event.target)) return
  event.preventDefault()
  scrollBy(normalizedWheelDelta(event))
}

function handleTouchStart(event: TouchEvent) {
  if (isEditableTarget(event.target)) {
    lastTouchY = null
    return
  }

  if (event.touches.length !== 1) {
    lastTouchY = null
    return
  }

  lastTouchY = event.touches[0].clientY
}

function handleTouchMove(event: TouchEvent) {
  if (isEditableTarget(event.target)) return
  if (event.touches.length !== 1 || lastTouchY === null) return
  const nextY = event.touches[0].clientY
  event.preventDefault()
  scrollBy(lastTouchY - nextY)
  lastTouchY = nextY
}

function handleTouchEnd() {
  lastTouchY = null
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('input, textarea, select, button, [contenteditable="true"]'))
}

function handleKeydown(event: KeyboardEvent) {
  if (isEditableTarget(event.target)) return

  const viewportHeight = Math.max(1, containerHeight.value)
  let delta = 0

  if (event.key === 'ArrowDown') delta = 48
  else if (event.key === 'ArrowUp') delta = -48
  else if (event.key === 'PageDown' || event.key === ' ') delta = viewportHeight * 0.85
  else if (event.key === 'PageUp') delta = -viewportHeight * 0.85
  else if (event.key === 'End') {
    event.preventDefault()
    scrollToBottom()
    return
  } else if (event.key === 'Home') {
    event.preventDefault()
    scrollToTop()
    return
  }

  if (delta === 0) return
  event.preventDefault()
  scrollBy(delta)
}

function updateMeasuredHeight(index: number, height: number) {
  const key = itemKeys.value[index]
  if (!key) return

  const safeHeight = Math.max(1, Math.ceil(height))
  if (measuredHeights.get(key) === safeHeight) return

  measuredHeights.set(key, safeHeight)
  measureVersion.value += 1
  rebalanceWindow(false)
}

function measureMountedRows() {
  nextTick(() => {
    for (const [index, element] of rowRefs) {
      updateMeasuredHeight(index, element.offsetHeight)
    }
  })
}

function setRowRef(element: Element | ComponentPublicInstance | null, index: number) {
  const existing = rowRefs.get(index)

  if (element instanceof HTMLElement) {
    if (existing && existing !== element) {
      rowResizeObserver?.unobserve(existing)
    }

    rowRefs.set(index, element)
    rowResizeObserver?.observe(element)
    nextTick(() => updateMeasuredHeight(index, element.offsetHeight))
    return
  }

  if (existing) {
    rowResizeObserver?.unobserve(existing)
    rowRefs.delete(index)
  }
}

function handleContainerResize() {
  if (!containerRef.value) return
  containerHeight.value = containerRef.value.clientHeight
  rebalanceWindow(true)
}

function cleanupMeasuredHeights() {
  const liveKeys = new Set(itemKeys.value)
  for (const key of measuredHeights.keys()) {
    if (!liveKeys.has(key)) {
      measuredHeights.delete(key)
    }
  }
}

function restoreWindowAfterItemsChanged(previousKey: string | null, previousIndex: number, previousTop: number, previousLength: number) {
  cleanupMeasuredHeights()

  if (!props.items.length) {
    commitWindow(0, 0, 0)
    return
  }

  const preservedIndex = previousKey === null ? -1 : itemKeys.value.indexOf(previousKey)
  const start = preservedIndex >= 0
    ? preservedIndex
    : Math.min(previousIndex, props.items.length - 1)
  const end = Math.min(props.items.length, start + Math.max(1, previousLength))

  commitWindow(start, previousTop, end)
  rebalanceWindow(true)
}

function scrollToIndex(index: number) {
  if (!props.items.length) return
  setWindowFromOffset(heightPrefix.value[clamp(index, 0, props.items.length - 1)] ?? 0)
}

function scrollToTop() {
  setWindowFromOffset(0)
}

function scrollToBottom() {
  nextTick(() => {
    setWindowFromOffset(maxOffset())
  })
}

function isNearBottom(threshold = 80) {
  if (!props.items.length) return true
  return totalHeight.value - currentOffset() - containerHeight.value <= threshold
}

watch(itemSignature, () => {
  restoreWindowAfterItemsChanged(
    windowStartKey.value,
    windowStartIndex.value,
    windowTop.value,
    windowEndIndex.value - windowStartIndex.value
  )
  measureMountedRows()
}, { immediate: true })

watch(() => props.estimatedItemHeight, () => {
  measureVersion.value += 1
  rebalanceWindow(true)
})

onMounted(() => {
  rowResizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const index = Number((entry.target as HTMLElement).dataset.index)
      if (Number.isInteger(index)) {
        updateMeasuredHeight(index, (entry.target as HTMLElement).offsetHeight)
      }
    }
  })
  for (const element of rowRefs.values()) {
    rowResizeObserver.observe(element)
  }

  containerResizeObserver = new ResizeObserver(handleContainerResize)
  if (containerRef.value) {
    containerResizeObserver.observe(containerRef.value)
  }
  handleContainerResize()
  measureMountedRows()
})

onBeforeUnmount(() => {
  rowResizeObserver?.disconnect()
  containerResizeObserver?.disconnect()
})

defineExpose({
  isNearBottom,
  scrollToBottom,
  scrollToIndex,
  scrollToTop
})
</script>

<template>
  <div
    ref="containerRef"
    class="chat-virtual-list"
    tabindex="0"
    @keydown="handleKeydown"
    @touchcancel="handleTouchEnd"
    @touchend="handleTouchEnd"
    @touchmove="handleTouchMove"
    @touchstart="handleTouchStart"
    @wheel="handleWheel"
  >
    <div class="chat-virtual-list-stage" :style="{ transform: `translate3d(0, ${windowTop}px, 0)` }">
      <div
        v-for="{ item, index } in visibleItems"
        :key="props.itemKey(item, index)"
        :ref="(element) => setRowRef(element, index)"
        :data-index="index"
        class="chat-virtual-list-item"
      >
        <slot name="item" :item="item" :index="index" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-virtual-list {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  overscroll-behavior: contain;
  position: relative;
  touch-action: none;
}

.chat-virtual-list:focus {
  outline: none;
}

.chat-virtual-list-stage {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  min-width: 0;
  max-width: 100%;
  will-change: transform;
}

.chat-virtual-list-item {
  min-width: 0;
  max-width: 100%;
  overflow: visible;
  position: relative;
  width: 100%;
}
</style>
