<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { MdAdd, MdDeleteOutline, MdDragIndicator, MdEdit, MdFileDownload, MdFileUpload, MdVisibility } from 'vue-icons-plus/md'
import type { LoreBook, LoreBookDraftApplyPayload, WorldEntry } from '../../../shared/types'
import { worldEntryFieldHints } from '../fieldHints'
import { useProjectWorkbench } from '../composables/useProjectWorkbench'
import JsonEditor from './JsonEditor.vue'
import LoreBookDraftReviewDialog from './LoreBookDraftReviewDialog.vue'
import VirtualGrid from './VirtualGrid.vue'
import VirtualList from './VirtualList.vue'

interface VirtualListExpose {
  autoScrollAtClientY: (clientY: number, edgeSize?: number, maxStep?: number) => number
  getDropIndexFromClientY: (clientY: number) => number
  scrollToIndex: (index: number) => void
  scrollToTop: () => void
}


interface WorldEntryDragState {
  entryId: number
  dropIndex: number
  pointerX: number
  pointerY: number
  title: string
}

const {
  applyLoreBookDraft,
  createLoreBook,
  createWorldEntry,
  deleteSelectedLoreBook,
  deleteSelectedWorldEntry,
  discardLoreBookDraft,
  entrySummary,
  entryTitle,
  exportSelectedLoreBook,
  formatDate,
  importLoreBooks,
  isWorldEntryExpanded,
  loreBookDrafts,
  moveLoreBookEntry,
  refreshLoreBookDrafts,
  saveLoreBook,
  saveWorldEntry,
  saveWorldEntryAdvanced,
  selectLoreBook,
  selectedLoreBook,
  selectedLoreBookEntries,
  selectedWorldEntry,
  showToast,
  toggleWorldEntry,
  loreBookEntryCount,
  loreBooks,
  worldEntryAdvancedJson,
  worldEntryData,
  worldEntryDepth,
  worldEntryKeysText,
  worldEntryOutletName,
  worldEntryPosition,
  worldEntryProbability,
  worldEntryRole,
  worldEntryScanDepth,
  worldEntrySelectiveLogic,
  worldEntrySecondaryKeysText
} = useProjectWorkbench()

const entryListRef = ref<VirtualListExpose | null>(null)
const isEditingLoreBookName = ref(false)
const loreBookNameDraft = ref('')
const loreBookNameInputRef = ref<HTMLInputElement | null>(null)
const worldEntryDrag = ref<WorldEntryDragState | null>(null)
const loreBookContextMenu = ref<{ book: LoreBook; left: number; top: number } | null>(null)
const loreBookDraftDialogOpen = ref(false)

let autoScrollFrame: number | null = null

const worldEntryDragStyle = computed(() => {
  const drag = worldEntryDrag.value
  return drag
    ? {
      left: `${drag.pointerX + 12}px`,
      top: `${drag.pointerY + 12}px`
    }
    : {}
})

const isWorldEntryAtDepth = computed(() => Number(worldEntryPosition.value) === 4)
const isWorldEntryOutlet = computed(() => Number(worldEntryPosition.value) === 7)
const loreBookDraftById = computed(() => new Map(loreBookDrafts.value.map(draft => [draft.loreBookId, draft])))
const selectedLoreBookDraft = computed(() => {
  const id = selectedLoreBook.value?.id
  return id === undefined ? null : loreBookDraftById.value.get(id) ?? null
})
const selectedLoreBookDrafts = computed(() => selectedLoreBookDraft.value ? [selectedLoreBookDraft.value] : [])

watch(() => selectedLoreBook.value?.id, () => {
  isEditingLoreBookName.value = false
  loreBookNameDraft.value = selectedLoreBook.value?.name ?? ''
  loreBookDraftDialogOpen.value = false
})

watch(() => selectedLoreBook.value?.name, (name) => {
  if (!isEditingLoreBookName.value) {
    loreBookNameDraft.value = name ?? ''
  }
})

function loreBookKey(book: LoreBook) {
  return book.id
}

function worldEntryKey(entry: WorldEntry) {
  return entry.id
}

