<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { MdAdd, MdContentCopy, MdDeleteOutline, MdDownload, MdRefresh, MdSave } from 'vue-icons-plus/md'
import type {
  LlmGenerationParameters,
  LlmInstance,
  LlmProvider,
  LlmProviderType
} from '../../../shared/types'
import { useProjectWorkbench } from '../composables/useProjectWorkbench'

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
  providerSnapshot,
  restoreProviderFromSelectedInstance,
  saveLlmInstance,
  saveLlmProvider,
  selectLlmInstance,
  selectLlmProvider,
  selectedLlmInstance,
  selectedLlmProvider
} = useProjectWorkbench()

const providerDraft = ref<LlmProvider | null>(null)
const providerConfigJson = ref('{}')
const modelDraft = ref('')
const instanceDraft = ref<LlmInstance | null>(null)
const instanceExtraJson = ref('{}')
const instanceParams = reactive<Record<keyof LlmGenerationParameters | 'stopSequencesText', string>>({
  temperature: '',
  topP: '',
  maxOutputTokens: '',
  frequencyPenalty: '',
  presencePenalty: '',
  repetitionPenalty: '',
  topK: '',
  stopSequences: '',
  stopSequencesText: '',
  seed: '',
  reasoningEffort: '',
  responseFormat: ''
})

const providerTitle = computed(() => providerDraft.value?.name || '提供商')
const instanceTitle = computed(() => instanceDraft.value?.name || 'LLM 实例')
const instanceBoundProvider = computed(() => {
  const id = instanceDraft.value?.providerId
  return id === null || id === undefined ? null : llmProviders.value.find(provider => provider.id === id) ?? null
})

watch(selectedLlmProvider, (provider) => {
  providerDraft.value = provider ? JSON.parse(JSON.stringify(provider)) : null
  providerConfigJson.value = JSON.stringify(providerDraft.value?.config ?? {}, null, 2)
}, { immediate: true })

watch(selectedLlmInstance, (instance) => {
  instanceDraft.value = instance ? JSON.parse(JSON.stringify(instance)) : null
  instanceExtraJson.value = JSON.stringify(instanceDraft.value?.extra ?? {}, null, 2)
  const parameters = instanceDraft.value?.parameters ?? {}
  instanceParams.temperature = numberText(parameters.temperature)
  instanceParams.topP = numberText(parameters.topP)
  instanceParams.maxOutputTokens = numberText(parameters.maxOutputTokens)
  instanceParams.frequencyPenalty = numberText(parameters.frequencyPenalty)
  instanceParams.presencePenalty = numberText(parameters.presencePenalty)
  instanceParams.repetitionPenalty = numberText(parameters.repetitionPenalty)
  instanceParams.topK = numberText(parameters.topK)
  instanceParams.seed = numberText(parameters.seed)
  instanceParams.stopSequencesText = parameters.stopSequences?.join('\n') ?? ''
  instanceParams.reasoningEffort = parameters.reasoningEffort ?? ''
  instanceParams.responseFormat = parameters.responseFormat ?? ''
  modelDraft.value = instanceDraft.value?.modelId ?? ''
}, { immediate: true })

