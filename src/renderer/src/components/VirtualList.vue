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

interface PositionItem {
  offset: number
  height: number
}

const props = withDefaults(defineProps<Props<T>>(), {
  estimatedItemHeight: 56,
  bufferSize: 6
})

const containerRef = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const containerHeight = ref(0)
const positions = ref<PositionItem[]>([])
const rowRefs = new Map<number, HTMLElement>()

let rowResizeObserver: ResizeObserver | null = null
let containerResizeObserver: ResizeObserver | null = null

const itemSignature = computed(() => (
  props.items.map((item, index) => String(props.itemKey(item, index))).join('\u001f')
))

const totalHeight = computed(() => {
  const lastItem = positions.value[positions.value.length - 1]
  return lastItem ? lastItem.offset + lastItem.height : 0
})

const visibleRange = computed(() => {
  if (!positions.value.length) return { start: 0, end: 0 }

  let low = 0
  let high = positions.value.length - 1
  let startIndex = 0

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const item = positions.value[mid]
    if (item.offset + item.height > scrollTop.value) {
      startIndex = mid
      high = mid - 1
    } else {
      low = mid + 1
    }
  }

  let endIndex = startIndex
  let measuredHeight = 0
  const targetHeight = containerHeight.value + props.estimatedItemHeight * props.bufferSize

  while (endIndex < positions.value.length && measuredHeight < targetHeight) {
    measuredHeight += positions.value[endIndex].height
    endIndex += 1
  }

  return {
    start: Math.max(0, startIndex - props.bufferSize),
    end: Math.min(positions.value.length, endIndex + props.bufferSize)
  }
})

const visibleItems = computed(() => {
  const { start, end } = visibleRange.value
  return props.items.slice(start, end).map((item, offset) => ({
    item,
    index: start + offset
  }))
})

function resetPositions() {
  positions.value = Array.from({ length: props.items.length }, (_, index) => ({
    offset: index * props.estimatedItemHeight,
    height: props.estimatedItemHeight
  }))

  for (const [index, element] of rowRefs) {
    if (index >= props.items.length) {
      rowResizeObserver?.unobserve(element)
      rowRefs.delete(index)
    }
  }
}

function updatePosition(index: number, height: number) {
  const position = positions.value[index]
  if (!position || position.height === height) return

  const diff = height - position.height
  position.height = height

  for (let nextIndex = index + 1; nextIndex < positions.value.length; nextIndex += 1) {
    positions.value[nextIndex].offset += diff
  }
}

function measureMountedRows() {
  nextTick(() => {
    for (const [index, element] of rowRefs) {
      updatePosition(index, element.offsetHeight)
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
    nextTick(() => updatePosition(index, element.offsetHeight))
    return
  }

  if (existing) {
    rowResizeObserver?.unobserve(existing)
    rowRefs.delete(index)
  }
}

function handleScroll(event: Event) {
  scrollTop.value = (event.currentTarget as HTMLElement).scrollTop
}

function handleContainerResize() {
  if (!containerRef.value) return
  containerHeight.value = containerRef.value.clientHeight
}

function findIndexAtOffset(offset: number) {
  if (!positions.value.length) return 0

  let low = 0
  let high = positions.value.length - 1
  let index = positions.value.length

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const item = positions.value[mid]

    if (item.offset + item.height > offset) {
      index = mid
      high = mid - 1
    } else {
      low = mid + 1
    }
  }

  return index
}

function getDropIndexFromClientY(clientY: number) {
  const container = containerRef.value
  if (!container || !positions.value.length) return 0

  const rect = container.getBoundingClientRect()
  const offset = Math.max(0, clientY - rect.top + container.scrollTop)
  const index = findIndexAtOffset(offset)

  if (index >= positions.value.length) return props.items.length

  const item = positions.value[index]
  return offset < item.offset + item.height / 2 ? index : index + 1
}

function autoScrollAtClientY(clientY: number, edgeSize = 56, maxStep = 22) {
  const container = containerRef.value
  if (!container) return 0

  const rect = container.getBoundingClientRect()
  const topDistance = clientY - rect.top
  const bottomDistance = rect.bottom - clientY
  let step = 0

  if (topDistance < edgeSize) {
    step = -Math.ceil((1 - Math.max(0, topDistance) / edgeSize) * maxStep)
  } else if (bottomDistance < edgeSize) {
    step = Math.ceil((1 - Math.max(0, bottomDistance) / edgeSize) * maxStep)
  }

  if (step === 0) return 0

  const before = container.scrollTop
  container.scrollTop += step
  scrollTop.value = container.scrollTop
  return container.scrollTop - before
}

function scrollToIndex(index: number) {
  const container = containerRef.value
  const position = positions.value[index]
  if (!container || !position) return
  container.scrollTop = position.offset
  scrollTop.value = container.scrollTop
}

function scrollToTop() {
  const container = containerRef.value
  if (!container) return
  container.scrollTop = 0
  scrollTop.value = 0
}

watch([itemSignature, () => props.estimatedItemHeight], () => {
  resetPositions()
  measureMountedRows()
}, { immediate: true })

onMounted(() => {
  rowResizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const index = Number((entry.target as HTMLElement).dataset.index)
      if (Number.isInteger(index)) {
        updatePosition(index, (entry.target as HTMLElement).offsetHeight)
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
  autoScrollAtClientY,
  getDropIndexFromClientY,
  scrollToIndex,
  scrollToTop
})
</script>

<template>
  <div ref="containerRef" class="virtual-list-container" @scroll="handleScroll">
    <div class="virtual-list-phantom" :style="{ height: `${totalHeight}px` }">
      <div
        v-for="{ item, index } in visibleItems"
        :key="props.itemKey(item, index)"
        :ref="(element) => setRowRef(element, index)"
        :data-index="index"
        class="virtual-list-item"
        :style="{ transform: `translateY(${positions[index]?.offset ?? 0}px)` }"
      >
        <slot name="item" :item="item" :index="index" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.virtual-list-container {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  position: relative;
}

.virtual-list-phantom {
  position: relative;
  width: 100%;
}

.virtual-list-item {
  position: absolute;
  left: 0;
  width: 100%;
}
</style>