function beginLoreBookNameEdit() {
  if (!selectedLoreBook.value) return
  loreBookNameDraft.value = selectedLoreBook.value.name
  isEditingLoreBookName.value = true
  nextTick(() => {
    loreBookNameInputRef.value?.focus()
    loreBookNameInputRef.value?.select()
  })
}

async function finishLoreBookNameEdit() {
  if (!selectedLoreBook.value || !isEditingLoreBookName.value) return
  selectedLoreBook.value.name = loreBookNameDraft.value
  isEditingLoreBookName.value = false
  await saveLoreBook()
}

function cancelLoreBookNameEdit() {
  loreBookNameDraft.value = selectedLoreBook.value?.name ?? ''
  isEditingLoreBookName.value = false
}

const loreBookContextMenuStyle = computed(() => {
  const menu = loreBookContextMenu.value
  if (!menu) return {}
  const width = 190
  const margin = 8
  return {
    left: `${Math.min(window.innerWidth - width - margin, Math.max(margin, menu.left))}px`,
    top: `${Math.min(window.innerHeight - 96 - margin, Math.max(margin, menu.top))}px`,
    width: `${width}px`
  }
})

function openLoreBookContextMenu(event: MouseEvent, book: LoreBook) {
  event.preventDefault()
  selectLoreBook(book)
  loreBookContextMenu.value = {
    book,
    left: event.clientX,
    top: event.clientY
  }
  window.addEventListener('click', closeLoreBookContextMenu)
  window.addEventListener('resize', closeLoreBookContextMenu)
  window.addEventListener('scroll', closeLoreBookContextMenu, true)
}

function closeLoreBookContextMenu() {
  loreBookContextMenu.value = null
  window.removeEventListener('click', closeLoreBookContextMenu)
  window.removeEventListener('resize', closeLoreBookContextMenu)
  window.removeEventListener('scroll', closeLoreBookContextMenu, true)
}

async function openLoreBookDraftReview() {
  const book = loreBookContextMenu.value?.book ?? selectedLoreBook.value
  closeLoreBookContextMenu()
  if (book) selectLoreBook(book)
  await refreshLoreBookDrafts()
  const draft = book ? loreBookDraftById.value.get(book.id) : selectedLoreBookDraft.value
  if (!draft) {
    showToast('当前世界书没有待审阅副本', 'info')
    return
  }
  loreBookDraftDialogOpen.value = true
}

async function applySelectedLoreBookDraft(payload: LoreBookDraftApplyPayload) {
  await applyLoreBookDraft(payload)
  loreBookDraftDialogOpen.value = false
}

async function discardSelectedLoreBookDraft(loreBookId: number) {
  await discardLoreBookDraft(loreBookId)
  loreBookDraftDialogOpen.value = false
}

async function deleteLoreBookFromContextMenu() {
  const book = loreBookContextMenu.value?.book
  closeLoreBookContextMenu()
  if (!book) return
  selectLoreBook(book)
  await nextTick()
  await deleteSelectedLoreBook()
}

function clampDropIndex(index: number) {
  return Math.max(0, Math.min(selectedLoreBookEntries.value.length, index))
}

function updateWorldEntryDropIndex(clientY: number) {
  if (!worldEntryDrag.value) return
  const nextIndex = entryListRef.value?.getDropIndexFromClientY(clientY) ?? 0
  worldEntryDrag.value.dropIndex = clampDropIndex(nextIndex)
}

function runWorldEntryAutoScroll() {
  const drag = worldEntryDrag.value
  if (!drag) {
    autoScrollFrame = null
    return
  }

  const scrolled = entryListRef.value?.autoScrollAtClientY(drag.pointerY) ?? 0
  if (scrolled !== 0) {
    updateWorldEntryDropIndex(drag.pointerY)
  }

  autoScrollFrame = window.requestAnimationFrame(runWorldEntryAutoScroll)
}

function startWorldEntryAutoScroll() {
  if (autoScrollFrame === null) {
    autoScrollFrame = window.requestAnimationFrame(runWorldEntryAutoScroll)
  }
}

function stopWorldEntryAutoScroll() {
  if (autoScrollFrame !== null) {
    window.cancelAnimationFrame(autoScrollFrame)
    autoScrollFrame = null
  }
}

