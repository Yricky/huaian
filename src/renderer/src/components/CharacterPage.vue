<script setup lang="ts">
import { useProjectWorkbench } from '../composables/useProjectWorkbench'

const {
  characterAdvancedJson,
  characterData,
  characterExtensions,
  characterGreetingsText,
  characterListName,
  characterListNotes,
  characterListTags,
  characterListVersion,
  characterSelectedWorldEntries,
  characterTagsText,
  characters,
  createCharacter,
  deleteSelectedCharacter,
  depthPrompt,
  draggingCharacterWorldIndex,
  entryTitle,
  exportSelectedCharacter,
  isCharacterWorldSelected,
  moveCharacterWorldEntry,
  saveCharacter,
  saveCharacterAdvanced,
  selectCharacter,
  selectedCharacter,
  toggleCharacterWorldEntry,
  worldEntries
} = useProjectWorkbench()
</script>

<template>
  <section class="page-grid">
    <div class="list-pane">
      <div class="pane-header">
        <h2>角色卡</h2>
        <button class="primary-button" @click="createCharacter">新建</button>
      </div>
      <div class="card-grid">
        <button
          v-for="entry in characters"
          :key="entry.id"
          class="item-card"
          :class="{ selected: selectedCharacter?.id === entry.id }"
          @click="selectCharacter(entry)"
        >
          <strong>{{ characterListName(entry) }}</strong>
          <span>{{ characterListNotes(entry) }}</span>
          <small>{{ characterListVersion(entry) }}</small>
          <div class="tag-row">
            <em v-for="tag in characterListTags(entry)" :key="tag">{{ tag }}</em>
          </div>
        </button>
      </div>
    </div>

    <div v-if="selectedCharacter" class="editor-pane">
      <div class="pane-header">
        <h2>{{ characterData.name || '角色卡详情' }}</h2>
        <div class="button-row">
          <button class="outline-button" @click="exportSelectedCharacter">导出 JSON</button>
          <button class="danger-button" @click="deleteSelectedCharacter">删除</button>
        </div>
      </div>

      <div class="form-grid two">
        <label>名称<input v-model="characterData.name" @blur="saveCharacter" /></label>
        <label>版本<input v-model="characterData.character_version" @blur="saveCharacter" /></label>
        <label>作者<input v-model="characterData.creator" @blur="saveCharacter" /></label>
        <label>导出文件名<input v-model="selectedCharacter.forgeData.exportFileName" placeholder="默认使用角色名" @blur="saveCharacter" /></label>
        <label>内嵌世界书名<input v-model="selectedCharacter.forgeData.characterBookName" placeholder="默认使用角色名" @blur="saveCharacter" /></label>
        <label>健谈度<input v-model.number="characterExtensions.talkativeness" type="number" min="0" max="1" step="0.05" @blur="saveCharacter" /></label>
      </div>

      <div class="form-grid">
        <label>描述<textarea v-model="characterData.description" rows="5" @blur="saveCharacter" /></label>
        <label>性格<textarea v-model="characterData.personality" rows="3" @blur="saveCharacter" /></label>
        <label>场景<textarea v-model="characterData.scenario" rows="3" @blur="saveCharacter" /></label>
        <label>首条消息<textarea v-model="characterData.first_mes" rows="5" @blur="saveCharacter" /></label>
        <label>示例对话<textarea v-model="characterData.mes_example" rows="5" @blur="saveCharacter" /></label>
        <label>作者备注<textarea v-model="characterData.creator_notes" rows="3" @blur="saveCharacter" /></label>
        <label>System Prompt<textarea v-model="characterData.system_prompt" rows="3" @blur="saveCharacter" /></label>
        <label>Post-History Instructions<textarea v-model="characterData.post_history_instructions" rows="3" @blur="saveCharacter" /></label>
        <label>标签<input v-model="characterTagsText" placeholder="tag1, tag2" @blur="saveCharacter" /></label>
        <label>备用开场<textarea v-model="characterGreetingsText" rows="5" placeholder="用单独一行 --- 分隔多个开场" @blur="saveCharacter" /></label>
        <label>Depth Prompt<textarea v-model="depthPrompt.prompt" rows="3" @blur="saveCharacter" /></label>
      </div>

      <div class="form-grid three compact">
        <label>Depth<input v-model.number="depthPrompt.depth" type="number" min="0" @blur="saveCharacter" /></label>
        <label>Role
          <select v-model="depthPrompt.role" @change="saveCharacter">
            <option value="system">system</option>
            <option value="user">user</option>
            <option value="assistant">assistant</option>
          </select>
        </label>
      </div>

      <div class="relation-block">
        <h3>内嵌世界书条目</h3>
        <div class="sortable-list">
          <div
            v-for="(entry, index) in characterSelectedWorldEntries"
            :key="entry.id"
            class="sortable-row"
            draggable="true"
            @dragstart="draggingCharacterWorldIndex = index"
            @dragover.prevent
            @drop="moveCharacterWorldEntry(index)"
          >
            <span>{{ index + 1 }}. {{ entryTitle(entry) }}</span>
            <button @click="toggleCharacterWorldEntry(entry.id)">移除</button>
          </div>
        </div>
        <div class="mini-grid">
          <button
            v-for="entry in worldEntries"
            :key="entry.id"
            :class="{ selected: isCharacterWorldSelected(entry.id) }"
            @click="toggleCharacterWorldEntry(entry.id)"
          >
            {{ entryTitle(entry) }}
          </button>
        </div>
      </div>

      <label class="json-block">高级 JSON
        <textarea v-model="characterAdvancedJson" rows="14" spellcheck="false" @blur="saveCharacterAdvanced" />
      </label>
    </div>
  </section>
</template>
