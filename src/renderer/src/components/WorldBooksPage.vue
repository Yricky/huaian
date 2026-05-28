<script setup lang="ts">
import { MdAdd, MdDeleteOutline, MdFileDownload } from 'vue-icons-plus/md'
import { worldBookFieldHints, worldEntryFieldHints } from '../fieldHints'
import { useProjectWorkbench } from '../composables/useProjectWorkbench'

const {
  createWorldBook,
  createWorldEntry,
  deleteSelectedWorldBook,
  deleteSelectedWorldEntry,
  entrySummary,
  entryTitle,
  exportSelectedWorldBook,
  formatDate,
  isWorldEntryExpanded,
  moveWorldBookEntry,
  saveWorldBook,
  saveWorldEntry,
  saveWorldEntryAdvanced,
  selectWorldBook,
  selectWorldEntry,
  selectedWorldBook,
  selectedWorldBookEntries,
  selectedWorldEntry,
  startWorldEntryDrag,
  worldBookEntryCount,
  worldBooks,
  worldEntryAdvancedJson,
  worldEntryData,
  worldEntryDepth,
  worldEntryKeysText,
  worldEntryPosition,
  worldEntryProbability,
  worldEntryRole,
  worldEntrySecondaryKeysText
} = useProjectWorkbench()
</script>

<template>
  <section class="page-grid">
    <div class="list-pane">
      <div class="pane-header">
        <h2>世界书</h2>
        <button class="toolbar-button" type="button" aria-label="新建" data-tooltip="新建" @click="createWorldBook">
          <MdAdd class="toolbar-icon" aria-hidden="true" />
        </button>
      </div>
      <div class="card-grid">
        <button
          v-for="book in worldBooks"
          :key="book.id"
          class="item-card"
          :class="{ selected: selectedWorldBook?.id === book.id }"
          type="button"
          @click="selectWorldBook(book)"
        >
          <strong>{{ book.name }}</strong>
          <span>{{ worldBookEntryCount(book) }} 个条目</span>
          <small>更新 {{ formatDate(book.updatedAt) }}</small>
        </button>
      </div>
    </div>

    <div v-if="selectedWorldBook" class="editor-pane">
      <div class="pane-header">
        <h2>{{ selectedWorldBook.name }}</h2>
        <div class="button-row">
          <button class="toolbar-button" type="button" aria-label="新增条目" data-tooltip="新增条目" @click="createWorldEntry">
            <MdAdd class="toolbar-icon" aria-hidden="true" />
          </button>
          <button class="toolbar-button" type="button" aria-label="导出 JSON" data-tooltip="导出 JSON" @click="exportSelectedWorldBook">
            <MdFileDownload class="toolbar-icon" aria-hidden="true" />
          </button>
          <button class="toolbar-button" type="button" aria-label="删除世界书" data-tooltip="删除世界书" @click="deleteSelectedWorldBook">
            <MdDeleteOutline class="toolbar-icon" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div class="form-grid">
        <label><span class="field-title" :data-tooltip="worldBookFieldHints.name">名称</span><input v-model="selectedWorldBook.name" @blur="saveWorldBook" /></label>
      </div>

      <div class="world-entry-stack">
        <article
          v-for="(entry, index) in selectedWorldBookEntries"
          :key="entry.id"
          class="world-entry-row"
          :class="{ expanded: isWorldEntryExpanded(entry.id) }"
          draggable="true"
          @dragstart="startWorldEntryDrag(index)"
          @dragover.prevent
          @drop="moveWorldBookEntry(index)"
        >
          <button class="world-entry-summary" type="button" @click="selectWorldEntry(entry)">
            <strong>{{ entry.stData.insertion_order }}. {{ entryTitle(entry) }}</strong>
            <span>{{ entrySummary(entry) || '无关键词' }}</span>
            <small>{{ entry.stData.enabled ? '启用' : '停用' }}</small>
          </button>

          <div v-if="selectedWorldEntry && isWorldEntryExpanded(entry.id)" class="world-entry-editor">
            <div class="entry-editor-header">
              <strong>Order {{ worldEntryData.insertion_order }}</strong>
              <button class="toolbar-button" type="button" aria-label="删除条目" data-tooltip="删除条目" @click="deleteSelectedWorldEntry">
                <MdDeleteOutline class="toolbar-icon" aria-hidden="true" />
              </button>
            </div>

            <div class="form-grid two">
              <label><span class="field-title" :data-tooltip="worldEntryFieldHints.comment">标题/Memo</span><input v-model="worldEntryData.comment" @blur="saveWorldEntry" /></label>
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
              <label><span class="field-title" :data-tooltip="worldEntryFieldHints.role">Role</span>
                <select v-model="worldEntryRole" @change="saveWorldEntry">
                  <option value="0">System</option>
                  <option value="1">User</option>
                  <option value="2">Assistant</option>
                </select>
              </label>
              <label><span class="field-title" :data-tooltip="worldEntryFieldHints.depth">Depth</span><input v-model.number="worldEntryDepth" type="number" min="0" @blur="saveWorldEntry" /></label>
              <label><span class="field-title" :data-tooltip="worldEntryFieldHints.probability">Trigger %</span><input v-model.number="worldEntryProbability" type="number" min="0" max="100" @blur="saveWorldEntry" /></label>
            </div>

            <div class="switch-row">
              <label><input v-model="worldEntryData.enabled" type="checkbox" @change="saveWorldEntry" /> <span class="field-title" :data-tooltip="worldEntryFieldHints.enabled">启用</span></label>
              <label><input v-model="worldEntryData.constant" type="checkbox" @change="saveWorldEntry" /> <span class="field-title" :data-tooltip="worldEntryFieldHints.constant">常驻</span></label>
              <label><input v-model="worldEntryData.selective" type="checkbox" @change="saveWorldEntry" /> <span class="field-title" :data-tooltip="worldEntryFieldHints.selective">次关键词逻辑</span></label>
            </div>

            <div class="form-grid">
              <label><span class="field-title" :data-tooltip="worldEntryFieldHints.keys">主关键词</span><input v-model="worldEntryKeysText" placeholder="keyword1, keyword2" @blur="saveWorldEntry" /></label>
              <label><span class="field-title" :data-tooltip="worldEntryFieldHints.secondaryKeys">次关键词</span><input v-model="worldEntrySecondaryKeysText" placeholder="keyword1, keyword2" @blur="saveWorldEntry" /></label>
              <label><span class="field-title" :data-tooltip="worldEntryFieldHints.content">内容</span><textarea v-model="worldEntryData.content" rows="9" @blur="saveWorldEntry" /></label>
            </div>

            <label class="json-block"><span class="field-title" :data-tooltip="worldEntryFieldHints.advancedJson">高级 JSON</span>
              <textarea v-model="worldEntryAdvancedJson" rows="14" spellcheck="false" @blur="saveWorldEntryAdvanced" />
            </label>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.world-entry-stack {
  display: grid;
  gap: 8px;
}

.world-entry-row {
  border: 1px solid #d4dbe4;
  border-radius: 8px;
  background: #ffffff;
  overflow: hidden;
}

.world-entry-row.expanded {
  border-color: #2f6fca;
}

.world-entry-summary {
  width: 100%;
  min-height: 52px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 3px 10px;
  border: 0;
  background: #fbfcfd;
  padding: 9px 10px;
  text-align: left;
}

.world-entry-summary strong,
.world-entry-summary span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.world-entry-summary strong {
  color: #243041;
  font-size: 13px;
}

.world-entry-summary span {
  color: #637083;
  font-size: 12px;
}

.world-entry-summary small {
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
</style>
