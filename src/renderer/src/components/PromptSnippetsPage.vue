<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { MdAdd, MdClose, MdDeleteOutline, MdEdit, MdLabel, MdSearch, MdVisibility } from 'vue-icons-plus/md'
import type { PromptSnippet, PromptTag } from '../../../shared/types'
import { useProjectWorkbench } from '../composables/useProjectWorkbench'
import MarkdownView from './MarkdownView.vue'

const {
  createPromptSnippet,
  createPromptTag,
  deletePromptTag,
  deleteSelectedPromptSnippet,
  formatDate,
  promptSnippets,
  promptTags,
  renamePromptTag,
  savePromptSnippet,
  selectPromptSnippet,
  selectedPromptSnippet,
  showToast
} = useProjectWorkbench()

const searchText = ref('')
const selectedFilterTagIds = ref<number[]>([])
const contentMode = ref<'edit' | 'preview'>('edit')
const tagPickerOpen = ref(false)
const tagPickerQuery = ref('')
const tagPickerInputRef = ref<HTMLInputElement | null>(null)
const tagContextMenu = ref<{ tag: PromptTag; x: number; y: number } | null>(null)

const selectedPromptTagIds = computed(() => new Set(selectedPromptSnippet.value?.tags.map(tag => tag.id) ?? []))

const normalizedSearch = computed(() => searchText.value.trim().toLocaleLowerCase())

const filteredPromptSnippets = computed(() => promptSnippets.value.filter(prompt => {
  const matchesTags = selectedFilterTagIds.value.every(tagId => (
    prompt.tags.some(tag => tag.id === tagId)
  ))
  if (!matchesTags) return false

  const search = normalizedSearch.value
  if (!search) return true
  return prompt.title.toLocaleLowerCase().includes(search) || prompt.content.toLocaleLowerCase().includes(search)
}))

const filteredPickerTags = computed(() => {
  const query = tagPickerQuery.value.trim()
  return promptTags.value.filter(tag => !query || tag.name.includes(query))
})

const canCreatePickerTag = computed(() => {
  const name = tagPickerQuery.value.trim()
  return Boolean(name) &&
    Array.from(name).length <= 20 &&
    !promptTags.value.some(tag => tag.name === name)
})

watch(() => selectedPromptSnippet.value?.id, () => {
  contentMode.value = 'edit'
  closeTagPicker()
  closeTagContextMenu()
})

watch(promptTags, () => {
  const ids = new Set(promptTags.value.map(tag => tag.id))
  selectedFilterTagIds.value = selectedFilterTagIds.value.filter(id => ids.has(id))
})

function promptKey(prompt: PromptSnippet) {
  return prompt.id
}

function tagKey(tag: PromptTag) {
  return tag.id
}

function promptPreview(prompt: PromptSnippet) {
  return prompt.content.trim() || '无内容'
}

function isFilterTagSelected(tag: PromptTag) {
  return selectedFilterTagIds.value.includes(tag.id)
}

function toggleFilterTag(tag: PromptTag) {
  selectedFilterTagIds.value = isFilterTagSelected(tag)
    ? selectedFilterTagIds.value.filter(id => id !== tag.id)
    : [...selectedFilterTagIds.value, tag.id]
}

function isPromptTagSelected(tag: PromptTag) {
  return selectedPromptTagIds.value.has(tag.id)
}

function closeTagPicker() {
  tagPickerOpen.value = false
  tagPickerQuery.value = ''
}

function openTagPicker() {
  if (!selectedPromptSnippet.value) return
  tagContextMenu.value = null
  tagPickerOpen.value = true
  nextTick(() => tagPickerInputRef.value?.focus())
}

async function addTag(tag: PromptTag) {
  if (!selectedPromptSnippet.value || isPromptTagSelected(tag)) return
  selectedPromptSnippet.value.tags = [...selectedPromptSnippet.value.tags, tag]
  await savePromptSnippet(selectedPromptSnippet.value)
}

async function removeTag(tag: PromptTag) {
  if (!selectedPromptSnippet.value || !isPromptTagSelected(tag)) return
  selectedPromptSnippet.value.tags = selectedPromptSnippet.value.tags.filter(item => item.id !== tag.id)
  await savePromptSnippet(selectedPromptSnippet.value)
}

async function createAndAddTag() {
  const name = tagPickerQuery.value.trim()
  if (!name) return
  if (Array.from(name).length > 20) {
    showToast('标签不得超过 20 个字符。', 'error')
    return
  }

  const existing = promptTags.value.find(tag => tag.name === name)
  const tag = existing ?? await createPromptTag(name)
  if (!tag) return
  await addTag(tag)
  tagPickerQuery.value = ''
}

function handleTagPickerKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return
  event.preventDefault()
  void createAndAddTag()
}

function openTagContextMenu(event: MouseEvent, tag: PromptTag) {
  event.preventDefault()
  tagPickerOpen.value = false
  tagContextMenu.value = { tag, x: event.clientX, y: event.clientY }
}

function closeTagContextMenu() {
  tagContextMenu.value = null
}

function closeFloatingPanels() {
  closeTagContextMenu()
  closeTagPicker()
}

async function renameContextTag() {
  const tag = tagContextMenu.value?.tag
  if (!tag) return
  const nextName = window.prompt('重命名标签', tag.name)
  closeTagContextMenu()
  if (nextName === null) return
  await renamePromptTag(tag, nextName)
}

async function deleteContextTag() {
  const tag = tagContextMenu.value?.tag
  closeTagContextMenu()
  if (!tag) return
  await deletePromptTag(tag)
}

async function saveSelectedPrompt() {
  if (!selectedPromptSnippet.value) return
  await savePromptSnippet(selectedPromptSnippet.value)
}

async function switchToPreview() {
  await saveSelectedPrompt()
  contentMode.value = 'preview'
}
</script>

<template>
  <section class="prompt-page" @click="closeFloatingPanels">
    <aside class="prompt-list-pane">
      <div class="pane-header">
        <h2>提示词</h2>
        <button class="toolbar-button" type="button" aria-label="新建提示词" data-tooltip="新建提示词" @click="createPromptSnippet">
          <MdAdd class="toolbar-icon" aria-hidden="true" />
        </button>
      </div>

      <div class="prompt-search">
        <MdSearch class="prompt-search-icon" aria-hidden="true" />
        <input v-model="searchText" placeholder="搜索标题或内容" aria-label="搜索提示词" />
      </div>

      <div v-if="promptTags.length" class="filter-block">
        <div class="filter-tag-flow">
          <button
            v-for="tag in promptTags"
            :key="tagKey(tag)"
            class="md-label-chip filter-chip"
            :class="{ selected: isFilterTagSelected(tag) }"
            type="button"
            @click="toggleFilterTag(tag)"
          >
            <MdLabel class="chip-icon" aria-hidden="true" />
            <span>{{ tag.name }}</span>
          </button>
        </div>
      </div>

      <div class="prompt-list">
        <button
          v-for="prompt in filteredPromptSnippets"
          :key="promptKey(prompt)"
          class="prompt-list-item"
          :class="{ selected: selectedPromptSnippet?.id === prompt.id }"
          type="button"
          @click="selectPromptSnippet(prompt)"
        >
          <strong>{{ prompt.title }}</strong>
          <span>{{ promptPreview(prompt) }}</span>
          <div v-if="prompt.tags.length" class="prompt-card-tags">
            <em v-for="tag in prompt.tags" :key="tagKey(tag)">{{ tag.name }}</em>
          </div>
          <small>更新 {{ formatDate(prompt.updatedAt) }}</small>
        </button>
      </div>
    </aside>

    <main v-if="selectedPromptSnippet" class="prompt-editor-pane">
      <header class="prompt-editor-header">
        <input
          v-model="selectedPromptSnippet.title"
          class="prompt-title-input"
          aria-label="提示词标题"
          @blur="saveSelectedPrompt"
          @keydown.enter.prevent="saveSelectedPrompt"
        />
        <button class="toolbar-button" type="button" aria-label="删除提示词" data-tooltip="删除提示词" @click="deleteSelectedPromptSnippet">
          <MdDeleteOutline class="toolbar-icon" aria-hidden="true" />
        </button>
      </header>

      <section class="prompt-tag-section">
        <div class="prompt-tag-header">
          <h3>标签</h3>
          <div class="tag-add-wrap">
            <button class="toolbar-button" type="button" aria-label="添加标签" data-tooltip="添加标签" @click.stop="openTagPicker">
              <MdAdd class="toolbar-icon" aria-hidden="true" />
            </button>

            <div v-if="tagPickerOpen" class="tag-picker" @click.stop>
              <div class="tag-picker-search">
                <input
                  ref="tagPickerInputRef"
                  v-model="tagPickerQuery"
                  placeholder="搜索标签"
                  aria-label="搜索标签"
                  @keydown="handleTagPickerKeydown"
                />
                <button
                  v-if="canCreatePickerTag"
                  class="tag-create-button"
                  type="button"
                  aria-label="新建标签"
                  data-tooltip="新建标签"
                  @click="createAndAddTag"
                >
                  <MdAdd class="toolbar-icon" aria-hidden="true" />
                </button>
              </div>

              <div class="tag-picker-flow">
                <div
                  v-for="tag in filteredPickerTags"
                  :key="tagKey(tag)"
                  class="md-label-chip picker-chip"
                  :class="{ selected: isPromptTagSelected(tag) }"
                >
                  <button class="chip-main" type="button" @click="addTag(tag)">
                    <MdLabel class="chip-icon" aria-hidden="true" />
                    <span>{{ tag.name }}</span>
                  </button>
                  <button
                    v-if="isPromptTagSelected(tag)"
                    class="chip-remove"
                    type="button"
                    aria-label="移除标签"
                    @click="removeTag(tag)"
                  >
                    <MdClose class="chip-close-icon" aria-hidden="true" />
                  </button>
                </div>
                <span v-if="!filteredPickerTags.length" class="tag-empty-note">没有标签</span>
              </div>
            </div>
          </div>
        </div>

        <div class="selected-tag-flow">
          <div
            v-for="tag in selectedPromptSnippet.tags"
            :key="tagKey(tag)"
            class="md-label-chip selected-tag"
            @contextmenu="openTagContextMenu($event, tag)"
          >
            <span class="chip-main static">
              <MdLabel class="chip-icon" aria-hidden="true" />
              <span>{{ tag.name }}</span>
            </span>
            <button class="chip-remove" type="button" aria-label="移除标签" @click="removeTag(tag)">
              <MdClose class="chip-close-icon" aria-hidden="true" />
            </button>
          </div>
          <span v-if="!selectedPromptSnippet.tags.length" class="tag-empty-note">未添加标签</span>
        </div>
      </section>

      <section class="prompt-content-section">
        <div class="content-toolbar">
          <h3>内容</h3>
          <div class="mode-tabs" role="tablist" aria-label="内容模式">
            <button
              type="button"
              :class="{ active: contentMode === 'edit' }"
              @click="contentMode = 'edit'"
            >
              <MdEdit class="mode-icon" aria-hidden="true" />
              编辑
            </button>
            <button
              type="button"
              :class="{ active: contentMode === 'preview' }"
              @click="switchToPreview"
            >
              <MdVisibility class="mode-icon" aria-hidden="true" />
              预览
            </button>
          </div>
        </div>

        <textarea
          v-if="contentMode === 'edit'"
          v-model="selectedPromptSnippet.content"
          class="prompt-content-input"
          rows="18"
          aria-label="提示词内容"
          @blur="saveSelectedPrompt"
        />
        <div v-else class="prompt-preview-pane">
          <MarkdownView v-if="selectedPromptSnippet.content.trim()" :markdown="selectedPromptSnippet.content" />
          <span v-else class="tag-empty-note">无内容</span>
        </div>
      </section>

      <div
        v-if="tagContextMenu"
        class="tag-context-menu"
        :style="{ left: `${tagContextMenu.x}px`, top: `${tagContextMenu.y}px` }"
        @click.stop
      >
        <button type="button" @click="renameContextTag">
          <MdEdit class="menu-icon" aria-hidden="true" />重命名
        </button>
        <button class="danger-menu-item" type="button" @click="deleteContextTag">
          <MdDeleteOutline class="menu-icon" aria-hidden="true" />删除
        </button>
      </div>
    </main>

    <main v-else class="prompt-empty">
      <button class="primary-button" type="button" @click="createPromptSnippet">新建提示词</button>
    </main>
  </section>
