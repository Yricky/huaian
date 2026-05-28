<script setup lang="ts">
import { MdAdd, MdDeleteOutline, MdFileDownload } from 'vue-icons-plus/md'
import { characterFieldHints } from '../fieldHints'
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
  characterSelectedWorldBook,
  characterTagsText,
  characters,
  clearCharacterWorldBook,
  createCharacter,
  deleteSelectedCharacter,
  depthPrompt,
  exportSelectedCharacter,
  isCharacterWorldBookSelected,
  saveCharacter,
  saveCharacterAdvanced,
  selectCharacter,
  selectCharacterWorldBook,
  selectedCharacter,
  worldBookEntryCount,
  worldBooks
} = useProjectWorkbench()
</script>

<template>
  <section class="page-grid">
    <div class="list-pane">
      <div class="pane-header">
        <h2>角色卡</h2>
        <button class="toolbar-button" type="button" aria-label="新建" data-tooltip="新建" @click="createCharacter">
          <MdAdd class="toolbar-icon" aria-hidden="true" />
        </button>
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
          <button class="toolbar-button" type="button" aria-label="导出 JSON" data-tooltip="导出 JSON" @click="exportSelectedCharacter">
            <MdFileDownload class="toolbar-icon" aria-hidden="true" />
          </button>
          <button class="toolbar-button" type="button" aria-label="删除" data-tooltip="删除" @click="deleteSelectedCharacter">
            <MdDeleteOutline class="toolbar-icon" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div class="form-grid two">
        <label><span class="field-title" :data-tooltip="characterFieldHints.name">名称</span><input v-model="characterData.name" @blur="saveCharacter" /></label>
        <label><span class="field-title" :data-tooltip="characterFieldHints.version">版本</span><input v-model="characterData.character_version" @blur="saveCharacter" /></label>
        <label><span class="field-title" :data-tooltip="characterFieldHints.creator">作者</span><input v-model="characterData.creator" @blur="saveCharacter" /></label>
        <label><span class="field-title" :data-tooltip="characterFieldHints.exportFileName">导出文件名</span><input v-model="selectedCharacter.forgeData.exportFileName" placeholder="默认使用角色名" @blur="saveCharacter" /></label>
        <label><span class="field-title" :data-tooltip="characterFieldHints.characterBookName">内嵌世界书名</span><input v-model="selectedCharacter.forgeData.characterBookName" placeholder="默认使用角色名" @blur="saveCharacter" /></label>
        <label><span class="field-title" :data-tooltip="characterFieldHints.talkativeness">健谈度</span><input v-model.number="characterExtensions.talkativeness" type="number" min="0" max="1" step="0.05" @blur="saveCharacter" /></label>
      </div>

      <div class="form-grid">
        <label><span class="field-title" :data-tooltip="characterFieldHints.description">描述</span><textarea v-model="characterData.description" rows="5" @blur="saveCharacter" /></label>
        <label><span class="field-title" :data-tooltip="characterFieldHints.personality">性格</span><textarea v-model="characterData.personality" rows="3" @blur="saveCharacter" /></label>
        <label><span class="field-title" :data-tooltip="characterFieldHints.scenario">场景</span><textarea v-model="characterData.scenario" rows="3" @blur="saveCharacter" /></label>
        <label><span class="field-title" :data-tooltip="characterFieldHints.firstMessage">首条消息</span><textarea v-model="characterData.first_mes" rows="5" @blur="saveCharacter" /></label>
        <label><span class="field-title" :data-tooltip="characterFieldHints.examples">示例对话</span><textarea v-model="characterData.mes_example" rows="5" @blur="saveCharacter" /></label>
        <label><span class="field-title" :data-tooltip="characterFieldHints.creatorNotes">作者备注</span><textarea v-model="characterData.creator_notes" rows="3" @blur="saveCharacter" /></label>
        <label><span class="field-title" :data-tooltip="characterFieldHints.systemPrompt">System Prompt</span><textarea v-model="characterData.system_prompt" rows="3" @blur="saveCharacter" /></label>
        <label><span class="field-title" :data-tooltip="characterFieldHints.postHistoryInstructions">Post-History Instructions</span><textarea v-model="characterData.post_history_instructions" rows="3" @blur="saveCharacter" /></label>
        <label><span class="field-title" :data-tooltip="characterFieldHints.tags">标签</span><input v-model="characterTagsText" placeholder="tag1, tag2" @blur="saveCharacter" /></label>
        <label><span class="field-title" :data-tooltip="characterFieldHints.alternateGreetings">备用开场</span><textarea v-model="characterGreetingsText" rows="5" placeholder="用单独一行 --- 分隔多个开场" @blur="saveCharacter" /></label>
        <label><span class="field-title" :data-tooltip="characterFieldHints.depthPrompt">Depth Prompt</span><textarea v-model="depthPrompt.prompt" rows="3" @blur="saveCharacter" /></label>
      </div>

      <div class="form-grid three compact">
        <label><span class="field-title" :data-tooltip="characterFieldHints.depth">Depth</span><input v-model.number="depthPrompt.depth" type="number" min="0" @blur="saveCharacter" /></label>
        <label><span class="field-title" :data-tooltip="characterFieldHints.role">Role</span>
          <select v-model="depthPrompt.role" @change="saveCharacter">
            <option value="system">system</option>
            <option value="user">user</option>
            <option value="assistant">assistant</option>
          </select>
        </label>
      </div>

      <div class="relation-block">
        <div class="relation-header">
          <h3>关联世界书</h3>
          <button v-if="characterSelectedWorldBook" type="button" @click="clearCharacterWorldBook">移除</button>
        </div>
        <div v-if="characterSelectedWorldBook" class="selected-relation">
          <strong>{{ characterSelectedWorldBook.name }}</strong>
          <span>{{ worldBookEntryCount(characterSelectedWorldBook) }} 个条目</span>
        </div>
        <div v-else class="empty-note">未关联世界书</div>
        <div class="mini-grid">
          <button
            v-for="book in worldBooks"
            :key="book.id"
            type="button"
            :class="{ selected: isCharacterWorldBookSelected(book.id) }"
            @click="selectCharacterWorldBook(book.id)"
          >
            {{ book.name }}
          </button>
        </div>
      </div>

      <label class="json-block"><span class="field-title" :data-tooltip="characterFieldHints.advancedJson">高级 JSON</span>
        <textarea v-model="characterAdvancedJson" rows="14" spellcheck="false" @blur="saveCharacterAdvanced" />
      </label>
    </div>
  </section>
</template>

<style scoped>
.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tag-row em {
  border: 1px solid #d5dce5;
  border-radius: 6px;
  padding: 2px 5px;
  color: #5d6876;
  font-size: 11px;
  font-style: normal;
}

.relation-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.relation-header h3 {
  margin: 0;
}

.relation-header button {
  border: 1px solid #d4dbe4;
  border-radius: 7px;
  background: #ffffff;
  padding: 3px 8px;
}

.selected-relation,
.empty-note {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid #d4dbe4;
  border-radius: 8px;
  background: #fbfcfd;
  padding: 7px 9px;
  margin-bottom: 8px;
}

.selected-relation strong {
  min-width: 0;
  overflow: hidden;
  color: #243041;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selected-relation span,
.empty-note {
  color: #6d7887;
  font-size: 12px;
}
</style>
