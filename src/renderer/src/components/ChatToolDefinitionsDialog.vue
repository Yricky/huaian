<script setup lang="ts">
import { computed, ref } from 'vue'
import { MdAdd, MdClose, MdCode, MdDeleteOutline } from 'vue-icons-plus/md'
import type { ChatToolDefinition, JsonRecord, PluginDescriptor, PluginToolCallDefinition } from '../../../shared/types'
import type { AvailablePluginToolCall } from '../pluginRuntime'
import PluginFrame from './PluginFrame.vue'

interface ToolOption {
  key: string
  plugin: PluginDescriptor
  toolCall: PluginToolCallDefinition
}

interface ToolDefinitionItem {
  definition: ChatToolDefinition
  index: number
  key: string
  plugin: PluginDescriptor | null
  toolCall: PluginToolCallDefinition | null
  available: boolean
}

const props = defineProps<{
  activePluginIds: string[]
  canEdit: boolean
  plugins: PluginDescriptor[]
  toolCalls: AvailablePluginToolCall[]
  toolDefinitions: ChatToolDefinition[]
}>()

const emit = defineEmits<{
  close: []
  'update:toolDefinitions': [value: ChatToolDefinition[]]
}>()

const addOpen = ref(false)
const openTools = ref<Record<string, boolean>>({})

const activePluginIdSet = computed(() => new Set(props.activePluginIds))
const definitionKeys = computed(() => new Set(props.toolDefinitions.map(toolDefinitionKey)))
const toolOptions = computed<ToolOption[]>(() => props.toolCalls
  .filter(item => activePluginIdSet.value.has(item.plugin.manifest.id))
  .map(({ plugin, toolCall }) => ({
    key: toolDefinitionKey({ pluginId: plugin.manifest.id, toolCallName: toolCall.name }),
    plugin,
    toolCall
  })))
const availableToolOptions = computed(() => toolOptions.value.filter(option => !definitionKeys.value.has(option.key)))
const definitionItems = computed<ToolDefinitionItem[]>(() => props.toolDefinitions.map((definition, index) => {
  const availableTool = props.toolCalls.find(item => (
    item.plugin.manifest.id === definition.pluginId &&
    item.toolCall.name === definition.toolCallName
  )) ?? null
  const plugin = availableTool?.plugin ?? props.plugins.find(item => item.manifest.id === definition.pluginId) ?? null
  const toolCall = availableTool?.toolCall ?? null
  const available = Boolean(plugin && toolCall && activePluginIdSet.value.has(definition.pluginId))
  return {
    definition,
    index,
    key: toolDefinitionKey(definition),
    plugin,
    toolCall,
    available
  }
}))

function toolDefinitionKey(definition: Pick<ChatToolDefinition, 'pluginId' | 'toolCallName'>): string {
  return `${definition.pluginId}\u0000${definition.toolCallName}`
}

function toolDefinitionTitle(item: ToolDefinitionItem): string {
  const pluginName = item.plugin?.manifest.name || item.definition.pluginId
  const toolName = item.toolCall?.label || item.toolCall?.name || item.definition.toolCallName
  return `${pluginName} · ${toolName}`
}

function optionTitle(option: ToolOption): string {
  return `${option.plugin.manifest.name || option.plugin.manifest.id} · ${option.toolCall.label || option.toolCall.name}`
}

function toolSettingsHtml(item: ToolDefinitionItem): string {
  return item.toolCall?.settingsHtml ?? ''
}

function isToolOpen(key: string): boolean {
  return openTools.value[key] === true
}

function toggleTool(key: string) {
  openTools.value = {
    ...openTools.value,
    [key]: !isToolOpen(key)
  }
}

function emitDefinitions(definitions: ChatToolDefinition[]) {
  emit('update:toolDefinitions', definitions)
}

function addTool(option: ToolOption) {
  if (!props.canEdit || definitionKeys.value.has(option.key)) return
  addOpen.value = false
  openTools.value = {
    ...openTools.value,
    [option.key]: true
  }
  emitDefinitions([
    ...props.toolDefinitions,
    {
      pluginId: option.plugin.manifest.id,
      toolCallName: option.toolCall.name,
      commonArgs: {}
    }
  ])
}

function removeTool(index: number) {
  if (!props.canEdit) return
  emitDefinitions(props.toolDefinitions.filter((_, itemIndex) => itemIndex !== index))
}

function updateCommonArgs(index: number, commonArgs: JsonRecord) {
  if (!props.canEdit) return
  emitDefinitions(props.toolDefinitions.map((definition, itemIndex) => (
    itemIndex === index ? { ...definition, commonArgs } : definition
  )))
}
</script>