function removeWorldEntryDragListeners() {
  window.removeEventListener('pointermove', handleWorldEntryPointerMove)
  window.removeEventListener('pointerup', finishWorldEntryDrag)
  window.removeEventListener('pointercancel', cancelWorldEntryDrag)
}

function resetWorldEntryDrag() {
  stopWorldEntryAutoScroll()
  removeWorldEntryDragListeners()
  worldEntryDrag.value = null
}

function startWorldEntryDrag(event: PointerEvent, entry: WorldEntry, index: number) {
  if (event.button !== 0) return

  event.preventDefault()
  worldEntryDrag.value = {
    entryId: entry.id,
    dropIndex: index,
    pointerX: event.clientX,
    pointerY: event.clientY,
    title: `${entry.stData.insertion_order}. ${entryTitle(entry)}`
  }

  window.addEventListener('pointermove', handleWorldEntryPointerMove, { passive: false })
  window.addEventListener('pointerup', finishWorldEntryDrag)
  window.addEventListener('pointercancel', cancelWorldEntryDrag)
  updateWorldEntryDropIndex(event.clientY)
  startWorldEntryAutoScroll()
}

function handleWorldEntryPointerMove(event: PointerEvent) {
  const drag = worldEntryDrag.value
  if (!drag) return

  event.preventDefault()
  drag.pointerX = event.clientX
  drag.pointerY = event.clientY
  updateWorldEntryDropIndex(event.clientY)
  startWorldEntryAutoScroll()
}

async function finishWorldEntryDrag() {
  const drag = worldEntryDrag.value
  resetWorldEntryDrag()
  if (!drag) return

  const fromIndex = selectedLoreBookEntries.value.findIndex(entry => entry.id === drag.entryId)
  if (fromIndex < 0) return

  const dropIndex = clampDropIndex(drag.dropIndex)
  const toIndex = dropIndex > fromIndex ? dropIndex - 1 : dropIndex

  if (toIndex === fromIndex) return
  await moveLoreBookEntry(fromIndex, toIndex)
}

function cancelWorldEntryDrag() {
  resetWorldEntryDrag()
}

function isDraggingWorldEntry(entry: WorldEntry) {
  return worldEntryDrag.value?.entryId === entry.id
}

function isWorldEntryDropBefore(index: number) {
  return worldEntryDrag.value?.dropIndex === index
}

function isWorldEntryDropAfter(index: number) {
  return (
    worldEntryDrag.value?.dropIndex === selectedLoreBookEntries.value.length &&
    index === selectedLoreBookEntries.value.length - 1
  )
}

onBeforeUnmount(() => {
  resetWorldEntryDrag()
  closeLoreBookContextMenu()
})

onMounted(() => {
  void refreshLoreBookDrafts()
})
</script>

