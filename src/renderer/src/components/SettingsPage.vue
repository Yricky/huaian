<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { MdAdd, MdContentCopy, MdDeleteOutline, MdRefresh, MdSave } from 'vue-icons-plus/md'
import type {
  LlmInstance,
  LlmProvider,
  LlmProviderType,
  JsonRecord,
  PromptTemplateSettings
} from '../../../shared/types'
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
  saveProjectConfig,
  saveLlmInstance,
  saveLlmProvider,
  selectLlmInstance,
  selectLlmProvider,
  selectedLlmInstance,
  selectedLlmProvider,
  showToast
} = useProjectWorkbench()

type SettingsTab = 'provider' | 'instance' | 'prompt'

const settingsTab = ref<SettingsTab>('provider')
const providerDraft = ref<LlmProvider | null>(null)
const providerConfigJson = ref('{}')
const modelDraft = ref('')
const instanceDraft = ref<LlmInstance | null>(null)
const instanceExtraJson = ref('{}')
const promptTemplateDraft = ref<PromptTemplateSettings | null>(null)
const promptTemplateGlobalJson = ref('{}')

const providerDirty = ref(false)
const instanceDirty = ref(false)
const promptDirty = ref(false)

const providerTitle = computed(() => providerDraft.value?.name || '提供商')
const instanceTitle = computed(() => instanceDraft.value?.name || 'LLM 实例')
const instanceBoundProvider = computed(() => {
  const id = instanceDraft.value?.providerId
  return id === null || id === undefined ? null : llmProviders.value.find(provider => provider.id === id) ?? null
})

const providerJsonError = computed(() => {
  try {
    const parsed = JSON.parse(providerConfigJson.value)
    if (!isJsonRecord(parsed)) return '必须是对象'
    return null
  } catch {
    return '格式不正确'
  }
})

const instanceJsonError = computed(() => {
  try {
    const parsed = JSON.parse(instanceExtraJson.value)
    if (!isJsonRecord(parsed)) return '必须是对象'
    return null
  } catch {
    return '格式不正确'
  }
})

const promptGlobalJsonError = computed(() => {
  try {
    const parsed = JSON.parse(promptTemplateGlobalJson.value)
    if (!isJsonRecord(parsed)) return '必须是对象'
    return null
  } catch {
    return '格式不正确'
  }
})

watch(selectedLlmProvider, (provider) => {
  providerDraft.value = provider ? JSON.parse(JSON.stringify(provider)) : null
  providerConfigJson.value = JSON.stringify(providerDraft.value?.config ?? {}, null, 2)
  providerDirty.value = false
}, { immediate: true })

watch(selectedLlmInstance, (instance) => {
  instanceDraft.value = instance ? JSON.parse(JSON.stringify(instance)) : null
  instanceExtraJson.value = JSON.stringify(requestConfigFromInstance(instanceDraft.value), null, 2)
  modelDraft.value = instanceDraft.value?.modelId ?? ''
  instanceDirty.value = false
}, { immediate: true })

watch([selectedLlmProvider, selectedLlmInstance], ([provider, instance]) => {
  if (settingsTab.value === 'provider' && !provider && instance) settingsTab.value = 'instance'
  if (settingsTab.value === 'instance' && !instance && provider) settingsTab.value = 'provider'
}, { immediate: true })

watch(() => project.value?.config.promptTemplate, (config) => {
  promptTemplateDraft.value = config ? JSON.parse(JSON.stringify(config.settings)) : null
  promptTemplateGlobalJson.value = JSON.stringify(config?.globalVariables ?? {}, null, 2)
  promptDirty.value = false
}, { immediate: true, deep: true })

function markProviderDirty() { providerDirty.value = true }
function markInstanceDirty() { instanceDirty.value = true }
function markPromptDirty() { promptDirty.value = true }

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

