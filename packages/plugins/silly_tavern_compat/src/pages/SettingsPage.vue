<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  api,
  asString,
  characterBook,
  characterName,
  downloadBytes,
  downloadText,
  formatBytes,
  parseJsonObject,
  stripExtension,
  withExtension,
  worldBookEntryCount,
  type JsonRecord,
  type PluginFileEntry
} from './bridge'
import { base64ToBytes, bytesToBase64, readPngCharacterJson, writePngCharacterJson } from './png-card'

interface CharacterItem {
  file: PluginFileEntry
  name: string
  hasPng: boolean
  pngName: string
  embeddedBookName: string
  embeddedEntryCount: number
}

interface WorldBookItem {
  file: PluginFileEntry
  name: string
  entryCount: number
}

const characters = ref<CharacterItem[]>([])
const worldBooks = ref<WorldBookItem[]>([])
const busy = ref(false)
const status = ref('')
const error = ref('')

const characterCountLabel = computed(() => `${characters.value.length} 张角色卡`)
const worldBookCountLabel = computed(() => `${worldBooks.value.length} 本世界书`)

function setStatus(message: string, failed = false): void {
  status.value = failed ? '' : message
  error.value = failed ? message : ''
}

function jsonFiles(files: PluginFileEntry[]): PluginFileEntry[] {
  return files.filter(file => !file.isDirectory && file.name.toLowerCase().endsWith('.json'))
}

function exists(files: PluginFileEntry[], name: string): boolean {
  return files.some(file => file.name === name)
}

function fileBase(fileName: string): string {
  return stripExtension(fileName)
}

function displayWorldBookName(book: JsonRecord, fallback: string): string {
  return asString(book.name, fallback).trim() || fallback
}

async function loadCharacter(file: PluginFileEntry, allFiles: PluginFileEntry[]): Promise<CharacterItem | null> {
  try {
    const card = parseJsonObject(await api.storage.readText(file.path))
    const book = characterBook(card)
    const pngName = `${fileBase(file.name)}.png`
    return {
      file,
      name: characterName(card, fileBase(file.name)),
      hasPng: exists(allFiles, pngName),
      pngName,
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
      name: displayWorldBookName(book, fileBase(file.name)),
      entryCount: worldBookEntryCount(book)
    }
  } catch {
    return null
  }
}

async function refresh(): Promise<void> {
  const [characterFiles, worldBookFiles] = await Promise.all([
    api.storage.list('characters'),
    api.storage.list('worldbooks')
  ])
  const loadedCharacters = await Promise.all(jsonFiles(characterFiles).map(file => loadCharacter(file, characterFiles)))
  const loadedWorldBooks = await Promise.all(jsonFiles(worldBookFiles).map(loadWorldBook))
  characters.value = loadedCharacters.filter((item): item is CharacterItem => item !== null)
  worldBooks.value = loadedWorldBooks.filter((item): item is WorldBookItem => item !== null)
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true })
    input.click()
  })
}

async function importCharacterJson(): Promise<void> {
  const file = await pickFile('.json,application/json')
  if (!file) return
  await runTask(async () => {
    const card = parseJsonObject(await file.text())
    const targetName = withExtension(file.name, 'json', 'character.json')
    const files = await api.storage.list('characters')
    if (exists(files, targetName) && !window.confirm(`角色卡 ${targetName} 已存在，是否覆盖？`)) return
    await api.storage.writeText(`characters/${targetName}`, `${JSON.stringify(card, null, 2)}\n`)
    await refresh()
    setStatus(`已导入角色卡 ${targetName}`)
  })
}

async function importCharacterPng(): Promise<void> {
  const file = await pickFile('.png,image/png')
  if (!file) return
  await runTask(async () => {
    const pngBytes = new Uint8Array(await file.arrayBuffer())
    const cardText = readPngCharacterJson(pngBytes)
    const card = parseJsonObject(cardText)
    const jsonName = withExtension(file.name, 'json', 'character.json')
    const pngName = withExtension(file.name, 'png', 'character.png')
    const files = await api.storage.list('characters')
    if ((exists(files, jsonName) || exists(files, pngName)) && !window.confirm(`角色卡 ${fileBase(file.name)} 已存在，是否覆盖 JSON 和 PNG？`)) return
    await Promise.all([
      api.storage.writeText(`characters/${jsonName}`, `${JSON.stringify(card, null, 2)}\n`),
      api.storage.writeBase64(`characters/${pngName}`, bytesToBase64(pngBytes))
    ])
    await refresh()
    setStatus(`已导入角色卡 ${jsonName} 和 ${pngName}`)
  })
}

async function importWorldBookJson(): Promise<void> {
  const file = await pickFile('.json,application/json')
  if (!file) return
  await runTask(async () => {
    const book = parseJsonObject(await file.text())
    if (!Object.prototype.hasOwnProperty.call(book, 'entries')) {
      throw new Error('世界书 JSON 缺少 entries 字段。')
    }
    const targetName = withExtension(file.name, 'json', 'worldbook.json')
    const files = await api.storage.list('worldbooks')
    if (exists(files, targetName) && !window.confirm(`世界书 ${targetName} 已存在，是否覆盖？`)) return
    await api.storage.writeText(`worldbooks/${targetName}`, `${JSON.stringify(book, null, 2)}\n`)
    await refresh()
    setStatus(`已导入世界书 ${targetName}`)
  })
}

async function exportCharacterJson(item: CharacterItem): Promise<void> {
  await runTask(async () => {
    downloadText(item.file.name, await api.storage.readText(item.file.path))
    setStatus(`已导出 ${item.file.name}`)
  })
}