<template>
  <section class="page-grid">
    <div class="list-pane world-books-list-pane">
      <div class="pane-header">
        <h2>世界书</h2>
        <div class="button-row">
          <button class="toolbar-button" type="button" aria-label="导入" data-tooltip="导入" @click="importLoreBooks">
            <MdFileDownload class="toolbar-icon" aria-hidden="true" />
          </button>
          <button class="toolbar-button" type="button" aria-label="新建" data-tooltip="新建" @click="createLoreBook">
            <MdAdd class="toolbar-icon" aria-hidden="true" />
          </button>
        </div>
      </div>

      <VirtualGrid class="world-book-grid-viewport" :items="loreBooks" :item-key="loreBookKey" :item-height="116"
        :item-min-width="190" :gap="8">
        <template #item="{ item: book }">
          <button class="item-card" :class="{ selected: selectedLoreBook?.id === book.id }" type="button"
            @click="selectLoreBook(book)" @contextmenu="openLoreBookContextMenu($event, book)">
            <strong>{{ book.name }}</strong>
            <span v-if="loreBookDraftById.has(book.id)" class="draft-badge">待审阅</span>
            <span>{{ loreBookEntryCount(book) }} 个条目</span>
            <small>更新 {{ formatDate(book.updatedAt) }}</small>
          </button>
        </template>
      </VirtualGrid>
    </div>

    <div v-if="selectedLoreBook" class="editor-pane world-books-editor-pane">
      <div class="pane-header">
        <div class="pane-title-row">
          <input v-if="isEditingLoreBookName" ref="loreBookNameInputRef" v-model="loreBookNameDraft"
            class="pane-title-input" aria-label="世界书名称" @blur="finishLoreBookNameEdit"
            @keydown.enter.prevent="finishLoreBookNameEdit" @keydown.esc.prevent="cancelLoreBookNameEdit" />
          <h2 v-else :title="selectedLoreBook.name">{{ selectedLoreBook.name }}</h2>
          <button v-if="!isEditingLoreBookName" class="toolbar-button title-edit-button" type="button" aria-label="编辑名称"
            data-tooltip="编辑名称" @click="beginLoreBookNameEdit">
            <MdEdit class="toolbar-icon" aria-hidden="true" />
          </button>
        </div>

        <div class="button-row">
          <button class="toolbar-button" type="button" aria-label="新增条目" data-tooltip="新增条目" @click="createWorldEntry">
            <MdAdd class="toolbar-icon" aria-hidden="true" />
          </button>
          <button class="toolbar-button" type="button" aria-label="导出 JSON" data-tooltip="导出 JSON"
            @click="exportSelectedLoreBook">
            <MdFileUpload class="toolbar-icon" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div class="world-entry-stack">
        <VirtualList ref="entryListRef" class="world-entry-list" :items="selectedLoreBookEntries"
          :item-key="worldEntryKey" :estimated-item-height="56" :buffer-size="8">
          <template #item="{ item: entry, index }">
            <article class="world-entry-row" :class="{
              expanded: isWorldEntryExpanded(entry.id),
              dragging: isDraggingWorldEntry(entry),
              'drop-before': isWorldEntryDropBefore(index),
              'drop-after': isWorldEntryDropAfter(index)
            }">
              <div class="world-entry-summary">
                <button class="drag-handle" type="button" aria-label="拖拽排序"
                  title="拖拽排序：改变 Order；同一插入位置下 Order 会影响注入顺序" @click.stop
                  @pointerdown.stop="startWorldEntryDrag($event, entry, index)">
                  <MdDragIndicator class="drag-icon" aria-hidden="true" />
                </button>
                <button class="world-entry-summary-btn" type="button" @click="toggleWorldEntry(entry)">
                  <strong>{{ entry.stData.insertion_order }}. {{ entryTitle(entry) }}</strong>
                  <span>{{ entrySummary(entry) || '无关键词' }}</span>
                  <small>{{ entry.stData.enabled ? '启用' : '停用' }}</small>
                </button>
              </div>

              <div v-if="selectedWorldEntry && isWorldEntryExpanded(entry.id)" class="world-entry-editor">
                <div class="entry-editor-header">
                  <strong class="field-title" :data-tooltip="worldEntryFieldHints.order">Order {{
                    worldEntryData.insertion_order }}</strong>
                  <button class="toolbar-button" type="button" aria-label="删除条目" data-tooltip="删除条目"
                    @click="deleteSelectedWorldEntry">
                    <MdDeleteOutline class="toolbar-icon" aria-hidden="true" />
                  </button>
                </div>

                <div class="entry-field-section">
                  <h3>基础信息</h3>
                  <div class="form-grid two">
                    <label><span class="field-title" :data-tooltip="worldEntryFieldHints.comment">标题/Memo</span><input
                        v-model="worldEntryData.comment" @blur="saveWorldEntry" /></label>
                    <label><span class="field-title" :data-tooltip="worldEntryFieldHints.position">Position</span>
                      <select v-model="worldEntryPosition" @change="saveWorldEntry">
                        <option value="0">Before Char Defs</option>
                        <option value="1">After Char Defs</option>
                        <option value="5">Before Example Messages</option>
                        <option value="6">After Example Messages</option>
                        <option value="2">Before Author's Note</option>
                        <option value="3">After Author's Note</option>
                        <option value="4">At Depth</option>
                        <option value="7">Outlet</option>
                      </select>
                    </label>
                    <label v-if="isWorldEntryAtDepth"><span class="field-title"
                        :data-tooltip="worldEntryFieldHints.role">Role</span>
                      <select v-model="worldEntryRole" @change="saveWorldEntry">
                        <option value="0">System</option>
                        <option value="1">User</option>
                        <option value="2">Assistant</option>
                      </select>
                    </label>
                    <label v-if="isWorldEntryAtDepth"><span class="field-title"
                        :data-tooltip="worldEntryFieldHints.depth">Depth</span><input v-model.number="worldEntryDepth"
                        type="number" min="0" @blur="saveWorldEntry" /></label>
                    <label v-if="isWorldEntryOutlet"><span class="field-title"
                        :data-tooltip="worldEntryFieldHints.outletName">Outlet 名称</span><input
                        v-model="worldEntryOutletName" placeholder="例如：主线设定" @blur="saveWorldEntry" /></label>
                  </div>
                </div>

                <div class="entry-field-section">
                  <h3>触发条件</h3>
                  <div class="switch-row">
                    <label><input v-model="worldEntryData.enabled" type="checkbox" @change="saveWorldEntry" /> <span
                        class="field-title" :data-tooltip="worldEntryFieldHints.enabled">启用</span></label>
                    <label><input v-model="worldEntryData.constant" type="checkbox" @change="saveWorldEntry" /> <span
                        class="field-title" :data-tooltip="worldEntryFieldHints.constant">常驻</span></label>
                    <label><input v-model="worldEntryData.selective" type="checkbox" @change="saveWorldEntry" /> <span
                        class="field-title" :data-tooltip="worldEntryFieldHints.selective">启用次关键词过滤</span></label>
                  </div>
                  <div class="form-grid two">
                    <label><span class="field-title" :data-tooltip="worldEntryFieldHints.keys">主关键词</span><input
                        v-model="worldEntryKeysText" placeholder="keyword1, keyword2" @blur="saveWorldEntry" /></label>
                    <label><span class="field-title" :data-tooltip="worldEntryFieldHints.secondaryKeys">次关键词</span><input
                        v-model="worldEntrySecondaryKeysText" placeholder="keyword1, keyword2"
                        @blur="saveWorldEntry" /></label>
                    <label><span class="field-title" :data-tooltip="worldEntryFieldHints.selectiveLogic">次关键词逻辑</span>
                      <select v-model="worldEntrySelectiveLogic" :disabled="!worldEntryData.selective"
                        @change="saveWorldEntry">
                        <option value="0">AND ANY</option>
                        <option value="3">AND ALL</option>
                        <option value="1">NOT ALL</option>
                        <option value="2">NOT ANY</option>
                      </select>
                    </label>
                    <label><span class="field-title" :data-tooltip="worldEntryFieldHints.probability">Trigger
                        %</span><input v-model.number="worldEntryProbability" type="number" min="0" max="100"
                        @blur="saveWorldEntry" /></label>
                    <label><span class="field-title" :data-tooltip="worldEntryFieldHints.scanDepth">扫描深度</span><input
                        v-model="worldEntryScanDepth" type="number" min="0" max="1000" step="1"
                        placeholder="使用全局设置" @blur="saveWorldEntry" /></label>
                  </div>
                </div>

                <div class="form-grid">
                  <label><span class="field-title" :data-tooltip="worldEntryFieldHints.content">内容</span><textarea
                      v-model="worldEntryData.content" rows="9" @blur="saveWorldEntry" /></label>
                </div>

                <label class="json-block"><span class="field-title" :data-tooltip="worldEntryFieldHints.advancedJson">高级
                    JSON</span>
                  <JsonEditor v-model="worldEntryAdvancedJson" :rows="14" aria-label="世界书条目高级 JSON"
                    @blur="saveWorldEntryAdvanced" />
                </label>
              </div>
            </article>
          </template>
        </VirtualList>
      </div>

      <div v-if="worldEntryDrag" class="world-entry-drag-preview" :style="worldEntryDragStyle">
        {{ worldEntryDrag.title }}
      </div>

      <LoreBookDraftReviewDialog
        v-if="loreBookDraftDialogOpen"
        :drafts="selectedLoreBookDrafts"
        @apply="applySelectedLoreBookDraft"
        @discard="discardSelectedLoreBookDraft"
        @close="loreBookDraftDialogOpen = false"
      />
    </div>

    <Teleport to="body">
      <div v-if="loreBookContextMenu" class="lore-book-context-menu" :style="loreBookContextMenuStyle" @click.stop>
        <button type="button" :disabled="!loreBookDraftById.has(loreBookContextMenu.book.id)"
          @click="openLoreBookDraftReview">
          <MdVisibility class="menu-icon" aria-hidden="true" />审阅世界书改动
        </button>
        <button class="danger-menu-item" type="button" @click="deleteLoreBookFromContextMenu">
          <MdDeleteOutline class="menu-icon" aria-hidden="true" />删除世界书
        </button>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.world-books-list-pane,
