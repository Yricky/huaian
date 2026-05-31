<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  api,
  asRecord,
  asString,
  characterBook,
  characterName,
  parseJsonObject,
  stripExtension,
  worldBookEntryCount,
  type JsonRecord,
  type PluginFileEntry
} from './bridge'

interface CharacterItem {
  file: PluginFileEntry
  name: string
  embeddedBookName: string
  embeddedEntryCount: number
}

interface WorldBookItem {
  file: PluginFileEntry
  name: string
  entryCount: number
}

interface ConfigDraft {
  characterFile: string
  worldBookFiles: string[]
}

const characters = ref<CharacterItem[]>([])
const worldBooks = ref<WorldBookItem[]>([])
const savedConfig = ref<JsonRecord>({})
const draft = ref<ConfigDraft>({ characterFile: '', worldBookFiles: [] })
const busy = ref(false)
const dirty = ref(false)
const status = ref('')
const error = ref('')

const selectedCharacter = computed(() => (
  characters.value.find(item => item.file.name === draft.value.characterFile) ?? null
))
const selectedWorldBooks = computed(() => (
  draft.value.worldBookFiles
    .map(fileName => worldBooks.value.find(item => item.file.name === fileName) ?? null)
    .filter((item): item is WorldBookItem => item !== null)
))
const missingWorldBooks = computed(() => (
  draft.value.worldBookFiles.filter(fileName => !worldBooks.value.some(item => item.file.name === fileName))
))
const unselectedWorldBooks = computed(() => (
  worldBooks.value.filter(item => !draft.value.worldBookFiles.includes(item.file.name))
))
const selectedExternalCount = computed(() => selectedWorldBooks.value.length)

function setStatus(message: string, failed = false): void {
  status.value = failed ? '' : message
  error.value = failed ? message : ''
}

function markDirty(): void {
  dirty.value = true
  setStatus('')
}

function jsonFiles(files: PluginFileEntry[]): PluginFileEntry[] {
  return files.filter(file => !file.isDirectory && file.name.toLowerCase().endsWith('.json'))
}

function displayWorldBookName(book: JsonRecord, fallback: string): string {
  return asString(book.name, fallback).trim() || fallback
}

async function loadCharacter(file: PluginFileEntry): Promise<CharacterItem | null> {
  try {
    const card = parseJsonObject(await api.storage.readText(file.path))
    const book = characterBook(card)
    return {
      file,
      name: characterName(card, stripExtension(file.name)),
      embeddedBookName: book ? asString(book.name, '角色卡内置世界书') : '',
      embeddedEntryCount: book ? worldBookEntryCount(book) : 0
    }
  } catch {
    return null
  }
}

async function loadWorldBook(file: PluginFileEntry): Promise<WorldBookItem | null> {
  try {
    const book = parseJsonObject(await api.storage.readText(file.path))
    if (!Object.prototype.hasOwnProperty.call(book, 'entries')) return null
    return {
      file,
      name: displayWorldBookName(book, stripExtension(file.name)),
      entryCount: worldBookEntryCount(book)
    }
  } catch {
    return null
  }
}

function normalizeDraft(config: JsonRecord): ConfigDraft {
  const configuredCharacter = asString(config.characterFile)
  const firstCharacter = characters.value[0]?.file.name ?? ''
  return {
    characterFile: characters.value.some(item => item.file.name === configuredCharacter)
      ? configuredCharacter
      : firstCharacter,
    worldBookFiles: Array.isArray(config.worldBookFiles)
      ? config.worldBookFiles.map(String).filter((fileName, index, list) => list.indexOf(fileName) === index)
      : []
  }
}