async function savePromptTemplateDraft() {
  if (!project.value || !promptTemplateDraft.value) return
  let globalVariables: JsonRecord
  try {
    const parsed = JSON.parse(promptTemplateGlobalJson.value)
    if (!isJsonRecord(parsed)) {
      showToast('Prompt Template 全局变量 JSON 必须是对象。', 'error')
      return
    }
    globalVariables = parsed
  } catch {
    showToast('Prompt Template 全局变量 JSON 格式不正确。', 'error')
    return
  }
  const saved = await saveProjectConfig({
    promptTemplate: {
      settings: promptTemplateDraft.value,
      globalVariables
    }
  })
  if (saved) {
    showToast('Prompt Template 设置已保存。', 'success')
    promptDirty.value = false
  }
}

async function createProviderForEditing() {
  settingsTab.value = 'provider'
  await createLlmProvider()
}

function editLlmProvider(provider: LlmProvider) {
  if (providerDirty.value && !window.confirm('有未保存的提供商更改，确定放弃？')) return
  settingsTab.value = 'provider'
  selectLlmProvider(provider)
}

function editLlmInstance(instance: LlmInstance) {
  if (instanceDirty.value && !window.confirm('有未保存的实例更改，确定放弃？')) return
  settingsTab.value = 'instance'
  selectLlmInstance(instance)
}

