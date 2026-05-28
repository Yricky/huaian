<script setup lang="ts">
import { useProjectWorkbench } from '../composables/useProjectWorkbench'

const {
  createWorldBook,
  deleteSelectedWorldBook,
  draggingWorldBookIndex,
  entryTitle,
  exportSelectedWorldBook,
  isWorldBookEntrySelected,
  moveWorldBookEntry,
  saveWorldBook,
  selectWorldBook,
  selectedWorldBook,
  toggleWorldBookEntry,
  worldBookSelectedEntries,
  worldBooks,
  worldEntries
} = useProjectWorkbench()
</script>

<template>
  <section class="page-grid">
    <div class="list-pane">
      <div class="pane-header">
        <h2>世界书</h2>
        <button class="primary-button" @click="createWorldBook">新建</button>
      </div>
      <div class="card-grid">
        <button
          v-for="book in worldBooks"
          :key="book.id"
          class="item-card"
          :class="{ selected: selectedWorldBook?.id === book.id }"
          @click="selectWorldBook(book)"
        >
          <strong>{{ book.name }}</strong>
          <span>{{ book.worldEntryIds.length }} 个条目</span>
          <small>{{ book.exportFileName || '默认文件名' }}</small>
        </button>
      </div>
    </div>

    <div v-if="selectedWorldBook" class="editor-pane">
      <div class="pane-header">
        <h2>{{ selectedWorldBook.name }}</h2>
        <div class="button-row">
          <button class="outline-button" @click="exportSelectedWorldBook">导出 JSON</button>
          <button class="danger-button" @click="deleteSelectedWorldBook">删除</button>
        </div>
      </div>
      <div class="form-grid two">
        <label>名称<input v-model="selectedWorldBook.name" @blur="saveWorldBook" /></label>
        <label>导出文件名<input v-model="selectedWorldBook.exportFileName" placeholder="默认使用配置名" @blur="saveWorldBook" /></label>
      </div>
      <div class="relation-block">
        <h3>导出条目顺序</h3>
        <div class="sortable-list">
          <div
            v-for="(entry, index) in worldBookSelectedEntries"
            :key="entry.id"
            class="sortable-row"
            draggable="true"
            @dragstart="draggingWorldBookIndex = index"
            @dragover.prevent
            @drop="moveWorldBookEntry(index)"
          >
            <span>{{ index + 1 }}. {{ entryTitle(entry) }}</span>
            <button @click="toggleWorldBookEntry(entry.id)">移除</button>
          </div>
        </div>
        <div class="mini-grid">
          <button
            v-for="entry in worldEntries"
            :key="entry.id"
            :class="{ selected: isWorldBookEntrySelected(entry.id) }"
            @click="toggleWorldBookEntry(entry.id)"
          >
            {{ entryTitle(entry) }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
