<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  MdAdd,
  MdCheckCircle,
  MdClose,
  MdCloudQueue,
  MdDeleteOutline,
  MdDragIndicator,
  MdKey,
  MdMemory,
  MdRefresh,
  MdSave,
  MdSettings,
  MdSmartToy,
  MdTune,
  MdWarningAmber
} from 'vue-icons-plus/md'
import type { JsonRecord, JsonRecordValue, LlmInstance, LlmProvider, LlmProviderType } from '../../../shared/types'
import { useProjectWorkbench } from '../composables/useProjectWorkbench'
import JsonEditor from './JsonEditor.vue'

const providerTypes: { value: LlmProviderType; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'openai-compatible', label: 'OpenAI-compatible' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google Gemini' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'custom', label: 'Custom' }
]

const {
  clearSelectedLlmProviderModelsCache,
  createLlmInstance,
  createLlmProvider,
  deleteSelectedLlmInstance,
  deleteSelectedLlmProvider,
  fetchSelectedLlmProviderModels,
  llmInstances,
  llmProviders,
  project,
  reorderLlmInstances,
  saveLlmInstance,
  saveLlmProvider,
  saveProjectConfig,
  selectLlmInstance,
  selectLlmProvider,
  selectedLlmInstance,
  selectedLlmProvider,
  showToast
} = useProjectWorkbench()

type SettingsSection = 'general' | 'models'

const settingsSection = ref<SettingsSection>('models')
const providerDialogOpen = ref(false)
const instanceDialogOpen = ref(false)
const providerDraft = ref<LlmProvider | null>(null)
const providerConfigJson = ref('{}')
const modelDraft = ref('')
const instanceDraft = ref<LlmInstance | null>(null)
const instanceExtraJson = ref('{}')
const providerDirty = ref(false)
const instanceDirty = ref(false)
const draggingInstanceId = ref<number | null>(null)
const dragOverInstanceId = ref<number | null>(null)

const debugMode = computed(() => Boolean(project.value?.config.debugMode))
const providerTitle = computed(() => providerDraft.value?.name || '模型供应商')
const providerJsonError = computed(() => jsonRecordError(providerConfigJson.value))
const instanceJsonError = computed(() => jsonRecordError(instanceExtraJson.value))
const providerInitial = computed(() => providerTitle.value.trim().slice(0, 1).toUpperCase() || '?')
const instanceBoundProvider = computed(() => providerForInstance(instanceDraft.value))
const instanceAvailable = computed(() => Boolean(instanceBoundProvider.value))

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function markProviderDirty() { providerDirty.value = true }
function markInstanceDirty() { instanceDirty.value = true }

function isJsonRecord(value: JsonRecordValue): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function jsonRecordError(value: string): string | null {
  try {
    return isJsonRecord(JSON.parse(value)) ? null : '必须是对象'
  } catch {
    return '格式不正确'
  }
}

function parseProviderConfig(): JsonRecord | null {
  try {
    const value = JSON.parse(providerConfigJson.value)
    if (!isJsonRecord(value)) {
      showToast('Provider 高级 JSON 必须是对象。', 'error')
      return null
    }
    return value
  } catch {
    showToast('Provider 高级 JSON 格式不正确。', 'error')
    return null
  }
}

function parseInstanceExtra(): JsonRecord | null {
  try {
    const value = JSON.parse(instanceExtraJson.value)
    if (!isJsonRecord(value)) {
      showToast('实例请求配置 JSON 必须是对象。', 'error')
      return null
    }
    return value
  } catch {
    showToast('实例请求配置 JSON 格式不正确。', 'error')
    return null
  }
}

function canDiscardProviderDraft(): boolean {
  return !providerDirty.value || window.confirm('有未保存的供应商更改，确定放弃？')
}

function canDiscardInstanceDraft(): boolean {
  return !instanceDirty.value || window.confirm('有未保存的实例更改，确定放弃？')
}

function canDiscardDrafts(): boolean {
  return canDiscardProviderDraft() && canDiscardInstanceDraft()
}