<template>
  <div class="tool-dialog" role="dialog" aria-modal="true" @click.self="emit('close')">
    <section class="tool-panel">
      <header class="tool-panel-header">
        <div>
          <h2>工具调用</h2>
          <p>{{ toolDefinitions.length }} 个已配置工具组</p>
        </div>
        <button class="toolbar-button" type="button" aria-label="关闭" data-tooltip="关闭" @click="emit('close')">
          <MdClose class="toolbar-icon" aria-hidden="true" />
        </button>
      </header>

      <div class="tool-panel-body">
        <section class="tool-actions">
          <button class="add-tool-button" type="button" :disabled="!canEdit" @click="addOpen = !addOpen">
            <MdAdd class="tool-action-icon" aria-hidden="true" />
            <span>添加工具</span>
          </button>
          <div v-if="addOpen" class="tool-option-list">
            <button
              v-for="option in availableToolOptions"
              :key="option.key"
              class="tool-option"
              type="button"
              @click="addTool(option)"
            >
              <span>{{ optionTitle(option) }}</span>
            </button>
            <p v-if="availableToolOptions.length === 0" class="tool-empty">当前聊天没有可添加的工具调用。</p>
          </div>
        </section>

        <section v-if="definitionItems.length" class="tool-definition-list">
          <article
            v-for="item in definitionItems"
            :key="item.key"
            class="tool-definition-panel"
            :class="{ unavailable: !item.available }"
          >
            <header class="tool-definition-header">
              <button class="tool-definition-toggle" type="button" @click="toggleTool(item.key)">
                <MdCode class="tool-definition-icon" aria-hidden="true" />
                <span>{{ toolDefinitionTitle(item) }}</span>
                <small v-if="!item.available">不可用</small>
              </button>
              <button
                class="tool-definition-delete"
                type="button"
                aria-label="删除工具"
                data-tooltip="删除"
                :disabled="!canEdit"
                @click.stop="removeTool(item.index)"
              >
                <MdDeleteOutline class="tool-definition-delete-icon" aria-hidden="true" />
              </button>
            </header>
            <div v-if="isToolOpen(item.key)" class="tool-definition-body">
              <p v-if="!item.available" class="tool-definition-note invalid">当前工具调用插件不可用。</p>
              <PluginFrame
                v-else-if="toolSettingsHtml(item)"
                :plugin-id="item.definition.pluginId"
                :html-path="toolSettingsHtml(item)"
                :common-args="item.definition.commonArgs"
                @update:common-args="updateCommonArgs(item.index, $event)"
              />
              <p v-else class="tool-definition-note">该工具没有设置页。</p>
            </div>
          </article>
        </section>
        <p v-else class="tool-empty">尚未配置工具调用。</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.tool-dialog {
  position: fixed;
  inset: 0;
  z-index: 150;
  display: grid;
  place-items: center;
  background: rgba(25, 31, 39, 0.34);
  padding: 24px;
}

.tool-panel {
  width: min(780px, 94vw);
  height: min(720px, 86vh);
  min-width: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 18px 50px rgba(26, 33, 42, 0.26);
}

.tool-panel-header {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid #edf0f4;
  padding: 14px 16px;
}

.tool-panel-header h2,
.tool-panel-header p {
  margin: 0;
}

.tool-panel-header h2 {
  color: #253044;
  font-size: 16px;
}

.tool-panel-header p {
  color: #7a8594;
  font-size: 12px;
}

.tool-panel-body {
  min-width: 0;
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 10px;
  overflow: auto;
  padding: 12px 16px 16px;
}

.tool-actions {
  min-width: 0;
  display: grid;
  gap: 8px;
}

.add-tool-button,
.tool-option {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid #d8dee7;
  border-radius: 7px;
  background: #ffffff;
  color: #303a49;
  padding: 7px 9px;
  text-align: left;
  font-size: 12px;
}

.add-tool-button {
  width: fit-content;
}

.add-tool-button:hover:not(:disabled),
.tool-option:hover:not(:disabled) {
  background: #f4f8ff;
  color: #174f99;
}

.add-tool-button:disabled {
  cursor: default;
  opacity: 0.45;
}

.tool-action-icon {
  width: 17px;
  height: 17px;
}

.tool-option-list,
.tool-definition-list {
  min-width: 0;
  display: grid;
  gap: 8px;
}

.tool-option {
  width: 100%;
}

.tool-option span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-empty {
  margin: 0;
  color: #7a8594;
  font-size: 12px;
}

.tool-definition-panel {
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  border: 1px solid #d8dee7;
  border-radius: 8px;
  background: #fbfaf7;
}

.tool-definition-panel.unavailable {
  border-color: #efcaca;
  background: #fff8f8;
}

.tool-definition-header {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
}

.tool-definition-toggle {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 7px;
  border: 0;
  background: transparent;
  color: #526173;
  padding: 3px 0;
  text-align: left;
}

.tool-definition-toggle span,
.tool-definition-toggle small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-definition-toggle span {
  color: #334052;
  font-size: 13px;
  font-weight: 600;
}

.tool-definition-toggle small {
  color: #9d2c2c;
  font-size: 12px;
}

.tool-definition-icon {
  width: 17px;
  height: 17px;
  flex-shrink: 0;
}

.tool-definition-delete {
  position: relative;
  width: 28px;
  height: 28px;
  display: grid;
  flex-shrink: 0;
  place-items: center;
  border: 1px solid #d8dee7;
  border-radius: 7px;
  background: #ffffff;
  color: #657085;
  padding: 0;
}

.tool-definition-delete:hover:not(:disabled) {
  background: #fff4f4;
  color: #9d2c2c;
}

.tool-definition-delete:disabled {
  cursor: default;
  opacity: 0.45;
}

.tool-definition-delete-icon {
  width: 16px;
  height: 16px;
}

.tool-definition-body {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  border-top: 1px solid #e4e9f0;
  background: #ffffff;
  padding: 10px;
}

.tool-definition-note {
  margin: 0;
  color: #526173;
  font-size: 12px;
}

.tool-definition-note.invalid {
  color: #9d2c2c;
}
</style>
