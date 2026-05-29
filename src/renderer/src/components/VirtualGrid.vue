<script setup lang="ts" generic="T">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

type ItemKey = string | number

interface Props<T> {
  items: T[]
  itemKey: (item: T, index: number) => ItemKey
  itemHeight: number
  itemMinWidth: number
  gap?: number
  bufferSize?: number
  padding?: number
}

const props = withDefaults(defineProps<Props<T>>(), {
  gap: 8,
  bufferSize: 2,
  padding: 0
})

const containerRef = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const containerHeight = ref(0)
const containerWidth = ref(0)

let containerResizeObserver: ResizeObserver | null = null

const columnsPerRow = computed(() => {
  const availableWidth = containerWidth.value - props.padding * 2
  if (availableWidth <= 0) return 1
  return Math.max(1, Math.floor((availableWidth + props.gap) / (props.itemMinWidth + props.gap)))
})

const rowHeight = computed(() => props.itemHeight + props.gap)
const totalRows = computed(() => Math.ceil(props.items.length / columnsPerRow.value))

const totalHeight = computed(() => {
  if (totalRows.value === 0) return props.padding * 2
  return props.padding * 2 + totalRows.value * props.itemHeight + (totalRows.value - 1) * props.gap
})

const visibleRange = computed(() => {
  if (totalRows.value === 0) return { start: 0, end: 0 }

  const firstVisibleRow = Math.floor(Math.max(0, scrollTop.value - props.padding) / rowHeight.value)
  const visibleRowCount = Math.ceil((containerHeight.value + props.gap) / rowHeight.value)

  return {
    start: Math.max(0, firstVisibleRow - props.bufferSize),
    end: Math.min(totalRows.value, firstVisibleRow + visibleRowCount + props.bufferSize)
  }
})

const visibleRows = computed(() => {
  const rows: Array<{ rowIndex: number; items: Array<{ item: T; index: number }> }> = []
  const { start, end } = visibleRange.value

  for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
    const startIndex = rowIndex * columnsPerRow.value
    const endIndex = Math.min(startIndex + columnsPerRow.value, props.items.length)
    const rowItems = props.items.slice(startIndex, endIndex).map((item, offset) => ({
      item,
      index: startIndex + offset
    }))

    rows.push({ rowIndex, items: rowItems })
  }

  return rows
})

function handleScroll(event: Event) {
  scrollTop.value = (event.currentTarget as HTMLElement).scrollTop
}

function handleContainerResize() {
  if (!containerRef.value) return
  containerHeight.value = containerRef.value.clientHeight
  containerWidth.value = containerRef.value.clientWidth
}

function scrollToIndex(index: number) {
  const container = containerRef.value
  if (!container) return
  const rowIndex = Math.floor(index / columnsPerRow.value)
  container.scrollTop = props.padding + rowIndex * rowHeight.value
  scrollTop.value = container.scrollTop
}

function scrollToTop() {
  const container = containerRef.value
  if (!container) return
  container.scrollTop = 0
  scrollTop.value = 0
}

onMounted(() => {
  containerResizeObserver = new ResizeObserver(handleContainerResize)
  if (containerRef.value) {
    containerResizeObserver.observe(containerRef.value)
  }
  handleContainerResize()
})

onBeforeUnmount(() => {
  containerResizeObserver?.disconnect()
})

defineExpose({
  scrollToIndex,
  scrollToTop
})
</script>

<template>
  <div ref="containerRef" class="virtual-grid-container" @scroll="handleScroll">
    <div class="virtual-grid-phantom" :style="{ height: `${totalHeight}px` }">
      <div
        v-for="{ rowIndex, items: rowItems } in visibleRows"
        :key="rowIndex"
        class="virtual-grid-row"
        :style="{
          transform: `translate(${props.padding}px, ${props.padding + rowIndex * rowHeight}px)`,
          width: `calc(100% - ${props.padding * 2}px)`,
          height: `${props.itemHeight}px`,
          gridTemplateColumns: `repeat(${columnsPerRow}, minmax(0, 1fr))`,
          gap: `${props.gap}px`
        }"
      >
        <div
          v-for="{ item, index } in rowItems"
          :key="props.itemKey(item, index)"
          class="virtual-grid-item"
        >
          <slot name="item" :item="item" :index="index" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.virtual-grid-container {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  position: relative;
}

.virtual-grid-phantom {
  position: relative;
  width: 100%;
}

.virtual-grid-row {
  position: absolute;
  left: 0;
  display: grid;
  box-sizing: border-box;
}

.virtual-grid-item {
  min-width: 0;
  height: 100%;
}
</style>