function setProviderDraft(provider: LlmProvider | null) {
  providerDraft.value = provider ? clone(provider) : null
  providerConfigJson.value = JSON.stringify(providerDraft.value?.config ?? {}, null, 2)
  modelDraft.value = providerDraft.value?.modelsCache[0]?.id ?? ''
  providerDirty.value = false
}

function setInstanceDraft(instance: LlmInstance | null) {
  instanceDraft.value = instance ? clone(instance) : null
  instanceExtraJson.value = JSON.stringify(instanceDraft.value?.extra ?? {}, null, 2)
  instanceDirty.value = false
}

function selectSection(section: SettingsSection) {
  if (section === settingsSection.value) return
  if (!canDiscardDrafts()) return
  settingsSection.value = section
}

function openProviderModal(provider: LlmProvider) {
  if (!canDiscardProviderDraft()) return
  settingsSection.value = 'models'
  selectLlmProvider(provider)
  setProviderDraft(provider)
  providerDialogOpen.value = true
}

async function openNewProviderModal() {
  if (!canDiscardProviderDraft()) return
  settingsSection.value = 'models'
  await createLlmProvider()
  if (selectedLlmProvider.value) {
    setProviderDraft(selectedLlmProvider.value)
    providerDialogOpen.value = true
  }
}

function closeProviderModal() {
  if (!canDiscardProviderDraft()) return
  providerDialogOpen.value = false
  setProviderDraft(null)
}

function openInstanceModal(instance: LlmInstance) {
  if (!canDiscardInstanceDraft()) return
  settingsSection.value = 'models'
  selectLlmInstance(instance)
  setInstanceDraft(instance)
  instanceDialogOpen.value = true
}

async function openNewInstanceModal() {
  if (!canDiscardInstanceDraft()) return
  settingsSection.value = 'models'
  await createLlmInstance({
    name: '新实例',
    providerId: selectedLlmProvider.value?.id ?? llmProviders.value[0]?.id ?? null,
    modelId: '',
    extra: {}
  })
  if (selectedLlmInstance.value) {
    setInstanceDraft(selectedLlmInstance.value)
    instanceDialogOpen.value = true
  }
}

function closeInstanceModal() {
  if (!canDiscardInstanceDraft()) return
  instanceDialogOpen.value = false
  setInstanceDraft(null)
}

async function saveProviderDraft() {
  if (!providerDraft.value) return
  const config = parseProviderConfig()
  if (!config) return
  providerDraft.value.config = config
  await saveLlmProvider(providerDraft.value)
  providerDirty.value = false
  if (selectedLlmProvider.value) setProviderDraft(selectedLlmProvider.value)
}

async function fetchProviderModelsForDraft() {
  await fetchSelectedLlmProviderModels()
  if (selectedLlmProvider.value) setProviderDraft(selectedLlmProvider.value)
}

async function clearProviderModelsForDraft() {
  await clearSelectedLlmProviderModelsCache()
  if (selectedLlmProvider.value) setProviderDraft(selectedLlmProvider.value)
}

async function deleteProviderDraft() {
  const id = selectedLlmProvider.value?.id
  if (!id) return
  await deleteSelectedLlmProvider()
  if (!llmProviders.value.some(provider => provider.id === id)) {
    providerDialogOpen.value = false
    setProviderDraft(null)
  }
}

async function saveInstanceDraft() {
  if (!instanceDraft.value) return
  const extra = parseInstanceExtra()
  if (!extra) return
  instanceDraft.value.extra = extra
  await saveLlmInstance(instanceDraft.value)
  instanceDirty.value = false
  if (selectedLlmInstance.value) setInstanceDraft(selectedLlmInstance.value)
}

async function deleteInstanceDraft() {
  const id = selectedLlmInstance.value?.id
  if (!id) return
  await deleteSelectedLlmInstance()
  if (!llmInstances.value.some(instance => instance.id === id)) {
    instanceDialogOpen.value = false
    setInstanceDraft(null)
  }
}

async function setDebugMode(value: boolean) {
  const ok = await saveProjectConfig({ debugMode: value })
  if (ok) showToast(value ? '调试模式已开启' : '调试模式已关闭', 'success')
}