async function exportCharacterPng(item: CharacterItem): Promise<void> {
  if (!item.hasPng) return
  await runTask(async () => {
    const [jsonText, pngBase64] = await Promise.all([
      api.storage.readText(item.file.path),
      api.storage.readBase64(`characters/${item.pngName}`)
    ])
    if (!pngBase64) throw new Error('没有找到原始 PNG 文件。')
    const nextPng = writePngCharacterJson(base64ToBytes(pngBase64), jsonText)
    downloadBytes(item.pngName, nextPng, 'image/png')
    setStatus(`已导出 ${item.pngName}`)
  })
}

async function exportWorldBookJson(item: WorldBookItem): Promise<void> {
  await runTask(async () => {
    downloadText(item.file.name, await api.storage.readText(item.file.path))
    setStatus(`已导出 ${item.file.name}`)
  })
}

async function deleteCharacter(item: CharacterItem): Promise<void> {
  if (!window.confirm(`删除角色卡 ${item.file.name}？同名 PNG 也会一起删除。`)) return
  await runTask(async () => {
    await Promise.all([
      api.storage.delete(item.file.path),
      api.storage.delete(`characters/${item.pngName}`)
    ])
    await refresh()
    setStatus(`已删除 ${item.file.name}`)
  })
}

async function deleteWorldBook(item: WorldBookItem): Promise<void> {
  if (!window.confirm(`删除世界书 ${item.file.name}？`)) return
  await runTask(async () => {
    await api.storage.delete(item.file.path)
    await refresh()
    setStatus(`已删除 ${item.file.name}`)
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
  <main class="settings-page">
    <header class="page-header">
      <div>
        <h1>SillyTavern 兼容数据</h1>
        <p>管理插件数据目录中的角色卡和世界书。</p>
      </div>
    </header>

    <section class="toolbar">
      <button type="button" :disabled="busy" @click="importCharacterJson">导入角色卡 JSON</button>
      <button type="button" :disabled="busy" @click="importCharacterPng">导入角色卡 PNG</button>
      <button type="button" :disabled="busy" @click="importWorldBookJson">导入世界书 JSON</button>
      <button type="button" :disabled="busy" @click="runTask(refresh)">刷新</button>
    </section>

    <p v-if="status" class="status">{{ status }}</p>
    <p v-if="error" class="status error">{{ error }}</p>

    <section class="resource-section">
      <header>
        <h2>角色卡</h2>
        <span>{{ characterCountLabel }}</span>
      </header>
      <div v-if="characters.length" class="resource-list">
        <article v-for="item in characters" :key="item.file.path" class="resource-row">
          <div class="resource-copy">
            <strong>{{ item.name }}</strong>
            <span>{{ item.file.name }} <template v-if="formatBytes(item.file.size)">· {{ formatBytes(item.file.size) }}</template></span>
            <small v-if="item.embeddedEntryCount">内置世界书：{{ item.embeddedBookName }}，{{ item.embeddedEntryCount }} 条</small>
            <small v-else>无内置世界书</small>
          </div>
          <div class="resource-actions">
            <button type="button" :disabled="busy" @click="exportCharacterJson(item)">导出 JSON</button>
            <button type="button" :disabled="busy || !item.hasPng" @click="exportCharacterPng(item)">导出 PNG</button>
            <button class="danger" type="button" :disabled="busy" @click="deleteCharacter(item)">删除</button>
          </div>
        </article>
      </div>
      <p v-else class="empty">还没有角色卡。</p>
    </section>

    <section class="resource-section">
      <header>
        <h2>世界书</h2>
        <span>{{ worldBookCountLabel }}</span>
      </header>
      <div v-if="worldBooks.length" class="resource-list">
        <article v-for="item in worldBooks" :key="item.file.path" class="resource-row">
          <div class="resource-copy">
            <strong>{{ item.name }}</strong>
            <span>{{ item.file.name }} <template v-if="formatBytes(item.file.size)">· {{ formatBytes(item.file.size) }}</template></span>
            <small>{{ item.entryCount }} 条目</small>
          </div>
          <div class="resource-actions">
            <button type="button" :disabled="busy" @click="exportWorldBookJson(item)">导出 JSON</button>
            <button class="danger" type="button" :disabled="busy" @click="deleteWorldBook(item)">删除</button>
          </div>
        </article>
      </div>
      <p v-else class="empty">还没有世界书。</p>
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

.settings-page {
  min-width: 0;
  display: grid;
  gap: 14px;
  padding: 14px;
}

.page-header h1,
.resource-section h2 {
  margin: 0;
}

.page-header h1 {
  font-size: 17px;
}

.page-header p {
  margin: 4px 0 0;
  color: #66758a;
}

.toolbar,
.resource-actions {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

button {
  min-height: 32px;
  border: 1px solid #cfd7e2;
  border-radius: 6px;
  background: #f8fafc;
  color: #253041;
  padding: 0 10px;
  font: inherit;
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

.status {
  min-height: 18px;
  margin: 0;
  color: #2a8655;
}

.status.error {
  color: #c43e3e;
}

.resource-section {
  min-width: 0;
  display: grid;
  gap: 8px;
}

.resource-section>header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid #edf0f4;
  padding-bottom: 6px;
}

.resource-section h2 {
  font-size: 14px;
}

.resource-section>header span,
.empty {
  color: #66758a;
  font-size: 12px;
}

.resource-list {
  display: grid;
  gap: 8px;
}

.resource-row {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  border: 1px solid #e1e7ef;
  border-radius: 8px;
  padding: 10px;
}

.resource-copy {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.resource-copy strong,
.resource-copy span,
.resource-copy small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resource-copy strong {
  font-size: 13px;
}

.resource-copy span,
.resource-copy small {
  color: #66758a;
  font-size: 12px;
}

@media (max-width: 620px) {
  .resource-row {
    grid-template-columns: 1fr;
  }
}
</style>