function numberText(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

function numberOrNull(value: string, min: number, max: number): number | null {
  if (!value.trim()) return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.min(max, Math.max(min, number))
}

function selectedProviderConfig() {
  if (!providerDraft.value) return null
  try {
    return JSON.parse(providerConfigJson.value)
  } catch {
    window.alert('Provider 高级 JSON 格式不正确。')
    return null
  }
}

function selectedInstanceExtra() {
  try {
    return JSON.parse(instanceExtraJson.value)
  } catch {
    window.alert('实例高级 JSON 格式不正确。')
    return null
  }
}

async function saveProviderDraft() {
  if (!providerDraft.value) return
  const config = selectedProviderConfig()
  if (!config) return
  providerDraft.value.config = config
  await saveLlmProvider(providerDraft.value)
}

async function saveInstanceDraft() {
  if (!instanceDraft.value) return
  const extra = selectedInstanceExtra()
  if (!extra) return
  instanceDraft.value.extra = extra
  instanceDraft.value.parameters = buildParameters()
  await saveLlmInstance(instanceDraft.value)
}

function buildParameters(): LlmGenerationParameters {
  return {
    temperature: numberOrNull(instanceParams.temperature, 0, 2),
    topP: numberOrNull(instanceParams.topP, 0, 1),
    maxOutputTokens: numberOrNull(instanceParams.maxOutputTokens, 1, Number.MAX_SAFE_INTEGER),
    frequencyPenalty: numberOrNull(instanceParams.frequencyPenalty, -2, 2),
    presencePenalty: numberOrNull(instanceParams.presencePenalty, -2, 2),
    repetitionPenalty: numberOrNull(instanceParams.repetitionPenalty, 0, 2),
    topK: numberOrNull(instanceParams.topK, 1, Number.MAX_SAFE_INTEGER),
    seed: numberOrNull(instanceParams.seed, 0, Number.MAX_SAFE_INTEGER),
    stopSequences: instanceParams.stopSequencesText.split(/\r?\n/).map(item => item.trim()).filter(Boolean),
    reasoningEffort: instanceParams.reasoningEffort as LlmGenerationParameters['reasoningEffort'],
    responseFormat: instanceParams.responseFormat as LlmGenerationParameters['responseFormat']
  }
}

async function createInstanceFromProvider(modelId = modelDraft.value) {
  const provider = selectedLlmProvider.value
  const trimmedModel = modelId.trim()
  if (!provider || !trimmedModel) {
    window.alert('请先选择提供商并输入模型 ID。')
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

function setProviderBaseURL(value: string) {
  if (!providerDraft.value) return
  providerDraft.value.config = {
    ...providerDraft.value.config,
    baseURL: value
  }
  providerConfigJson.value = JSON.stringify(providerDraft.value.config, null, 2)
}

function providerBaseURL(provider: LlmProvider | null) {
  const value = provider?.config.baseURL
  return typeof value === 'string' ? value : ''
}

function selectModel(modelId: string) {
  modelDraft.value = modelId
  if (instanceDraft.value) instanceDraft.value.modelId = modelId
}
</script>

<template>
  <section class="settings-page">
    <aside class="settings-list-pane">
      <div class="pane-header">
        <h2>提供商</h2>
        <button class="toolbar-button" type="button" aria-label="新建提供商" data-tooltip="新建提供商" @click="createLlmProvider()">
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
          @click="selectLlmProvider(provider)"
        >
          <strong>{{ provider.name }}</strong>
          <span>{{ provider.type }} · {{ provider.modelsCache.length }} 个缓存模型</span>
        </button>
      </div>

      <div class="pane-header secondary">
        <h2>LLM 实例</h2>
      </div>

      <div class="settings-list">
        <button
          v-for="instance in llmInstances"
          :key="instance.id"
          class="settings-list-item"
          :class="{ selected: selectedLlmInstance?.id === instance.id }"
          type="button"
          @click="selectLlmInstance(instance)"
        >
          <strong>{{ instance.name }}</strong>
          <span>{{ instance.providerSnapshot.type }} · {{ instance.modelId }}</span>
        </button>
      </div>
    </aside>

    <main class="settings-editor">
      <section class="settings-section">
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
            <label>名称<input v-model="providerDraft.name" /></label>
            <label>类型
              <select v-model="providerDraft.type">
                <option v-for="type in providerTypes" :key="type.value" :value="type.value">{{ type.label }}</option>
              </select>
            </label>
            <label>API Key<input v-model="providerDraft.apiKey" type="password" autocomplete="off" placeholder="仅保存在当前项目数据库" /></label>
          </div>

          <div class="form-grid">
            <label>Base URL
              <input :value="providerBaseURL(providerDraft)" placeholder="按 provider 默认值留空" @input="setProviderBaseURL(($event.target as HTMLInputElement).value)" />
            </label>
            <label>高级 JSON
              <textarea v-model="providerConfigJson" rows="6" spellcheck="false" />
            </label>
          </div>

          <div class="model-tools">
            <label>模型 ID<input v-model="modelDraft" placeholder="可从缓存选择，也可手动输入" /></label>
            <button class="outline-button" type="button" @click="createInstanceFromProvider()">从模型新建 LLM 实例</button>
            <button class="outline-button" type="button" @click="clearSelectedLlmProviderModelsCache">清空模型缓存</button>
          </div>

          <div class="model-cache">
            <button
              v-for="model in providerDraft.modelsCache"
              :key="model.id"
              type="button"
              :class="{ selected: modelDraft === model.id }"
              @click="selectModel(model.id)"
              @dblclick="createInstanceFromProvider(model.id)"
            >
              {{ model.displayName }}
            </button>
          </div>
        </div>
        <p v-else class="empty-note">还没有提供商。</p>
      </section>

      <section class="settings-section">
        <div class="pane-header">
          <h2>{{ instanceTitle }}</h2>
          <div class="button-row">
            <button class="toolbar-button" type="button" aria-label="恢复提供商" data-tooltip="恢复提供商" @click="restoreProviderFromSelectedInstance">
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
            <label>名称<input v-model="instanceDraft.name" /></label>
            <label>API Key 来源
              <select
                :value="instanceDraft.providerId ?? ''"
                @change="instanceDraft.providerId = ($event.target as HTMLSelectElement).value ? Number(($event.target as HTMLSelectElement).value) : null"
              >
                <option value="">未绑定</option>
                <option v-for="provider in llmProviders" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
              </select>
            </label>
            <label>模型 ID<input v-model="instanceDraft.modelId" /></label>
          </div>

          <div class="instance-snapshot">
            <span>行为快照：{{ instanceDraft.providerSnapshot.type }} · {{ instanceDraft.providerSnapshot.providerName || '未命名提供商' }}</span>
            <span>当前密钥来源：{{ instanceBoundProvider?.name || '无' }}</span>
          </div>

          <div class="form-grid three">
            <label>Temperature<input v-model="instanceParams.temperature" type="number" min="0" max="2" step="0.01" placeholder="空" /></label>
            <label>Top P<input v-model="instanceParams.topP" type="number" min="0" max="1" step="0.01" placeholder="空" /></label>
            <label>Max Tokens<input v-model="instanceParams.maxOutputTokens" type="number" min="1" placeholder="空" /></label>
            <label>Frequency Penalty<input v-model="instanceParams.frequencyPenalty" type="number" min="-2" max="2" step="0.01" placeholder="空" /></label>
            <label>Presence Penalty<input v-model="instanceParams.presencePenalty" type="number" min="-2" max="2" step="0.01" placeholder="空" /></label>
            <label>Repetition Penalty<input v-model="instanceParams.repetitionPenalty" type="number" min="0" max="2" step="0.01" placeholder="空" /></label>
            <label>Top K<input v-model="instanceParams.topK" type="number" min="1" placeholder="空" /></label>
            <label>Seed<input v-model="instanceParams.seed" type="number" min="0" placeholder="空" /></label>
            <label>Reasoning
              <select v-model="instanceParams.reasoningEffort">
                <option value="">空</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </label>
            <label>Response Format
              <select v-model="instanceParams.responseFormat">
                <option value="">空</option>
                <option value="text">text</option>
                <option value="json">json</option>
              </select>
            </label>
          </div>

          <div class="form-grid">
            <label>Stop Sequences<textarea v-model="instanceParams.stopSequencesText" rows="3" placeholder="一行一个，空则不传" /></label>
            <label>高级 JSON<textarea v-model="instanceExtraJson" rows="6" spellcheck="false" /></label>
          </div>
        </div>
        <p v-else class="empty-note">还没有 LLM 实例。先选择提供商并输入模型 ID 创建一个。</p>
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

.pane-header.secondary {
  margin-top: 14px;
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

.settings-section {
  border-bottom: 1px solid #edf0f4;
  padding-bottom: 12px;
}

.settings-form {
  display: grid;
  gap: 10px;
}

.model-tools {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: end;
  gap: 8px;
}

.model-cache {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.model-cache button {
  border: 1px solid #d5dce5;
  border-radius: 7px;
  background: #fbfcfd;
  color: #314052;
  padding: 5px 8px;
  font-size: 12px;
}

.model-cache button.selected {
  border-color: #2f6fca;
  background: #f4f8ff;
}

.instance-snapshot {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  border: 1px solid #d9e0e9;
  border-radius: 8px;
  background: #fbfcfd;
  padding: 8px;
}

@media (max-width: 980px) {
  .settings-page {
    grid-template-columns: 240px 1fr;
  }

  .model-tools {
    grid-template-columns: 1fr;
  }
}
</style>