async function createInstanceFromProvider(modelId = modelDraft.value) {
  const provider = providerDraft.value
  const trimmedModel = modelId.trim()
  if (!provider || !trimmedModel) {
    showToast('请先选择供应商并输入模型 ID。', 'error')
    return
  }
  await createLlmInstance({
    name: trimmedModel,
    providerId: provider.id,
    modelId: trimmedModel,
    extra: {}
  })
}

function setProviderBaseURL(value: string) {
  if (!providerDraft.value) return
  providerDraft.value.config = {
    ...providerDraft.value.config,
    baseURL: value
  }
  providerConfigJson.value = JSON.stringify(providerDraft.value.config, null, 2)
  markProviderDirty()
}

function providerBaseURL(provider: LlmProvider | null) {
  const value = provider?.config.baseURL
  return typeof value === 'string' ? value : ''
}

function selectModel(modelId: string) {
  modelDraft.value = modelId
}

function providerForInstance(instance: LlmInstance | null): LlmProvider | null {
  if (!instance?.providerId) return null
  return llmProviders.value.find(provider => provider.id === instance.providerId) ?? null
}

function providerStatusLabel(instance: LlmInstance): string {
  return providerForInstance(instance)?.name || '不可用'
}

function providerInstanceCount(provider: LlmProvider): number {
  return llmInstances.value.filter(instance => instance.providerId === provider.id).length
}

function instanceRowSubtitle(instance: LlmInstance): string {
  const model = instance.modelId || '无模型'
  return `${model} · ${providerStatusLabel(instance)}`
}

function beginInstanceDrag(event: Event, instance: LlmInstance) {
  const dragEvent = event as DragEvent
  draggingInstanceId.value = instance.id
  dragEvent.dataTransfer?.setData('text/plain', String(instance.id))
  if (dragEvent.dataTransfer) dragEvent.dataTransfer.effectAllowed = 'move'
}

function clearInstanceDrag() {
  draggingInstanceId.value = null
  dragOverInstanceId.value = null
}

async function dropInstance(target: LlmInstance) {
  const sourceId = draggingInstanceId.value
  clearInstanceDrag()
  if (!sourceId || sourceId === target.id) return
  const ids = llmInstances.value.map(instance => instance.id)
  const sourceIndex = ids.indexOf(sourceId)
  const targetIndex = ids.indexOf(target.id)
  if (sourceIndex < 0 || targetIndex < 0) return
  ids.splice(sourceIndex, 1)
  ids.splice(targetIndex, 0, sourceId)
  await reorderLlmInstances(ids)
}
</script>