async function refresh(): Promise<void> {
  const [characterFiles, worldBookFiles, pluginData] = await Promise.all([
    api.storage.list('characters'),
    api.storage.list('worldbooks'),
    api.chat.getPluginData()
  ])
  const loadedCharacters = await Promise.all(jsonFiles(characterFiles).map(loadCharacter))
  const loadedWorldBooks = await Promise.all(jsonFiles(worldBookFiles).map(loadWorldBook))
  characters.value = loadedCharacters.filter((item): item is CharacterItem => item !== null)
  worldBooks.value = loadedWorldBooks.filter((item): item is WorldBookItem => item !== null)
  savedConfig.value = asRecord(pluginData)
  draft.value = normalizeDraft(savedConfig.value)
  dirty.value = false
}

function selectCharacter(fileName: string): void {
  draft.value = { ...draft.value, characterFile: fileName }
  markDirty()
}

function addWorldBook(fileName: string): void {
  if (!fileName || draft.value.worldBookFiles.includes(fileName)) return
  draft.value = { ...draft.value, worldBookFiles: [...draft.value.worldBookFiles, fileName] }
  markDirty()
}

function removeWorldBook(fileName: string): void {
  draft.value = {
    ...draft.value,
    worldBookFiles: draft.value.worldBookFiles.filter(item => item !== fileName)
  }
  markDirty()
}

function worldBookIndex(fileName: string): number {
  return draft.value.worldBookFiles.indexOf(fileName)
}

function moveWorldBook(index: number, delta: number): void {
  const nextIndex = index + delta
  if (nextIndex < 0 || nextIndex >= draft.value.worldBookFiles.length) return
  const next = [...draft.value.worldBookFiles]
  const [item] = next.splice(index, 1)
  next.splice(nextIndex, 0, item)
  draft.value = { ...draft.value, worldBookFiles: next }
  markDirty()
}

async function save(): Promise<void> {
  await runTask(async () => {
    const nextConfig = {
      ...savedConfig.value,
      characterFile: draft.value.characterFile,
      worldBookFiles: [...draft.value.worldBookFiles]
    }
    savedConfig.value = await api.chat.setPluginData(nextConfig)
    dirty.value = false
    setStatus('当前聊天的角色卡和世界书已保存')
  })
}

async function runTask(task: () => Promise<void>): Promise<void> {
  if (busy.value) return
  busy.value = true
  setStatus('')
  try {
    await task()
  } catch (taskError) {
    setStatus(taskError instanceof Error ? taskError.message : String(taskError), true)
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  void runTask(refresh)
})
</script>

<template>
  <main class="chat-page">
    <header class="page-header">
      <div>
        <h1>聊天角色与世界书</h1>
        <p>这些设置只作用于当前聊天。</p>
      </div>
      <button type="button" :disabled="busy || !dirty" @click="save">保存</button>
    </header>

    <p v-if="status" class="status">{{ status }}</p>
    <p v-if="error" class="status error">{{ error }}</p>

    <section class="section">
      <header>
        <h2>角色卡</h2>
      </header>
      <select :value="draft.characterFile" :disabled="busy || !characters.length" @change="selectCharacter(($event.target as HTMLSelectElement).value)">
        <option v-if="!characters.length" value="">没有可用角色卡</option>
        <option v-for="item in characters" :key="item.file.path" :value="item.file.name">{{ item.name }} · {{ item.file.name }}</option>
      </select>
      <div v-if="selectedCharacter" class="summary-box">
        <strong>{{ selectedCharacter.name }}</strong>
        <span>{{ selectedCharacter.file.name }}</span>
        <small v-if="selectedCharacter.embeddedEntryCount">内置世界书固定启用，排在所有外部世界书之前：{{ selectedCharacter.embeddedBookName }}，{{ selectedCharacter.embeddedEntryCount }} 条</small>
        <small v-else>这张角色卡没有内置世界书。</small>
      </div>
    </section>

    <section class="section">
      <header>
        <h2>外部世界书</h2>
        <span>{{ selectedExternalCount }} 本已启用</span>
      </header>

      <div v-if="unselectedWorldBooks.length" class="add-row">
        <select :disabled="busy" @change="addWorldBook(($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''">
          <option value="">添加世界书</option>
          <option v-for="item in unselectedWorldBooks" :key="item.file.path" :value="item.file.name">{{ item.name }} · {{ item.entryCount }} 条</option>
        </select>
      </div>

      <div v-if="selectedWorldBooks.length || missingWorldBooks.length" class="world-list">
        <article v-for="item in selectedWorldBooks" :key="item.file.path" class="world-row">
          <div class="world-copy">
            <strong>{{ item.name }}</strong>
            <span>{{ item.file.name }} · {{ item.entryCount }} 条目</span>
          </div>
          <div class="world-actions">
            <button type="button" :disabled="busy || worldBookIndex(item.file.name) <= 0" @click="moveWorldBook(worldBookIndex(item.file.name), -1)">上移</button>
            <button type="button" :disabled="busy || worldBookIndex(item.file.name) >= draft.worldBookFiles.length - 1" @click="moveWorldBook(worldBookIndex(item.file.name), 1)">下移</button>
            <button class="danger" type="button" :disabled="busy" @click="removeWorldBook(item.file.name)">移除</button>
          </div>
        </article>
        <article v-for="fileName in missingWorldBooks" :key="fileName" class="world-row missing">
          <div class="world-copy">
            <strong>{{ fileName }}</strong>
            <span>文件缺失，保存后仍会保留；移除可清理这个引用。</span>
          </div>
          <div class="world-actions">
            <button class="danger" type="button" :disabled="busy" @click="removeWorldBook(fileName)">移除</button>
          </div>
        </article>
      </div>
      <p v-else class="empty">未启用外部世界书。若角色卡含内置世界书，它仍会固定启用。</p>
    </section>
  </main>