</template>

<style scoped>
.prompt-page {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #ffffff;
}

.prompt-list-pane {
  min-width: 0;
  overflow: auto;
  border-right: 1px solid #dde3eb;
  padding: 0 10px 12px;
}

.prompt-search {
  position: relative;
  margin-bottom: 8px;
}

.prompt-search input {
  padding-left: 32px;
}

.prompt-search-icon {
  position: absolute;
  top: 50%;
  left: 9px;
  width: 17px;
  height: 17px;
  transform: translateY(-50%);
  color: #7d8898;
}

.filter-block {
  margin-bottom: 10px;
}

.filter-tag-flow,
.selected-tag-flow,
.tag-picker-flow,
.prompt-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.prompt-list {
  display: grid;
  gap: 7px;
}

.prompt-list-item {
  min-width: 0;
  display: grid;
  gap: 6px;
  text-align: left;
  border: 1px solid #d4dbe4;
  border-radius: 8px;
  background: #ffffff;
  padding: 9px;
  color: #243041;
}

.prompt-list-item.selected {
  border-color: #2f6fca;
  background: #f4f8ff;
}

.prompt-list-item strong {
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prompt-list-item span {
  min-width: 0;
  overflow: hidden;
  color: #637083;
  display: -webkit-box;
  font-size: 12px;
  line-height: 1.4;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.prompt-list-item small {
  color: #8290a3;
  font-size: 11px;
}

.prompt-card-tags em {
  max-width: 100%;
  overflow: hidden;
  border: 1px solid #cfdaeb;
  border-radius: 5px;
  background: #f7faff;
  color: #49617f;
  padding: 1px 5px;
  font-size: 11px;
  font-style: normal;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prompt-editor-pane {
  position: relative;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  overflow: hidden;
}

.prompt-editor-header {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid #edf0f4;
  padding: 6px 12px;
}

.prompt-title-input {
  width: min(520px, 100%);
  font-size: 14px;
  font-weight: 600;
}

.prompt-tag-section,
.prompt-content-section {
  min-width: 0;
  padding: 10px 12px;
}

.prompt-tag-section {
  border-bottom: 1px solid #edf0f4;
}

.prompt-tag-header,
.content-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.prompt-tag-header h3,
.content-toolbar h3 {
  margin: 0;
  color: #344050;
  font-size: 13px;
}

.tag-add-wrap {
  position: relative;
}

.md-label-chip {
  min-width: 0;
  max-width: 100%;
  display: inline-flex;
  align-items: center;
  overflow: hidden;
  border: 1px solid #cbd6e5;
  border-radius: 6px;
  background: #ffffff;
  color: #45556a;
  font-size: 12px;
  line-height: 1;
}

.md-label-chip.selected,
.filter-chip.selected {
  border-color: #2f6fca;
  background: #eef5ff;
  color: #174f99;
}

.filter-chip {
  gap: 5px;
  min-height: 28px;
  padding: 0 8px;
}

.chip-main,
.chip-main.static {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  background: transparent;
  color: inherit;
  padding: 6px 8px;
}

.chip-main span,
.filter-chip span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.chip-remove {
  width: 24px;
  align-self: stretch;
  display: grid;
  place-items: center;
  border: 0;
  border-left: 1px solid #d9e1ec;
  background: transparent;
  color: inherit;
  padding: 0;
}

.chip-remove:hover,
.chip-main:hover {
  background: rgba(47, 111, 202, 0.08);
}

.chip-close-icon {
  width: 14px;
  height: 14px;
}

.tag-empty-note {
  align-self: center;
  color: #7d8898;
  font-size: 12px;
}

.tag-picker {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  width: min(360px, 78vw);
  display: grid;
  gap: 8px;
  border: 1px solid #cbd6e5;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 10px 28px rgba(31, 41, 53, 0.16);
  padding: 10px;
}

.tag-picker-search {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
}

.tag-create-button {
  position: relative;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: #eef5ff;
  color: #174f99;
}

.tag-create-button:hover {
  background: #dfeaff;
}

.tag-picker-flow {
  max-height: 210px;
  overflow: auto;
}

.picker-chip .chip-main {
  cursor: pointer;
}

.prompt-content-section {
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
}

.mode-tabs {
  display: inline-flex;
  overflow: hidden;
  border: 1px solid #cbd6e5;
  border-radius: 8px;
  background: #f7f9fc;
}

.mode-tabs button {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  background: transparent;
  color: #536071;
  padding: 5px 9px;
  font-size: 12px;
}

.mode-tabs button.active {
  background: #ffffff;
  color: #174f99;
  box-shadow: 0 0 0 1px #dce6ff inset;
}

.mode-icon {
  width: 16px;
  height: 16px;
}

.prompt-content-input,
.prompt-preview-pane {
  min-width: 0;
  min-height: 0;
}

.prompt-content-input {
  height: 100%;
  resize: none;
}

.prompt-preview-pane {
  overflow: auto;
  border: 1px solid #cfd7e2;
  border-radius: 8px;
  background: #ffffff;
  padding: 10px;
}

.tag-context-menu {
  position: fixed;
  z-index: 50;
  min-width: 132px;
  overflow: hidden;
  border: 1px solid #cbd6e5;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(31, 41, 53, 0.16);
  padding: 4px;
}

.tag-context-menu button {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 7px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #2f3c4d;
  padding: 7px 8px;
  text-align: left;
}

.tag-context-menu button:hover {
  background: #eef2f7;
}

.danger-menu-item {
  color: #9d2c2c !important;
}

.menu-icon {
  width: 17px;
  height: 17px;
}

.prompt-empty {
  display: grid;
  place-items: center;
  background: #ffffff;
}

@media (max-width: 980px) {
  .prompt-page {
    grid-template-columns: 260px minmax(0, 1fr);
  }
}
</style>