<template>
  <section class="settings-page">
    <aside class="settings-primary-pane">
      <nav class="settings-primary-nav" aria-label="设置分类">
        <button class="primary-nav-item" :class="{ active: settingsSection === 'general' }" type="button"
          @click="selectSection('general')">
          <MdSettings class="nav-icon" aria-hidden="true" />
          <span>通用</span>
        </button>
        <button class="primary-nav-item" :class="{ active: settingsSection === 'models' }" type="button"
          @click="selectSection('models')">
          <MdCloudQueue class="nav-icon" aria-hidden="true" />
          <span>模型服务</span>
        </button>
      </nav>
    </aside>

    <aside class="settings-secondary-pane">
      <template v-if="settingsSection === 'general'">
        <div class="secondary-title">通用</div>
        <button class="secondary-item selected" type="button">
          <span class="provider-avatar muted">
            <MdTune aria-hidden="true" />
          </span>
          <span class="secondary-copy">
            <strong>项目设置</strong>
            <small>{{ debugMode ? '调试模式开启' : '调试模式关闭' }}</small>
          </span>
        </button>
      </template>

      <template v-else>
        <div class="secondary-title">模型供应商</div>
        <div class="provider-list">
          <button v-for="provider in llmProviders" :key="provider.id" class="secondary-item provider-item"
            :class="{ selected: selectedLlmProvider?.id === provider.id }" type="button"
            @click="openProviderModal(provider)">
            <span class="provider-avatar">{{ (provider.name || provider.type).trim().slice(0, 1).toUpperCase() }}</span>
            <span class="secondary-copy">
              <strong>{{ provider.name || provider.type }}</strong>
              <small>{{ provider.type }} · {{ provider.modelsCache.length }} 模型 · {{ providerInstanceCount(provider) }} 实例</small>
            </span>
          </button>
          <p v-if="!llmProviders.length" class="empty-note">还没有模型供应商。</p>
        </div>
        <button class="add-provider-button" type="button" @click="openNewProviderModal">
          <MdAdd class="inline-icon" aria-hidden="true" />
          <span>添加</span>
        </button>
      </template>
    </aside>

    <main class="settings-detail-pane">
      <section v-if="settingsSection === 'general'" class="detail-section">
        <header class="detail-header">
          <div>
            <h2>项目设置</h2>
          </div>
        </header>

        <div class="detail-body compact">
          <label class="switch-row">
            <span>
              <strong>调试模式</strong>
              <small>应用 iframe 调试信息</small>
            </span>
            <input type="checkbox" :checked="debugMode"
              @change="setDebugMode(($event.target as HTMLInputElement).checked)" />
          </label>
        </div>
      </section>

      <section v-else class="detail-section">
        <header class="detail-header">
          <div class="detail-title">
            <span class="provider-avatar muted large">
              <MdSmartToy aria-hidden="true" />
            </span>
            <span>
              <h2>LLM 实例</h2>
              <small>{{ llmInstances.length }} 个实例</small>
            </span>
          </div>
          <button class="outline-button" type="button" @click="openNewInstanceModal">
            <MdAdd class="inline-icon" aria-hidden="true" />
            新建实例
          </button>
        </header>

        <div class="detail-body">
          <div v-if="llmInstances.length" class="global-instance-list">
            <div v-for="instance in llmInstances" :key="instance.id" class="instance-row"
              :class="{
                selected: selectedLlmInstance?.id === instance.id,
                unavailable: !providerForInstance(instance),
                dragging: draggingInstanceId === instance.id,
                dropTarget: dragOverInstanceId === instance.id
              }"
              role="button" tabindex="0"
              @click="openInstanceModal(instance)"
              @keydown.enter.prevent="openInstanceModal(instance)"
              @dragover.prevent="dragOverInstanceId = instance.id"
              @dragleave="dragOverInstanceId = null"
              @drop.prevent="dropInstance(instance)">
              <span class="drag-handle" draggable="true" aria-label="拖动排序"
                @click.stop
                @dragstart="beginInstanceDrag($event, instance)"
                @dragend="clearInstanceDrag">
                <MdDragIndicator aria-hidden="true" />
              </span>
              <span class="instance-copy">
                <strong>{{ instance.name }}</strong>
                <small>{{ instanceRowSubtitle(instance) }}</small>
              </span>
              <span class="status-pill" :class="{ ok: providerForInstance(instance), warn: !providerForInstance(instance) }">
                <MdCheckCircle v-if="providerForInstance(instance)" aria-hidden="true" />
                <MdWarningAmber v-else aria-hidden="true" />
                {{ providerForInstance(instance) ? '可用' : '不可用' }}
              </span>
            </div>
          </div>
          <div v-else class="empty-detail">
            <p>还没有 LLM 实例。</p>
            <button class="outline-button" type="button" @click="openNewInstanceModal">
              <MdAdd class="inline-icon" aria-hidden="true" />
              新建实例
            </button>
          </div>
        </div>
      </section>
    </main>

    <teleport to="body">
      <div v-if="providerDialogOpen && providerDraft" class="modal-backdrop" @click.self="closeProviderModal">
        <section class="modal-panel provider-modal" role="dialog" aria-modal="true" aria-labelledby="provider-dialog-title">
          <header class="modal-header">
            <div class="detail-title">
              <span class="provider-avatar large">{{ providerInitial }}</span>
              <span>
                <h2 id="provider-dialog-title">{{ providerTitle }}</h2>
                <small>{{ providerDraft.type }}</small>
              </span>
            </div>
            <div class="button-row">
              <button class="toolbar-button" type="button" aria-label="拉取模型" data-tooltip="拉取模型"
                @click="fetchProviderModelsForDraft">
                <MdRefresh class="toolbar-icon" aria-hidden="true" />
              </button>
              <button class="toolbar-button" type="button" aria-label="保存供应商" data-tooltip="保存供应商"
                :disabled="Boolean(providerJsonError)" @click="saveProviderDraft">
                <MdSave class="toolbar-icon" aria-hidden="true" />
              </button>
              <button class="toolbar-button danger" type="button" aria-label="删除供应商" data-tooltip="删除供应商"
                @click="deleteProviderDraft">
                <MdDeleteOutline class="toolbar-icon" aria-hidden="true" />
              </button>
              <button class="toolbar-button" type="button" aria-label="关闭" data-tooltip="关闭"
                @click="closeProviderModal">
                <MdClose class="toolbar-icon" aria-hidden="true" />
              </button>
            </div>
          </header>

          <div class="modal-body">
            <section class="settings-block">
              <div class="block-heading">
                <MdKey class="section-icon" aria-hidden="true" />
                <h3>连接</h3>
              </div>

              <div class="form-grid three">
                <label>名称
                  <input v-model="providerDraft.name" @input="markProviderDirty" />
                </label>
                <label>类型
                  <select v-model="providerDraft.type" @change="markProviderDirty">
                    <option v-for="type in providerTypes" :key="type.value" :value="type.value">{{ type.label }}</option>
                  </select>
                </label>
                <label>API Key
                  <input v-model="providerDraft.apiKey" type="password" autocomplete="off" placeholder="仅保存在当前项目数据库"
                    @input="markProviderDirty" />
                </label>
              </div>

              <div class="form-grid">
                <label>Base URL
                  <input :value="providerBaseURL(providerDraft)" placeholder="按 provider 默认值留空"
                    @input="setProviderBaseURL(($event.target as HTMLInputElement).value)" />
                </label>
                <label>
                  高级 JSON
                  <span v-if="providerJsonError" class="json-status error">{{ providerJsonError }}</span>
                  <span v-else-if="providerConfigJson !== '{}'" class="json-status ok">有效</span>
                  <JsonEditor v-model="providerConfigJson" :rows="6" aria-label="提供商高级 JSON"
                    @update:model-value="markProviderDirty" />
                </label>
              </div>
            </section>

            <section class="settings-block">
              <div class="block-heading with-actions">
                <span class="heading-title">
                  <MdMemory class="section-icon" aria-hidden="true" />
                  <h3>模型</h3>
                  <small>{{ providerDraft.modelsCache.length }}</small>
                </span>
                <span class="inline-actions">
                  <button class="outline-button compact-button" type="button"
                    @click="clearProviderModelsForDraft">
                    清空缓存
                  </button>
                  <button class="outline-button compact-button" type="button" @click="fetchProviderModelsForDraft">
                    <MdRefresh class="inline-icon" aria-hidden="true" />
                    获取模型列表
                  </button>
                </span>
              </div>

              <div class="model-tools">
                <label>模型 ID
                  <input v-model="modelDraft" placeholder="可从缓存选择，也可手动输入" />
                </label>
                <button class="outline-button" type="button" @click="createInstanceFromProvider()">
                  <MdAdd class="inline-icon" aria-hidden="true" />
                  新建实例
                </button>
              </div>

              <div v-if="providerDraft.modelsCache.length" class="model-list">
                <button v-for="model in providerDraft.modelsCache" :key="model.id" type="button" class="model-row"
                  :class="{ selected: modelDraft === model.id }" @click="selectModel(model.id)"
                  @dblclick="createInstanceFromProvider(model.id)">
                  <span class="provider-avatar small">{{ model.displayName.trim().slice(0, 1).toUpperCase() || 'M' }}</span>
                  <span>{{ model.displayName }}</span>
                </button>
              </div>
              <p v-else class="empty-note inline">暂无缓存模型。</p>
            </section>
          </div>
        </section>
      </div>
    </teleport>

    <teleport to="body">
      <div v-if="instanceDialogOpen && instanceDraft" class="modal-backdrop" @click.self="closeInstanceModal">
        <section class="modal-panel instance-modal" role="dialog" aria-modal="true" aria-labelledby="instance-dialog-title">
          <header class="modal-header">
            <div class="detail-title">
              <span class="provider-avatar muted large">
                <MdSmartToy aria-hidden="true" />
              </span>
              <span>
                <h2 id="instance-dialog-title">{{ instanceDraft.name || 'LLM 实例' }}</h2>
                <small>{{ instanceDraft.modelId || '无模型' }}</small>
              </span>
            </div>
            <div class="button-row">
              <button class="toolbar-button" type="button" aria-label="保存实例" data-tooltip="保存实例"
                :disabled="Boolean(instanceJsonError)" @click="saveInstanceDraft">
                <MdSave class="toolbar-icon" aria-hidden="true" />
              </button>
              <button class="toolbar-button danger" type="button" aria-label="删除实例" data-tooltip="删除实例"
                @click="deleteInstanceDraft">
                <MdDeleteOutline class="toolbar-icon" aria-hidden="true" />
              </button>
              <button class="toolbar-button" type="button" aria-label="关闭" data-tooltip="关闭"
                @click="closeInstanceModal">
                <MdClose class="toolbar-icon" aria-hidden="true" />
              </button>
            </div>
          </header>

          <div class="modal-body">
            <section class="settings-block">
              <div class="block-heading">
                <MdTune class="section-icon" aria-hidden="true" />
                <h3>实例</h3>
              </div>

              <div class="form-grid three">
                <label>名称
                  <input v-model="instanceDraft.name" @input="markInstanceDirty" />
                </label>
                <label>Provider
                  <select :value="instanceDraft.providerId ?? ''"
                    @change="instanceDraft.providerId = ($event.target as HTMLSelectElement).value ? Number(($event.target as HTMLSelectElement).value) : null; markInstanceDirty()">
                    <option value="">未绑定</option>
                    <option v-if="instanceDraft.providerId !== null && !instanceBoundProvider"
                      :value="instanceDraft.providerId">
                      已删除的 Provider #{{ instanceDraft.providerId }}
                    </option>
                    <option v-for="provider in llmProviders" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
                  </select>
                </label>
                <label>模型 ID
                  <input v-model="instanceDraft.modelId" @input="markInstanceDirty" />
                </label>
              </div>

              <div class="instance-status" :class="{ ok: instanceAvailable, warn: !instanceAvailable }">
                <MdCheckCircle v-if="instanceAvailable" aria-hidden="true" />
                <MdWarningAmber v-else aria-hidden="true" />
                <span>{{ instanceAvailable ? `当前 Provider：${instanceBoundProvider?.name}` : '不可用：请选择有效 Provider' }}</span>
              </div>

              <label class="json-label">
                请求配置 JSON
                <span v-if="instanceJsonError" class="json-status error">{{ instanceJsonError }}</span>
                <span v-else-if="instanceExtraJson !== '{}'" class="json-status ok">有效</span>
                <JsonEditor v-model="instanceExtraJson" :rows="12" aria-label="LLM 实例请求配置 JSON"
                  @update:model-value="markInstanceDirty" />
              </label>
            </section>
          </div>
        </section>
      </div>
    </teleport>
  </section>