async function createInstanceFromProvider(modelId = modelDraft.value) {
  const provider = selectedLlmProvider.value
  const trimmedModel = modelId.trim()
  if (!provider || !trimmedModel) {
    showToast('请先选择提供商并输入模型 ID。', 'error')
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
  settingsTab.value = 'instance'
}

async function createLlmInstanceStandalone() {
  const firstProvider = llmProviders.value[0]
  await createLlmInstance({
    name: '新实例',
    providerId: firstProvider?.id ?? null,
    modelId: '',
    providerSnapshot: firstProvider
      ? providerSnapshot(firstProvider)
      : { providerName: '', type: 'custom', config: {} },
    parameters: {},
    extra: {}
  })
  settingsTab.value = 'instance'
}

async function restoreProviderForEditing() {
  settingsTab.value = 'provider'
  await restoreProviderFromSelectedInstance()
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

function isJsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
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
  if (instanceDraft.value) instanceDraft.value.modelId = modelId
}

function switchTab(tab: SettingsTab) {
  if (tab === settingsTab.value) return
  if (settingsTab.value === 'provider' && providerDirty.value && !window.confirm('有未保存的提供商更改，确定放弃？')) return
  if (settingsTab.value === 'instance' && instanceDirty.value && !window.confirm('有未保存的实例更改，确定放弃？')) return
  if (settingsTab.value === 'prompt' && promptDirty.value && !window.confirm('有未保存的 Prompt Template 更改，确定放弃？')) return
  settingsTab.value = tab
}
</script>

<template>
  <section class="settings-page">
    <aside class="settings-list-pane">
      <nav class="settings-tabs">
        <button
          class="settings-tab"
          :class="{ active: settingsTab === 'provider' }"
          @click="switchTab('provider')"
        >
          提供商
          <span v-if="providerDirty" class="dirty-dot" aria-label="有未保存更改" />
        </button>
        <button
          class="settings-tab"
          :class="{ active: settingsTab === 'instance' }"
          @click="switchTab('instance')"
        >
          LLM 实例
          <span v-if="instanceDirty" class="dirty-dot" aria-label="有未保存更改" />
        </button>
        <button
          class="settings-tab"
          :class="{ active: settingsTab === 'prompt' }"
          @click="switchTab('prompt')"
        >
          Prompt
          <span v-if="promptDirty" class="dirty-dot" aria-label="有未保存更改" />
        </button>
      </nav>

      <!-- 提供商列表 -->
      <template v-if="settingsTab === 'provider'">
        <div class="pane-header">
          <h2>提供商</h2>
          <button class="toolbar-button" type="button" aria-label="新建提供商" data-tooltip="新建提供商" @click="createProviderForEditing">
            <MdAdd class="toolbar-icon" aria-hidden="true" />
          </button>
        </div>
        <div class="settings-list">
          <button
            v-for="provider in llmProviders"
            :key="provider.id"
            class="settings-list-item"
            :class="{ selected: selectedLlmProvider?.id === provider.id }"
            type="button"
            @click="editLlmProvider(provider)"
          >
            <strong>{{ provider.name }}</strong>
            <span>{{ provider.type }} · {{ provider.modelsCache.length }} 个缓存模型</span>
          </button>
          <p v-if="!llmProviders.length" class="empty-note">还没有提供商，点击 + 新建。</p>
        </div>
      </template>

      <!-- 实例列表 -->
      <template v-if="settingsTab === 'instance'">
        <div class="pane-header">
          <h2>LLM 实例</h2>
          <button class="toolbar-button" type="button" aria-label="新建实例" data-tooltip="新建实例" @click="createLlmInstanceStandalone">
            <MdAdd class="toolbar-icon" aria-hidden="true" />
          </button>
        </div>
        <div class="settings-list">
          <button
            v-for="instance in llmInstances"
            :key="instance.id"
            class="settings-list-item"
            :class="{ selected: selectedLlmInstance?.id === instance.id }"
            type="button"
            @click="editLlmInstance(instance)"
          >
            <strong>{{ instance.name }}</strong>
            <span>{{ instance.providerSnapshot.type }} · {{ instance.modelId || '无模型' }}</span>
          </button>
          <p v-if="!llmInstances.length" class="empty-note">还没有 LLM 实例，点击 + 新建。</p>
        </div>
      </template>

      <!-- Prompt Template 列表（仅显示编辑入口） -->
      <template v-if="settingsTab === 'prompt'">
        <div class="pane-header">
          <h2>Prompt Template</h2>
        </div>
        <div class="settings-list">
          <div class="settings-list-item static-info">
            <strong>ST-Prompt-Template</strong>
            <span>EJS 模板渲染与变量注入</span>
          </div>
        </div>
      </template>
    </aside>

    <main class="settings-editor">
      <!-- 提供商编辑器 -->
      <section v-if="settingsTab === 'provider'" class="settings-section">
        <div class="pane-header">
          <h2>{{ providerTitle }}</h2>
          <div class="button-row">
            <button class="toolbar-button" type="button" aria-label="拉取模型" data-tooltip="拉取模型" @click="fetchSelectedLlmProviderModels">
              <MdRefresh class="toolbar-icon" aria-hidden="true" />
            </button>
            <button class="toolbar-button" type="button" aria-label="保存提供商" data-tooltip="保存提供商" @click="saveProviderDraft">
              <MdSave class="toolbar-icon" aria-hidden="true" />
            </button>
            <button class="toolbar-button" type="button" aria-label="删除提供商" data-tooltip="删除提供商" @click="deleteSelectedLlmProvider">
              <MdDeleteOutline class="toolbar-icon" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div v-if="providerDraft" class="settings-form">
          <div class="form-grid three">
            <label>名称<input v-model="providerDraft.name" @input="markProviderDirty" /></label>
            <label>类型
              <select v-model="providerDraft.type" @change="markProviderDirty">
                <option v-for="type in providerTypes" :key="type.value" :value="type.value">{{ type.label }}</option>
              </select>
            </label>
            <label>API Key<input v-model="providerDraft.apiKey" type="password" autocomplete="off" placeholder="仅保存在当前项目数据库" @input="markProviderDirty" /></label>
          </div>

          <div class="form-grid">
            <label>Base URL
              <input :value="providerBaseURL(providerDraft)" placeholder="按 provider 默认值留空" @input="setProviderBaseURL(($event.target as HTMLInputElement).value)" />
            </label>
            <label>
              高级 JSON
              <span v-if="providerJsonError" class="json-status error">{{ providerJsonError }}</span>
              <span v-else-if="providerConfigJson !== '{}'" class="json-status ok">有效</span>
              <JsonEditor v-model="providerConfigJson" :rows="6" aria-label="提供商高级 JSON" @update:model-value="markProviderDirty" />
            </label>
          </div>

          <div class="model-tools">
            <label>模型 ID<input v-model="modelDraft" placeholder="可从缓存选择，也可手动输入" /></label>
            <button class="outline-button" type="button" @click="createInstanceFromProvider()">从模型新建 LLM 实例</button>
            <button class="outline-button" type="button" @click="clearSelectedLlmProviderModelsCache">清空模型缓存</button>
          </div>

          <div v-if="providerDraft.modelsCache.length" class="model-cache">
            <span class="model-cache-hint">单击选中 · 双击创建实例</span>
            <button
              v-for="model in providerDraft.modelsCache"
              :key="model.id"
              type="button"
              class="model-chip"
              :class="{ selected: modelDraft === model.id }"
              @click="selectModel(model.id)"
              @dblclick="createInstanceFromProvider(model.id)"
            >
              {{ model.displayName }}
            </button>
          </div>
        </div>
        <p v-else class="empty-note">选择一个提供商进行编辑，或新建一个。</p>
      </section>

      <!-- 实例编辑器 -->
      <section v-if="settingsTab === 'instance'" class="settings-section">
        <div class="pane-header">
          <h2>{{ instanceTitle }}</h2>
          <div class="button-row">
            <button class="toolbar-button" type="button" aria-label="恢复提供商" data-tooltip="恢复提供商" @click="restoreProviderForEditing">
              <MdContentCopy class="toolbar-icon" aria-hidden="true" />
            </button>
            <button class="toolbar-button" type="button" aria-label="保存实例" data-tooltip="保存实例" @click="saveInstanceDraft">
              <MdSave class="toolbar-icon" aria-hidden="true" />
            </button>
            <button class="toolbar-button" type="button" aria-label="删除实例" data-tooltip="删除实例" @click="deleteSelectedLlmInstance">
              <MdDeleteOutline class="toolbar-icon" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div v-if="instanceDraft" class="settings-form">
          <div class="form-grid three">
            <label>名称<input v-model="instanceDraft.name" @input="markInstanceDirty" /></label>
            <label>API Key 来源
              <select
                :value="instanceDraft.providerId ?? ''"
                @change="instanceDraft.providerId = ($event.target as HTMLSelectElement).value ? Number(($event.target as HTMLSelectElement).value) : null; markInstanceDirty()"
              >
                <option value="">未绑定</option>
                <option v-for="provider in llmProviders" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
              </select>
            </label>
            <label>模型 ID<input v-model="instanceDraft.modelId" @input="markInstanceDirty" /></label>
          </div>

          <div class="instance-snapshot">
            <span>行为快照：{{ instanceDraft.providerSnapshot.type }} · {{ instanceDraft.providerSnapshot.providerName || '未命名提供商' }}</span>
            <span>当前密钥来源：{{ instanceBoundProvider?.name || '无' }}</span>
          </div>

          <label>
            请求配置 JSON
            <span v-if="instanceJsonError" class="json-status error">{{ instanceJsonError }}</span>
            <span v-else-if="instanceExtraJson !== '{}'" class="json-status ok">有效</span>
            <JsonEditor v-model="instanceExtraJson" :rows="12" aria-label="LLM 实例请求配置 JSON" @update:model-value="markInstanceDirty" />
          </label>
        </div>
        <p v-else class="empty-note">选择一个 LLM 实例进行编辑，或新建一个。</p>
      </section>

      <!-- Prompt Template 编辑器 -->
      <section v-if="settingsTab === 'prompt'" class="settings-section">
        <div class="pane-header">
          <h2>Prompt Template</h2>
          <div class="button-row">
            <button class="toolbar-button" type="button" aria-label="保存 Prompt Template 设置"
              data-tooltip="保存 Prompt Template 设置" @click="savePromptTemplateDraft">
              <MdSave class="toolbar-icon" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div v-if="promptTemplateDraft" class="settings-form">
          <fieldset class="switch-group">
            <legend>扩展控制</legend>
            <label><input v-model="promptTemplateDraft.enabled" type="checkbox" @change="markPromptDirty" />启用扩展</label>
          </fieldset>

          <fieldset class="switch-group">
            <legend>注入与渲染</legend>
            <label><input v-model="promptTemplateDraft.generateEnabled" type="checkbox" @change="markPromptDirty" />处理生成内容</label>
            <label><input v-model="promptTemplateDraft.generateLoaderEnabled" type="checkbox" @change="markPromptDirty" />[GENERATE] 注入</label>
            <label><input v-model="promptTemplateDraft.injectLoaderEnabled" type="checkbox" @change="markPromptDirty" />@INJECT 注入</label>
            <label><input v-model="promptTemplateDraft.renderEnabled" type="checkbox" @change="markPromptDirty" />处理楼层消息</label>
            <label><input v-model="promptTemplateDraft.renderLoaderEnabled" type="checkbox" @change="markPromptDirty" />[RENDER] 注入</label>
          </fieldset>

          <fieldset class="switch-group">
            <legend>消息处理</legend>
            <label><input v-model="promptTemplateDraft.rawMessageEvaluationEnabled" type="checkbox" @change="markPromptDirty" />生成后处理原始消息</label>
            <label><input v-model="promptTemplateDraft.filterMessageEnabled" type="checkbox" @change="markPromptDirty" />生成时过滤楼层 EJS</label>
          </fieldset>

          <fieldset class="switch-group">
            <legend>执行与兼容</legend>
            <label><input v-model="promptTemplateDraft.sandbox" type="checkbox" @change="markPromptDirty" />沙盒执行</label>
            <label><input v-model="promptTemplateDraft.withContextDisabled" type="checkbox" @change="markPromptDirty" />禁用 with 上下文</label>
            <label><input v-model="promptTemplateDraft.invertEnabled" type="checkbox" @change="markPromptDirty" />旧版禁用即启用</label>
          </fieldset>

          <fieldset class="switch-group">
            <legend>调试</legend>
            <label><input v-model="promptTemplateDraft.debugEnabled" type="checkbox" @change="markPromptDirty" />调试日志</label>
          </fieldset>

          <div class="form-grid three">
            <label>缓存模式
              <select v-model.number="promptTemplateDraft.cacheEnabled" @change="markPromptDirty">
                <option :value="0">关闭</option>
                <option :value="1">全部</option>
                <option :value="2">仅世界书</option>
              </select>
            </label>
            <label>缓存大小<input v-model.number="promptTemplateDraft.cacheSize" type="number" min="0" step="1" @input="markPromptDirty" /></label>
          </div>

          <label>
            全局变量 JSON
            <span v-if="promptGlobalJsonError" class="json-status error">{{ promptGlobalJsonError }}</span>
            <span v-else-if="promptTemplateGlobalJson !== '{}'" class="json-status ok">有效</span>
            <JsonEditor v-model="promptTemplateGlobalJson" :rows="8" aria-label="Prompt Template 全局变量 JSON" @update:model-value="markPromptDirty" />
          </label>
        </div>
      </section>
    </main>
  </section>
</template>

<style scoped>
.settings-page {
  display: grid;
  grid-template-columns: 300px 1fr;
  height: 100%;
  min-width: 0;
  background: #ffffff;
}

/* ---- Tab 导航 ---- */
.settings-tabs {
  display: flex;
  gap: 0;
  border-bottom: 2px solid #e5eaf1;
  padding: 0 2px;
  margin-bottom: 10px;
}

.settings-tab {
  position: relative;
  flex: 1;
  min-width: 0;
  padding: 9px 6px 8px;
  border: 0;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  background: transparent;
  color: #637083;
  font-size: 12px;
  font-weight: 500;
  text-align: center;
  white-space: nowrap;
  transition: color 140ms ease, border-color 140ms ease;
}

.settings-tab:hover {
  color: #314052;
}

.settings-tab.active {
  color: #1e3a6b;
  border-bottom-color: #2f6fca;
  font-weight: 600;
}

.dirty-dot {
  position: absolute;
  top: 6px;
  right: 4px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #e0962c;
}

/* ---- 侧栏 ---- */
.settings-list-pane {
  min-width: 0;
  overflow: auto;
  border-right: 1px solid #dde3eb;
  padding: 0 10px 12px;
}

.settings-editor {
  min-width: 0;
  overflow: auto;
  padding: 0 12px 18px;
}

.settings-list {
  display: grid;
  gap: 6px;
}

.settings-list-item {
  min-width: 0;
  display: grid;
  gap: 4px;
  text-align: left;
  border: 1px solid #d4dbe4;
  border-radius: 8px;
  background: #ffffff;
  padding: 9px;
}

.settings-list-item.selected {
  border-color: #2f6fca;
  background: #f4f8ff;
}

.settings-list-item.static-info {
  cursor: default;
  background: #fafbfc;
}

.settings-list-item strong,
.settings-list-item span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-list-item strong {
  color: #243041;
  font-size: 13px;
}

.settings-list-item span,
.instance-snapshot {
  color: #637083;
  font-size: 12px;
}

.empty-note {
  padding: 12px 6px;
  color: #8290a3;
  font-size: 12px;
}

/* ---- 编辑器通用 ---- */
.settings-section {
  border-bottom: 1px solid #edf0f4;
  padding-bottom: 12px;
}

.settings-form {
  display: grid;
  gap: 10px;
}

.form-grid {
  display: grid;
  gap: 9px;
  margin-bottom: 0;
}

.form-grid.three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.form-grid label {
  display: grid;
  gap: 4px;
  color: #536071;
  font-size: 12px;
}

.form-grid input,
.form-grid select {
  width: 100%;
  border: 1px solid #cfd7e2;
  border-radius: 8px;
  background: #ffffff;
  color: #1f2935;
  padding: 7px 8px;
  outline: none;
}

.form-grid input:focus,
.form-grid select:focus {
  border-color: #2f6fca;
}

/* ---- JSON 校验状态 ---- */
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

.json-status.ok::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #2a8655;
}

