<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  MdAdd,
  MdCloudQueue,
  MdContentCopy,
  MdDeleteOutline,
  MdKey,
  MdMemory,
  MdRefresh,
  MdSave,
  MdSettings,
  MdTune
} from 'vue-icons-plus/md'
import type { JsonRecord, LlmInstance, LlmProvider, LlmProviderType } from '../../../shared/types'
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
  providerSnapshot,
  restoreProviderFromSelectedInstance,
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
const providerDraft = ref<LlmProvider | null>(null)
const providerConfigJson = ref('{}')
const modelDraft = ref('')
const instanceDraft = ref<LlmInstance | null>(null)
const instanceExtraJson = ref('{}')
const providerDirty = ref(false)
const instanceDirty = ref(false)

const debugMode = computed(() => Boolean(project.value?.config.debugMode))
const providerTitle = computed(() => providerDraft.value?.name || '模型供应商')
const providerJsonError = computed(() => jsonRecordError(providerConfigJson.value))
const instanceJsonError = computed(() => jsonRecordError(instanceExtraJson.value))
const selectedProviderInstances = computed(() => {
  const providerId = selectedLlmProvider.value?.id
  return providerId === undefined ? [] : llmInstances.value.filter(instance => instance.providerId === providerId)
})
const activeInstanceVisible = computed(() => {
  if (!instanceDraft.value) return false
  const providerId = selectedLlmProvider.value?.id
  return providerId === undefined || instanceDraft.value.providerId === providerId
})
const instanceBoundProvider = computed(() => {
  const id = instanceDraft.value?.providerId
  return id === null || id === undefined ? null : llmProviders.value.find(provider => provider.id === id) ?? null
})
const providerInitial = computed(() => providerTitle.value.trim().slice(0, 1).toUpperCase() || '?')

watch(selectedLlmProvider, (provider) => {
  providerDraft.value = provider ? clone(provider) : null
  providerConfigJson.value = JSON.stringify(providerDraft.value?.config ?? {}, null, 2)
  modelDraft.value = providerDraft.value?.modelsCache[0]?.id ?? ''
  providerDirty.value = false
}, { immediate: true })

watch(selectedLlmInstance, (instance) => {
  instanceDraft.value = instance ? clone(instance) : null
  instanceExtraJson.value = JSON.stringify(requestConfigFromInstance(instanceDraft.value), null, 2)
  if (instanceDraft.value?.modelId) modelDraft.value = instanceDraft.value.modelId
  instanceDirty.value = false
}, { immediate: true })

watch(llmProviders, (providers) => {
  if (!selectedLlmProvider.value && providers[0]) selectLlmProvider(providers[0])
}, { immediate: true })

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function markProviderDirty() { providerDirty.value = true }
function markInstanceDirty() { instanceDirty.value = true }

function isJsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function jsonRecordError(value: string): string | null {
  try {
    return isJsonRecord(JSON.parse(value)) ? null : '必须是对象'
  } catch {
    return '格式不正确'
  }
}