</template>

<style scoped>
.settings-page {
  display: grid;
  grid-template-columns: 260px 360px minmax(360px, 1fr);
  height: 100%;
  min-width: 0;
  background: #ffffff;
}

.settings-primary-pane,
.settings-secondary-pane,
.settings-detail-pane {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background: #ffffff;
}

.settings-primary-pane,
.settings-secondary-pane {
  border-right: 1px solid #e5e8ed;
}

.settings-primary-pane {
  padding: 14px;
}

.settings-secondary-pane {
  display: flex;
  flex-direction: column;
  padding: 14px 12px;
}

.settings-primary-nav {
  display: grid;
  gap: 8px;
}

.primary-nav-item {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: #242b36;
  padding: 10px 12px;
  font-size: 15px;
  font-weight: 700;
}

.primary-nav-item:hover,
.primary-nav-item.active {
  border-color: #e2e5ea;
  background: #f4f5f7;
}

.nav-icon {
  width: 20px;
  height: 20px;
  color: #5d6570;
}

.secondary-title {
  min-height: 34px;
  display: flex;
  align-items: center;
  color: #6b7280;
  font-size: 12px;
  font-weight: 700;
}

.provider-list,
.global-instance-list {
  min-height: 0;
  display: grid;
  gap: 6px;
  overflow: auto;
  padding-bottom: 12px;
}

