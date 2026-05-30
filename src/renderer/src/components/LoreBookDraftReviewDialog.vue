<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { LoreBookDraftApplyPayload, LoreBookDraftChange, LoreBookDraftSummary } from '../../../shared/types'

const props = defineProps<{
  drafts: LoreBookDraftSummary[]
}>()

const emit = defineEmits<{
  apply: [payload: LoreBookDraftApplyPayload]
  close: []
  discard: [loreBookId: number]
}>()

const selectedLoreBookId = ref<number | null>(null)
const selectedEntryIds = ref<number[]>([])

const selectedDraft = computed(() => (
  props.drafts.find(draft => draft.loreBookId === selectedLoreBookId.value) ?? props.drafts[0] ?? null
))

watch(() => props.drafts, () => {
  if (!props.drafts.length) {
    selectedLoreBookId.value = null
    selectedEntryIds.value = []
    return
  }
  if (!props.drafts.some(draft => draft.loreBookId === selectedLoreBookId.value)) {
    selectedLoreBookId.value = props.drafts[0].loreBookId
  }
}, { immediate: true })

watch(selectedDraft, (draft) => {
  selectedEntryIds.value = draft ? draft.changes.map(change => change.id) : []
}, { immediate: true })

function changeSummary(change: LoreBookDraftChange): string {
  const keys = change.draft.keys.join(', ')
  return [change.kind === 'created' ? '新建' : '更新', keys].filter(Boolean).join(' · ')
}

function entryJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function toggleEntry(id: number, checked: boolean) {
  selectedEntryIds.value = checked
    ? [...new Set([...selectedEntryIds.value, id])]
    : selectedEntryIds.value.filter(entryId => entryId !== id)
}

function applySelected() {
  const draft = selectedDraft.value
  if (!draft) return
  emit('apply', {
    loreBookId: draft.loreBookId,
    entryIds: selectedEntryIds.value
  })
}

function discardSelected() {
  const draft = selectedDraft.value
  if (!draft) return
  emit('discard', draft.loreBookId)
}
</script>

<template>
  <Teleport to="body">
    <div class="dialog-backdrop" @click.self="emit('close')">
      <section class="draft-dialog" role="dialog" aria-modal="true" aria-label="审阅世界书改动">
        <header class="dialog-header">
          <div>
            <h2>审阅世界书改动</h2>
            <p v-if="selectedDraft">{{ selectedDraft.loreBookName }} · {{ selectedDraft.changes.length }} 项改动</p>
          </div>
          <button class="ghost-button" type="button" @click="emit('close')">关闭</button>
        </header>

        <label v-if="drafts.length > 1" class="draft-select">
          <span>副本</span>
          <select v-model.number="selectedLoreBookId">
            <option v-for="draft in drafts" :key="draft.loreBookId" :value="draft.loreBookId">
              {{ draft.loreBookName }} · {{ draft.changes.length }} 项
            </option>
          </select>
        </label>

        <div v-if="selectedDraft" class="change-list">
          <article v-for="change in selectedDraft.changes" :key="change.id" class="change-item">
            <header>
              <label>
                <input type="checkbox" :checked="selectedEntryIds.includes(change.id)"
                  @change="toggleEntry(change.id, ($event.target as HTMLInputElement).checked)" />
                <strong>{{ change.title }}</strong>
              </label>
              <span>{{ changeSummary(change) }}</span>
            </header>
            <div class="diff-grid">
              <section>
                <h3>原版</h3>
                <pre>{{ change.original ? entryJson(change.original) : '（新条目）' }}</pre>
              </section>
              <section>
                <h3>副本</h3>
                <pre>{{ entryJson(change.draft) }}</pre>
              </section>
            </div>
          </article>
        </div>

        <p v-else class="empty-state">没有待审阅的世界书改动。</p>

        <footer class="dialog-actions">
          <button class="outline-button" type="button" :disabled="!selectedDraft" @click="discardSelected">丢弃副本</button>
          <button class="primary-button" type="button" :disabled="!selectedDraft || selectedEntryIds.length === 0"
            @click="applySelected">应用选中改动</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: grid;
  place-items: center;
  background: rgba(18, 24, 32, 0.34);
  padding: 24px;
}

.draft-dialog {
  width: min(1080px, 100%);
  max-height: min(780px, calc(100vh - 48px));
  min-width: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: 12px;
  overflow: hidden;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 20px 70px rgba(20, 28, 38, 0.28);
  padding: 16px;
}

.dialog-header,
.dialog-actions {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.dialog-header h2 {
  margin: 0;
  color: #273245;
  font-size: 18px;
}

.dialog-header p {
  margin: 4px 0 0;
  color: #6b7583;
  font-size: 12px;
}

.draft-select {
  display: grid;
  gap: 5px;
}

.draft-select span {
  color: #526173;
  font-size: 12px;
  font-weight: 600;
}

.change-list {
  min-width: 0;
  overflow: auto;
  display: grid;
  gap: 10px;
}

.change-item {
  min-width: 0;
  display: grid;
  gap: 8px;
  border: 1px solid #dfe6ee;
  border-radius: 8px;
  padding: 10px;
}

.change-item > header {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.change-item label {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.change-item strong,
.change-item span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.change-item strong {
  color: #273245;
  font-size: 13px;
}

.change-item span {
  color: #6b7583;
  font-size: 12px;
}

.diff-grid {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.diff-grid h3 {
  margin: 0 0 5px;
  color: #526173;
  font-size: 12px;
}

.diff-grid pre {
  max-height: 320px;
  min-width: 0;
  overflow: auto;
  margin: 0;
  border-radius: 7px;
  background: #f7f9fc;
  color: #303a49;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  padding: 9px;
  white-space: pre-wrap;
  word-break: break-word;
}

.empty-state {
  margin: 0;
  color: #6b7583;
  font-size: 13px;
}

.ghost-button {
  border: 0;
  background: transparent;
  color: #526173;
  font-weight: 600;
}

@media (max-width: 760px) {
  .diff-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