function selectedProviderConfig(): JsonRecord | null {
  if (!providerDraft.value) return null
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

function selectedInstanceExtra(): JsonRecord | null {
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

function canDiscardDrafts(): boolean {
  if (providerDirty.value && !window.confirm('有未保存的供应商更改，确定放弃？')) return false
  if (instanceDirty.value && !window.confirm('有未保存的实例更改，确定放弃？')) return false
  return true
}

async function saveProviderDraft() {
  if (!providerDraft.value) return
  const config = selectedProviderConfig()
  if (!config) return
  providerDraft.value.config = config
  await saveLlmProvider(providerDraft.value)
  providerDirty.value = false
}

async function saveInstanceDraft() {
  if (!instanceDraft.value) return
  const extra = selectedInstanceExtra()
  if (!extra) return
  instanceDraft.value.extra = extra
  await saveLlmInstance(instanceDraft.value)
  instanceDirty.value = false
}

async function createProviderForEditing() {
  settingsSection.value = 'models'
  await createLlmProvider()
}

async function setDebugMode(value: boolean) {
  const ok = await saveProjectConfig({ debugMode: value })
  if (ok) showToast(value ? '调试模式已开启' : '调试模式已关闭', 'success')
}

function selectSection(section: SettingsSection) {
  if (section === settingsSection.value) return
  if (!canDiscardDrafts()) return
  settingsSection.value = section
}

function editLlmProvider(provider: LlmProvider) {
  if (!canDiscardDrafts()) return
  settingsSection.value = 'models'
  selectLlmProvider(provider)
}

function editLlmInstance(instance: LlmInstance) {
  if (instanceDirty.value && !window.confirm('有未保存的实例更改，确定放弃？')) return
  selectLlmInstance(instance)
}

async function createInstanceFromProvider(modelId = modelDraft.value) {
  const provider = selectedLlmProvider.value
  const trimmedModel = modelId.trim()
  if (!provider || !trimmedModel) {
    showToast('请先选择供应商并输入模型 ID。', 'error')
    return
  }
  await createLlmInstance({
    name: trimmedModel,
    providerId: provider.id,
    modelId: trimmedModel,
    providerSnapshot: providerSnapshot(provider),
    parameters: {},
    extra: {}
  })
}

async function createLlmInstanceForSelectedProvider() {
  const provider = selectedLlmProvider.value
  await createLlmInstance({
    name: '新实例',
    providerId: provider?.id ?? null,
    modelId: modelDraft.value.trim(),
    providerSnapshot: provider
      ? providerSnapshot(provider)
      : { providerName: '', type: 'custom', config: {} },
    parameters: {},
    extra: {}
  })
}

async function restoreProviderForEditing() {
  await restoreProviderFromSelectedInstance()
  settingsSection.value = 'models'
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

function instanceProviderOptionsKey(instance: LlmInstance) {
  if (instance.providerSnapshot.type === 'openai-compatible') return 'openai-compatible'
  return instance.providerSnapshot.type
}

function setRequestNumber(config: JsonRecord, key: string, value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) config[key] = value
}

function requestConfigFromInstance(instance: LlmInstance | null): JsonRecord {
  if (!instance) return {}
  const config: JsonRecord = isJsonRecord(instance.extra) ? { ...instance.extra } : {}
  const parameters = instance.parameters ?? {}

  setRequestNumber(config, 'temperature', parameters.temperature)
  setRequestNumber(config, 'topP', parameters.topP)
  setRequestNumber(config, 'maxOutputTokens', parameters.maxOutputTokens)
  setRequestNumber(config, 'frequencyPenalty', parameters.frequencyPenalty)
  setRequestNumber(config, 'presencePenalty', parameters.presencePenalty)
  setRequestNumber(config, 'topK', parameters.topK)
  setRequestNumber(config, 'seed', parameters.seed)

  if (parameters.stopSequences?.length) {
    config.stopSequences = parameters.stopSequences.filter(Boolean)
  }
  if (parameters.responseFormat === 'json') {
    config.responseFormat = { type: 'json' }
  } else if (parameters.responseFormat === 'text') {
    config.responseFormat = { type: 'text' }
  }

  const providerKey = instanceProviderOptionsKey(instance)
  const providerOptions = isJsonRecord(config.providerOptions) ? config.providerOptions : {}
  const providerOption = isJsonRecord(providerOptions[providerKey]) ? providerOptions[providerKey] : {}
  if (typeof parameters.repetitionPenalty === 'number' && Number.isFinite(parameters.repetitionPenalty)) {
    providerOption.repetitionPenalty = parameters.repetitionPenalty
  }
  if (parameters.reasoningEffort) {
    providerOption.reasoningEffort = parameters.reasoningEffort
    providerOption.effort = parameters.reasoningEffort
  }
  if (Object.keys(providerOption).length) {
    config.providerOptions = { ...providerOptions, [providerKey]: providerOption }
  }

  return config
}

function selectModel(modelId: string) {
  modelDraft.value = modelId
  if (instanceDraft.value) {
    instanceDraft.value.modelId = modelId
    markInstanceDirty()
  }
}
</script>

<template>
  <section class="settings-page">
    <aside class="settings-primary-pane">
      <nav class="settings-primary-nav" aria-label="设置分类">
        <button
          class="primary-nav-item"
          :class="{ active: settingsSection === 'general' }"
          type="button"
          @click="selectSection('general')"
        >
          <MdSettings class="nav-icon" aria-hidden="true" />
          <span>通用</span>
        </button>
        <button
          class="primary-nav-item"
          :class="{ active: settingsSection === 'models' }"
          type="button"
          @click="selectSection('models')"
        >
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
          <button
            v-for="provider in llmProviders"
            :key="provider.id"
            class="secondary-item provider-item"
            :class="{ selected: selectedLlmProvider?.id === provider.id }"
            type="button"
            @click="editLlmProvider(provider)"
          >
            <span class="provider-avatar">{{ (provider.name || provider.type).trim().slice(0, 1).toUpperCase() }}</span>
            <span class="secondary-copy">
              <strong>{{ provider.name || provider.type }}</strong>
              <small>{{ provider.type }} · {{ provider.modelsCache.length }} 模型</small>
            </span>
          </button>
          <p v-if="!llmProviders.length" class="empty-note">还没有模型供应商。</p>
        </div>
        <button class="add-provider-button" type="button" @click="createProviderForEditing">
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
              <small>插件 iframe URL 标签</small>
            </span>
            <input
              type="checkbox"
              :checked="debugMode"
              @change="setDebugMode(($event.target as HTMLInputElement).checked)"
            />
          </label>
        </div>
      </section>

      <section v-else class="detail-section">
        <template v-if="providerDraft">
          <header class="detail-header">
            <div class="detail-title">
              <span class="provider-avatar large">{{ providerInitial }}</span>
              <span>
                <h2>{{ providerTitle }}</h2>
                <small>{{ providerDraft.type }}</small>
              </span>
            </div>
            <div class="button-row">
              <button
                class="toolbar-button"
                type="button"
                aria-label="拉取模型"
                data-tooltip="拉取模型"
                @click="fetchSelectedLlmProviderModels"
              >
                <MdRefresh class="toolbar-icon" aria-hidden="true" />
              </button>
              <button
                class="toolbar-button"
                type="button"
                aria-label="保存供应商"
                data-tooltip="保存供应商"
                @click="saveProviderDraft"
              >
                <MdSave class="toolbar-icon" aria-hidden="true" />
              </button>
              <button
                class="toolbar-button danger"
                type="button"
                aria-label="删除供应商"
                data-tooltip="删除供应商"
                @click="deleteSelectedLlmProvider"
              >
                <MdDeleteOutline class="toolbar-icon" aria-hidden="true" />
              </button>
            </div>
          </header>

          <div class="detail-body">
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
                  <input
                    v-model="providerDraft.apiKey"
                    type="password"
                    autocomplete="off"
                    placeholder="仅保存在当前项目数据库"
                    @input="markProviderDirty"
                  />
                </label>
              </div>

              <div class="form-grid">
                <label>Base URL
                  <input
                    :value="providerBaseURL(providerDraft)"
                    placeholder="按 provider 默认值留空"
                    @input="setProviderBaseURL(($event.target as HTMLInputElement).value)"
                  />
                </label>
                <label>
                  高级 JSON
                  <span v-if="providerJsonError" class="json-status error">{{ providerJsonError }}</span>
                  <span v-else-if="providerConfigJson !== '{}'" class="json-status ok">有效</span>
                  <JsonEditor
                    v-model="providerConfigJson"
                    :rows="6"
                    aria-label="提供商高级 JSON"
                    @update:model-value="markProviderDirty"
                  />
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
                  <button class="outline-button compact-button" type="button" @click="clearSelectedLlmProviderModelsCache">
                    清空缓存
                  </button>
                  <button class="outline-button compact-button" type="button" @click="fetchSelectedLlmProviderModels">
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
                <button
                  v-for="model in providerDraft.modelsCache"
                  :key="model.id"
                  type="button"
                  class="model-row"
                  :class="{ selected: modelDraft === model.id }"
                  @click="selectModel(model.id)"
                  @dblclick="createInstanceFromProvider(model.id)"
                >
                  <span class="provider-avatar small">{{ model.displayName.trim().slice(0, 1).toUpperCase() || 'M' }}</span>
                  <span>{{ model.displayName }}</span>
                </button>
              </div>
              <p v-else class="empty-note inline">暂无缓存模型。</p>
            </section>

            <section class="settings-block">
              <div class="block-heading with-actions">
                <span class="heading-title">
                  <MdTune class="section-icon" aria-hidden="true" />
                  <h3>LLM 实例</h3>
                  <small>{{ selectedProviderInstances.length }}</small>
                </span>
                <button class="outline-button compact-button" type="button" @click="createLlmInstanceForSelectedProvider">
                  <MdAdd class="inline-icon" aria-hidden="true" />
                  新建实例
                </button>
              </div>

              <div v-if="selectedProviderInstances.length" class="instance-list">
                <button
                  v-for="instance in selectedProviderInstances"
                  :key="instance.id"
                  class="instance-row"
                  :class="{ selected: selectedLlmInstance?.id === instance.id }"
                  type="button"
                  @click="editLlmInstance(instance)"
                >
                  <strong>{{ instance.name }}</strong>
                  <span>{{ instance.modelId || '无模型' }}</span>
                </button>
              </div>
              <p v-else class="empty-note inline">暂无绑定实例。</p>

              <div v-if="instanceDraft && activeInstanceVisible" class="instance-editor">
                <div class="instance-editor-header">
                  <h4>{{ instanceDraft.name || 'LLM 实例' }}</h4>
                  <div class="button-row">
                    <button
                      class="toolbar-button"
                      type="button"
                      aria-label="恢复供应商"
                      data-tooltip="恢复供应商"
                      @click="restoreProviderForEditing"
                    >
                      <MdContentCopy class="toolbar-icon" aria-hidden="true" />
                    </button>
                    <button
                      class="toolbar-button"
                      type="button"
                      aria-label="保存实例"
                      data-tooltip="保存实例"
                      @click="saveInstanceDraft"
                    >
                      <MdSave class="toolbar-icon" aria-hidden="true" />
                    </button>
                    <button
                      class="toolbar-button danger"
                      type="button"
                      aria-label="删除实例"
                      data-tooltip="删除实例"
                      @click="deleteSelectedLlmInstance"
                    >
                      <MdDeleteOutline class="toolbar-icon" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div class="form-grid three">
                  <label>名称
                    <input v-model="instanceDraft.name" @input="markInstanceDirty" />
                  </label>
                  <label>API Key 来源
                    <select
                      :value="instanceDraft.providerId ?? ''"
                      @change="instanceDraft.providerId = ($event.target as HTMLSelectElement).value ? Number(($event.target as HTMLSelectElement).value) : null; markInstanceDirty()"
                    >
                      <option value="">未绑定</option>
                      <option v-for="provider in llmProviders" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
                    </select>
                  </label>
                  <label>模型 ID
                    <input v-model="instanceDraft.modelId" @input="markInstanceDirty" />
                  </label>
                </div>

                <div class="instance-snapshot">
                  <span>行为快照：{{ instanceDraft.providerSnapshot.type }} · {{ instanceDraft.providerSnapshot.providerName || '未命名供应商' }}</span>
                  <span>当前密钥来源：{{ instanceBoundProvider?.name || '无' }}</span>
                </div>

                <label class="json-label">
                  请求配置 JSON
                  <span v-if="instanceJsonError" class="json-status error">{{ instanceJsonError }}</span>
                  <span v-else-if="instanceExtraJson !== '{}'" class="json-status ok">有效</span>
                  <JsonEditor
                    v-model="instanceExtraJson"
                    :rows="10"
                    aria-label="LLM 实例请求配置 JSON"
                    @update:model-value="markInstanceDirty"
                  />
                </label>
              </div>
            </section>
          </div>
        </template>

        <div v-else class="empty-detail">
          <p>选择一个模型供应商，或添加新的供应商。</p>
          <button class="outline-button" type="button" @click="createProviderForEditing">
            <MdAdd class="inline-icon" aria-hidden="true" />
            添加
          </button>
        </div>
      </section>
    </main>
  </section>
</template>

<style scoped>
.settings-page {
  display: grid;
  grid-template-columns: 260px 360px minmax(0, 1fr);
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

.provider-list {
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
.secondary-item.selected {
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

.secondary-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.secondary-copy strong,
.secondary-copy small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.secondary-copy strong {
  color: #161b22;
  font-size: 14px;
  font-weight: 800;
}

.secondary-copy small {
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

.detail-header {
  position: sticky;
  top: 0;
  z-index: 3;
  min-height: 72px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid #e8ebef;
  background: #ffffff;
}

.detail-title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.detail-header h2 {
  margin: 0;
  color: #111827;
  font-size: 16px;
  font-weight: 800;
}

.detail-header small {
  color: #8a929e;
  font-size: 12px;
}

.detail-body {
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
.instance-editor-header {
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

.block-heading h3,
.instance-editor-header h4 {
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
  border-color: #2f6fca;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border: 1px solid #d9e0e9;
  border-radius: 8px;
  background: #fbfcfd;
  padding: 12px;
}

.switch-row span {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.switch-row strong {
  color: #243041;
  font-size: 13px;
}

.switch-row small {
  color: #637083;
  font-size: 12px;
}

.switch-row input {
  width: 18px;
  height: 18px;
  accent-color: #45b36b;
}

.outline-button,
.compact-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid #d4d9e1;
  border-radius: 8px;
  background: #ffffff;
  color: #303743;
  padding: 8px 10px;
  font-size: 13px;
  font-weight: 600;
}

.compact-button {
  padding: 7px 9px;
  white-space: nowrap;
}

.model-tools {
  align-items: end;
}

.model-tools label {
  flex: 1;
}

.model-list,
.instance-list {
  display: grid;
  gap: 8px;
}

.model-row,
.instance-row {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid #e1e5eb;
  border-radius: 8px;
  background: #ffffff;
  color: #1f2430;
  padding: 10px 12px;
  text-align: left;
}

.model-row:hover,
.model-row.selected,
.instance-row:hover,
.instance-row.selected {
  border-color: #cfd6e2;
  background: #f7f8fa;
}

.model-row span:last-child,
.instance-row strong,
.instance-row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.instance-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(120px, 28%);
}

.instance-row strong {
  color: #1f2430;
  font-size: 13px;
}

.instance-row span {
  color: #737c89;
  font-size: 12px;
  text-align: right;
}

.instance-editor {
  display: grid;
  gap: 12px;
  border: 1px solid #e3e7ed;
  border-radius: 8px;
  background: #fbfcfd;
  padding: 12px;
}

.instance-editor-header {
  justify-content: space-between;
}

.instance-snapshot {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  color: #637083;
  font-size: 12px;
}

.json-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  margin-left: 6px;
}

.json-status.ok {
  color: #2a8655;
}

.json-status.ok::before,
.json-status.error::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.json-status.ok::before {
  background: #2a8655;
}

.json-status.error {
  color: #c43e3e;
}

.json-status.error::before {
  background: #c43e3e;
}

.toolbar-button.danger:hover {
  background: #fff0f0;
  color: #a93131;
}

.empty-note,
.empty-detail {
  color: #8290a3;
  font-size: 12px;
}

.empty-note {
  padding: 12px 6px;
}

.empty-note.inline {
  padding: 4px 0;
}

.empty-detail {
  min-height: 100%;
  display: grid;
  place-content: center;
  gap: 10px;
  text-align: center;
}

@media (max-width: 1100px) {
  .settings-page {
    grid-template-columns: 210px 300px minmax(0, 1fr);
  }

  .form-grid.three {
    grid-template-columns: 1fr;
  }

  .block-heading.with-actions,
  .model-tools {
    align-items: stretch;
    flex-direction: column;
  }

  .inline-actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