.secondary-item {
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: #1f2430;
  padding: 9px 10px;
  text-align: left;
}

.secondary-item:hover,
.secondary-item.selected,
.instance-row:hover,
.instance-row.selected {
  border-color: #e5e8ed;
  background: #f4f5f7;
}

.provider-avatar {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #79c990;
  color: #12351d;
  font-size: 15px;
  font-weight: 800;
}

.provider-avatar.muted {
  background: #eef1f5;
  color: #5a6370;
}

.provider-avatar.large {
  width: 42px;
  height: 42px;
  font-size: 18px;
}

.provider-avatar.small {
  width: 28px;
  height: 28px;
  background: #edf3ff;
  color: #315cab;
  font-size: 12px;
}

.secondary-copy,
.instance-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.secondary-copy strong,
.secondary-copy small,
.instance-copy strong,
.instance-copy small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.secondary-copy strong,
.instance-copy strong {
  color: #161b22;
  font-size: 14px;
  font-weight: 800;
}

.secondary-copy small,
.instance-copy small {
  color: #8a929e;
  font-size: 12px;
}

.add-provider-button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: auto;
  border: 1px solid #d4d9e1;
  border-radius: 8px;
  background: #ffffff;
  color: #303743;
  padding: 10px 12px;
  font-size: 14px;
  font-weight: 600;
}