</template>

<style scoped>
:global(:root) {
  color-scheme: light;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

:global(body) {
  margin: 0;
  background: #ffffff;
  color: #253041;
  font-size: 13px;
}

.chat-page {
  min-width: 0;
  display: grid;
  gap: 14px;
  padding: 14px;
}

.page-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
}

.page-header h1,
.section h2 {
  margin: 0;
}

.page-header h1 {
  font-size: 17px;
}

.page-header p {
  margin: 4px 0 0;
  color: #66758a;
}

button,
select {
  font: inherit;
}

button {
  min-height: 32px;
  border: 1px solid #cfd7e2;
  border-radius: 6px;
  background: #f8fafc;
  color: #253041;
  padding: 0 10px;
  cursor: pointer;
}

button:hover:not(:disabled) {
  background: #eef4fb;
}

button:disabled {
  cursor: default;
  opacity: 0.52;
}

button.danger {
  color: #b43636;
}

select {
  min-width: 0;
  width: 100%;
  border: 1px solid #cfd7e2;
  border-radius: 6px;
  background: #ffffff;
  color: #253041;
  padding: 7px 8px;
}

.status {
  min-height: 18px;
  margin: 0;
  color: #2a8655;
}

.status.error {
  color: #c43e3e;
}

.section {
  min-width: 0;
  display: grid;
  gap: 8px;
}

.section>header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid #edf0f4;
  padding-bottom: 6px;
}

.section h2 {
  font-size: 14px;
}

.section>header span,
.empty {
  color: #66758a;
  font-size: 12px;
}

.summary-box,
.world-row {
  min-width: 0;
  border: 1px solid #e1e7ef;
  border-radius: 8px;
  padding: 10px;
}

.summary-box {
  display: grid;
  gap: 3px;
  background: #fbfcfe;
}

.summary-box span,
.summary-box small {
  color: #66758a;
  font-size: 12px;
}

.add-row,
.world-list {
  min-width: 0;
  display: grid;
  gap: 8px;
}

.world-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
}

.world-row.missing {
  border-color: #e8c8c8;
  background: #fffafa;
}

.world-copy {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.world-copy strong,
.world-copy span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.world-copy span {
  color: #66758a;
  font-size: 12px;
}

.world-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

@media (max-width: 620px) {
  .world-row {
    grid-template-columns: 1fr;
  }

  .world-actions {
    justify-content: flex-start;
  }
}
</style>
