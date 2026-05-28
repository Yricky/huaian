<script setup lang="ts">
import { useProjectWorkbench } from '../composables/useProjectWorkbench'

const {
  createWorldEntry,
  deleteSelectedWorldEntry,
  entrySummary,
  entryTitle,
  saveWorldEntry,
  saveWorldEntryAdvanced,
  selectWorldEntry,
  selectedWorldEntry,
  worldEntries,
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
        <h2>世界书条目</h2>
        <button class="primary-button" @click="createWorldEntry">新建</button>
      </div>
      <div class="card-grid">
        <button
          v-for="entry in worldEntries"
          :key="entry.id"
          class="item-card"
          :class="{ selected: selectedWorldEntry?.id === entry.id }"
          @click="selectWorldEntry(entry)"
        >
          <strong>{{ entryTitle(entry) }}</strong>
          <span>{{ entrySummary(entry) || '无关键词' }}</span>
          <small>{{ entry.stData.enabled ? '启用' : '停用' }} · Order {{ entry.stData.insertion_order }}</small>
        </button>
      </div>
    </div>

    <div v-if="selectedWorldEntry" class="editor-pane">
      <div class="pane-header">
        <h2>{{ entryTitle(selectedWorldEntry) }}</h2>
        <button class="danger-button" @click="deleteSelectedWorldEntry">删除</button>
      </div>
      <div class="form-grid two">
        <label>标题/Memo<input v-model="worldEntryData.comment" @blur="saveWorldEntry" /></label>
        <label>Order<input v-model.number="worldEntryData.insertion_order" type="number" min="0" @blur="saveWorldEntry" /></label>
        <label>Position
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
        <label>Role
          <select v-model="worldEntryRole" @change="saveWorldEntry">
            <option value="0">System</option>
            <option value="1">User</option>
            <option value="2">Assistant</option>
          </select>
        </label>
        <label>Depth<input v-model.number="worldEntryDepth" type="number" min="0" @blur="saveWorldEntry" /></label>
        <label>Trigger %<input v-model.number="worldEntryProbability" type="number" min="0" max="100" @blur="saveWorldEntry" /></label>
      </div>
      <div class="switch-row">
        <label><input v-model="worldEntryData.enabled" type="checkbox" @change="saveWorldEntry" /> 启用</label>
        <label><input v-model="worldEntryData.constant" type="checkbox" @change="saveWorldEntry" /> 常驻</label>
        <label><input v-model="worldEntryData.selective" type="checkbox" @change="saveWorldEntry" /> 次关键词逻辑</label>
      </div>
      <div class="form-grid">
        <label>主关键词<input v-model="worldEntryKeysText" placeholder="keyword1, keyword2" @blur="saveWorldEntry" /></label>
        <label>次关键词<input v-model="worldEntrySecondaryKeysText" placeholder="keyword1, keyword2" @blur="saveWorldEntry" /></label>
        <label>内容<textarea v-model="worldEntryData.content" rows="9" @blur="saveWorldEntry" /></label>
      </div>
      <label class="json-block">高级 JSON
        <textarea v-model="worldEntryAdvancedJson" rows="14" spellcheck="false" @blur="saveWorldEntryAdvanced" />
      </label>
    </div>
  </section>
</template>