.add-provider-button:hover,
.outline-button:hover {
  background: #f6f7f9;
}

.settings-detail-pane {
  padding: 0 24px 24px;
}

.detail-section {
  min-height: 100%;
}

.detail-header,
.modal-header {
  min-height: 72px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid #e8ebef;
  background: #ffffff;
}

.detail-header {
  position: sticky;
  top: 0;
  z-index: 3;
}

.detail-title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.detail-header h2,
.modal-header h2 {
  margin: 0;
  color: #111827;
  font-size: 16px;
  font-weight: 800;
}

.detail-header small,
.modal-header small {
  color: #8a929e;
  font-size: 12px;
}

.detail-body,
.modal-body {
  display: grid;
  gap: 18px;
  padding: 22px 0;
}

.detail-body.compact {
  max-width: 640px;
}

.settings-block {
  display: grid;
  gap: 12px;
}

.block-heading,
.heading-title,
.inline-actions,
.model-tools,
.button-row,
.instance-status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.block-heading {
  justify-content: flex-start;
}

.block-heading.with-actions {
  justify-content: space-between;
}

.block-heading h3 {
  margin: 0;
  color: #111827;
  font-size: 14px;
  font-weight: 800;
}

.block-heading small {
  display: inline-grid;
  min-width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 999px;
  background: #f0f2f5;
  color: #8a929e;
  font-size: 12px;
  font-weight: 700;
}

.section-icon,
.inline-icon {
  width: 18px;
  height: 18px;
}

.section-icon {
  color: #59616d;
}

.form-grid {
  display: grid;
  gap: 10px;
  margin-bottom: 0;
}

.form-grid.three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

label,
.json-label {
  display: grid;
  gap: 5px;
  color: #536071;
  font-size: 12px;
}

input,
select {
  width: 100%;
  border: 1px solid #d7dce3;
  border-radius: 8px;
  background: #ffffff;
  color: #1f2935;
  padding: 8px 10px;
  outline: none;
}

input:focus,
select:focus {
  border-color: #8da6d9;
  box-shadow: 0 0 0 3px rgba(91, 127, 196, 0.14);
}

button {
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.outline-button,
.toolbar-button {
  border: 1px solid #d4d9e1;
  border-radius: 8px;
  background: #ffffff;
  color: #303743;
}

.outline-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 700;
}