.world-books-editor-pane {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.world-book-grid-viewport,
.world-entry-stack,
.world-entry-list {
  flex: 1;
  min-height: 0;
}

.item-card {
  position: relative;
  width: 100%;
  height: 116px;
  overflow: hidden;
}

.draft-badge {
  position: absolute;
  right: 8px;
  top: 8px;
  display: inline-flex;
  align-items: center;
  border: 1px solid #e1c987;
  border-radius: 999px;
  background: #fff8df;
  color: #6a4a16;
  padding: 2px 7px;
  font-size: 11px;
  font-weight: 600;
}

.pane-title-row {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 2px;
}

.pane-title-row h2 {
  min-width: 0;
}

.title-edit-button {
  flex-shrink: 0;
}

.pane-title-input {
  width: min(420px, 42vw);
  height: 30px;
  border-radius: 7px;
  padding: 4px 8px;
  font-size: 13px;
  font-weight: 600;
}

.world-entry-stack {
  border-top: 1px solid #edf0f4;
}

.world-entry-row {
  position: relative;
  border-bottom: 1px solid #d4dbe4;
  background: #ffffff;
  overflow: hidden;
}

.world-entry-row.expanded {
  border-color: #2f6fca;
}

.world-entry-row.drop-before::before,
.world-entry-row.drop-after::after {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 2;
  height: 2px;
  background: #2f6fca;
  content: "";
}

.world-entry-row.drop-before::before {
  top: 0;
}

.world-entry-row.drop-after::after {
  bottom: 0;
}

.world-entry-row.dragging {
  opacity: 0.45;
}

.world-entry-summary {
  display: flex;
  align-items: stretch;
}

.drag-handle {
  width: 32px;
  min-height: 52px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
  color: #94a0af;
  padding: 0;
  cursor: grab;
  touch-action: none;
  transition: color 0.15s, background 0.15s;
}

.drag-handle:hover,
.drag-handle:focus-visible {
  background: #f3f6fa;
  color: #536071;
}

.drag-handle:active {
  cursor: grabbing;
}

.drag-icon {
  width: 20px;
  height: 20px;
}

.world-entry-summary-btn {
  flex: 1;
  min-height: 52px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 3px 10px;
  border: 0;
  background: transparent;
  padding: 9px 10px;
  text-align: left;
  cursor: pointer;
}

.world-entry-summary-btn strong,
.world-entry-summary-btn span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.world-entry-summary-btn strong {
  color: #243041;
  font-size: 13px;
}

.world-entry-summary-btn span {
  color: #637083;
  font-size: 12px;
}

.world-entry-summary-btn small {
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: center;
  color: #8290a3;
  font-size: 11px;
}

.world-entry-editor {
  border-top: 1px solid #dce3ec;
  padding: 10px;
}

.entry-editor-header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.entry-editor-header strong {
  color: #536071;
  font-size: 12px;
}

.lore-book-context-menu {
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

.lore-book-context-menu button {
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

.lore-book-context-menu button:hover:not(:disabled) {
  background: #f1f5fa;
}

.lore-book-context-menu button:disabled {
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

.entry-field-section {
  border-bottom: 1px solid #edf0f4;
  margin-bottom: 10px;
  padding-bottom: 10px;
}

.entry-field-section h3 {
  margin: 0 0 8px;
  color: #334052;
  font-size: 13px;
}

.switch-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 0 0 10px;
}

.switch-row label {
  grid-auto-flow: column;
  align-items: center;
  justify-content: start;
}

.switch-row input {
  width: auto;
}

.world-entry-drag-preview {
  position: fixed;
  z-index: 100;
  max-width: min(360px, 60vw);
  pointer-events: none;
  overflow: hidden;
  border: 1px solid #b8c4d2;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(32, 36, 42, 0.16);
  color: #243041;
  padding: 8px 10px;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