.json-status.error {
  color: #c43e3e;
}

.json-status.error::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #c43e3e;
}

/* ---- 模型缓存 ---- */
.model-tools {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: end;
  gap: 8px;
}

.model-tools label {
  display: grid;
  gap: 4px;
  color: #536071;
  font-size: 12px;
}

.model-cache {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.model-cache-hint {
  width: 100%;
  color: #8290a3;
  font-size: 11px;
  margin-bottom: 2px;
}

.model-chip {
  border: 1px solid #d5dce5;
  border-radius: 16px;
  background: #fbfcfd;
  color: #314052;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  transition: border-color 120ms ease, background 120ms ease;
}

.model-chip:hover {
  border-color: #b1bfce;
  background: #f0f3f7;
}

.model-chip.selected {
  border-color: #2f6fca;
  background: #f4f8ff;
  color: #174f99;
}

/* ---- 实例快照 ---- */
.instance-snapshot {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  border: 1px solid #d9e0e9;
  border-radius: 8px;
  background: #fbfcfd;
  padding: 8px;
}

/* ---- Switch 分组 (fieldset) ---- */
.switch-group {
  border: 1px solid #e5eaf1;
  border-radius: 10px;
  padding: 10px 12px 12px;
  margin: 0;
}

.switch-group legend {
  padding: 0 6px;
  color: #536071;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.switch-group label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 28px;
  color: #314052;
  font-size: 12px;
  margin-right: 18px;
}

.switch-group input[type='checkbox'] {
  width: auto;
  accent-color: #2f6fca;
}

/* ---- 响应式 ---- */
@media (max-width: 980px) {
  .settings-page {
    grid-template-columns: 240px 1fr;
  }

  .model-tools {
    grid-template-columns: 1fr;
  }

  .form-grid.three {
    grid-template-columns: 1fr;
  }

  .switch-group label {
    margin-right: 12px;
  }
}
</style>