.compact-button {
  padding: 6px 9px;
  font-size: 12px;
}

.toolbar-button {
  position: relative;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
}

.toolbar-button:hover {
  background: #f6f7f9;
}

.toolbar-button.danger {
  color: #b63b37;
}

.toolbar-icon {
  width: 18px;
  height: 18px;
}

.toolbar-button[data-tooltip]:hover::after {
  content: attr(data-tooltip);
  position: absolute;
  top: calc(100% + 7px);
  right: 0;
  z-index: 20;
  white-space: nowrap;
  border-radius: 6px;
  background: #1f2935;
  color: #ffffff;
  padding: 5px 7px;
  font-size: 12px;
  font-weight: 600;
}

.model-tools {
  align-items: end;
}

.model-tools label {
  flex: 1 1 auto;
}

.model-list {
  display: grid;
  gap: 6px;
  max-height: 260px;
  overflow: auto;
}

.model-row {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid #e3e7ec;
  border-radius: 8px;
  background: #ffffff;
  color: #1f2935;
  padding: 8px;
  text-align: left;
}

.model-row:hover,
.model-row.selected {
  background: #f4f7fb;
  border-color: #cad7ef;
}

.global-instance-list {
  align-content: start;
}

.instance-row {
  min-width: 0;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: #ffffff;
  color: #1f2430;
  padding: 8px 10px 8px 6px;
}

.instance-row.unavailable {
  color: #6f4f19;
}

.instance-row.dragging {
  opacity: 0.52;
}

.instance-row.dropTarget {
  border-color: #8da6d9;
  background: #f5f8ff;
}

.drag-handle {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  color: #8a929e;
  cursor: grab;
}

.drag-handle:hover {
  background: #edf0f4;
  color: #536071;
}

.drag-handle:active {
  cursor: grabbing;
}

.status-pill,
.instance-status {
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
}

.status-pill svg,
.instance-status svg {
  width: 15px;
  height: 15px;
}

.status-pill.ok,
.instance-status.ok {
  background: #e8f6ec;
  color: #236638;
}

.status-pill.warn,
.instance-status.warn {
  background: #fff3d8;
  color: #7a5518;
}

.instance-status {
  justify-content: flex-start;
  padding: 9px 11px;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border: 1px solid #e4e8ee;
  border-radius: 8px;
  padding: 12px;
}

.switch-row strong {
  display: block;
  color: #1f2935;
  font-size: 14px;
}

.switch-row small {
  color: #8a929e;
}

.switch-row input {
  width: auto;
}

.json-status {
  justify-self: start;
  border-radius: 999px;
  padding: 2px 7px;
  font-size: 11px;
  font-weight: 800;
}

.json-status.error {
  background: #ffe8e7;
  color: #ad3934;
}

.json-status.ok {
  background: #e8f6ec;
  color: #24673a;
}

.empty-note,
.empty-detail {
  color: #8a929e;
  font-size: 13px;
}

.empty-note {
  margin: 8px 4px;
}

.empty-note.inline {
  margin: 0;
}

.empty-detail {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 12px;
  min-height: 280px;
  text-align: center;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  background: rgba(17, 24, 39, 0.42);
  padding: 28px;
}

.modal-panel {
  width: min(960px, calc(100vw - 56px));
  max-height: calc(100vh - 56px);
  overflow: auto;
  border: 1px solid #dfe4ea;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 24px 80px rgba(17, 24, 39, 0.24);
}

.instance-modal {
  width: min(820px, calc(100vw - 56px));
}

.modal-header,
.modal-body {
  padding-left: 22px;
  padding-right: 22px;
}

.modal-body {
  padding-bottom: 24px;
}

@media (max-width: 980px) {
  .settings-page {
    grid-template-columns: 72px minmax(220px, 300px) minmax(320px, 1fr);
  }

  .primary-nav-item span {
    display: none;
  }

  .primary-nav-item {
    justify-content: center;
  }

  .form-grid.three {
    grid-template-columns: 1fr;
  }
}
</style>
