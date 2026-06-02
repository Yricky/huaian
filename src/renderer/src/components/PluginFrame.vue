<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ChatSession, JsonRecord } from '../../../shared/types'
import { asRecord, cloneJson } from '../../../shared/value-utils'
import { useProjectWorkbench } from '../composables/useProjectWorkbench'

const props = defineProps<{
  chat?: ChatSession
  commonArgs?: JsonRecord
  htmlPath: string
  pluginId: string
}>()

const emit = defineEmits<{
  'update:chat': [value: ChatSession]
  'update:commonArgs': [value: JsonRecord]
}>()

const frameId = Math.random().toString(36).slice(2)
const { project } = useProjectWorkbench()
const currentChat = ref<ChatSession | null>(null)
const currentCommonArgs = computed(() => asRecord(props.commonArgs))
const debugMode = computed(() => Boolean(project.value?.config.debugMode))
const frameSrc = computed(() => window.electronAPI.pluginAssetUrl(props.pluginId, props.htmlPath))
const debugFrameUrl = frameSrc

function pluginFrame(): HTMLIFrameElement | null {
  return document.querySelector<HTMLIFrameElement>(`iframe[data-plugin-frame="${frameId}"]`)
}

function reply(id: number, value: unknown, ok = true, error = '') {
  const messageValue = value === undefined ? null : cloneJson(value)
  pluginFrame()?.contentWindow?.postMessage({
    source: 'st-forge-plugin-host',
    frameId,
    id,
    ok,
    value: messageValue,
    error
  }, '*')
}

async function handleMethod(method: string, args: unknown[]): Promise<unknown> {
  if (method === 'storage.list') return window.electronAPI.listPluginDataFiles(props.pluginId, String(args[0] ?? ''))
  if (method === 'storage.listFor') return window.electronAPI.listPluginDataFiles(String(args[0]), String(args[1] ?? ''))
  if (method === 'storage.readText') return window.electronAPI.readPluginDataFile(props.pluginId, String(args[0]))
  if (method === 'storage.readTextFor') return window.electronAPI.readPluginDataFile(String(args[0]), String(args[1]))
  if (method === 'storage.readBase64') return window.electronAPI.readPluginDataFileBase64(props.pluginId, String(args[0]))
  if (method === 'storage.readBase64For') return window.electronAPI.readPluginDataFileBase64(String(args[0]), String(args[1]))
  if (method === 'storage.writeText') {
    await window.electronAPI.writePluginDataFile(props.pluginId, String(args[0]), String(args[1] ?? ''))
    dispatchPluginDataChanged(props.pluginId)
    return null
  }
  if (method === 'storage.writeTextFor') {
    const targetPluginId = String(args[0])
    await window.electronAPI.writePluginDataFile(targetPluginId, String(args[1]), String(args[2] ?? ''))
    dispatchPluginDataChanged(targetPluginId)
    return null
  }
  if (method === 'storage.writeBase64') {
    await window.electronAPI.writePluginDataFileBase64(props.pluginId, String(args[0]), String(args[1] ?? ''))
    dispatchPluginDataChanged(props.pluginId)
    return null
  }
  if (method === 'storage.writeBase64For') {
    const targetPluginId = String(args[0])
    await window.electronAPI.writePluginDataFileBase64(targetPluginId, String(args[1]), String(args[2] ?? ''))
    dispatchPluginDataChanged(targetPluginId)
    return null
  }
  if (method === 'storage.delete') {
    await window.electronAPI.deletePluginDataFile(props.pluginId, String(args[0]))
    dispatchPluginDataChanged(props.pluginId)
    return null
  }
  if (method === 'storage.deleteFor') {
    const targetPluginId = String(args[0])
    await window.electronAPI.deletePluginDataFile(targetPluginId, String(args[1]))
    dispatchPluginDataChanged(targetPluginId)
    return null
  }
  if (method === 'storage.readJson') {
    try {
      return JSON.parse(await window.electronAPI.readPluginDataFile(props.pluginId, String(args[0])))
    } catch {
      return args[1] ?? {}
    }
  }
  if (method === 'storage.readJsonFor') {
    try {
      return JSON.parse(await window.electronAPI.readPluginDataFile(String(args[0]), String(args[1])))
    } catch {
      return args[2] ?? {}
    }
  }
  if (method === 'storage.writeJson') {
    await window.electronAPI.writePluginDataFile(props.pluginId, String(args[0]), `${JSON.stringify(args[1] ?? {}, null, 2)}\n`)
    dispatchPluginDataChanged(props.pluginId)
    return null
  }
  if (method === 'storage.writeJsonFor') {
    const targetPluginId = String(args[0])
    await window.electronAPI.writePluginDataFile(targetPluginId, String(args[1]), `${JSON.stringify(args[2] ?? {}, null, 2)}\n`)
    dispatchPluginDataChanged(targetPluginId)
    return null
  }
  if (method === 'chat.getSession') return currentChat.value ? cloneJson(currentChat.value) : null
  if (method === 'chat.getPluginData') return asRecord(asRecord(currentChat.value?.runtimeConfig.pluginData)[props.pluginId])
  if (method === 'chat.setPluginData') {
    if (!currentChat.value) throw new Error('当前插件页面没有绑定聊天。')
    const nextChat = await window.electronAPI.updateChat(JSON.stringify({
      id: currentChat.value.id,
      title: currentChat.value.title,
      runtimeConfig: {
        ...currentChat.value.runtimeConfig,
        pluginData: {
          ...asRecord(currentChat.value.runtimeConfig.pluginData),
          [props.pluginId]: asRecord(args[0])
        }
      }
    }))
    currentChat.value = cloneJson(nextChat)
    emit('update:chat', nextChat)
    dispatchPluginDataChanged(props.pluginId)
    dispatchProjectSnapshotChanged()
    return asRecord(asRecord(nextChat.runtimeConfig.pluginData)[props.pluginId])
  }
  if (method === 'toolSettings.getCommonArgs') return cloneJson(currentCommonArgs.value)
  if (method === 'toolSettings.setCommonArgs') {
    const nextCommonArgs = cloneJson(asRecord(args[0]))
    emit('update:commonArgs', nextCommonArgs)
    return nextCommonArgs
  }
  throw new Error(`Unknown plugin API method: ${method}`)
}

function dispatchPluginDataChanged(pluginId: string): void {
  window.dispatchEvent(new CustomEvent('st-forge-plugin-data-changed', { detail: { pluginId } }))
}

function dispatchProjectSnapshotChanged(): void {
  window.dispatchEvent(new CustomEvent('st-forge-project-snapshot-changed'))
}

function onMessage(event: MessageEvent) {
  const data = asRecord(event.data)
  if (data.source !== 'st-forge-plugin-frame' || data.frameId !== frameId) return
  const frame = pluginFrame()
  if (!frame?.contentWindow || event.source !== frame.contentWindow) return
  const id = Number(data.id)
  const method = String(data.method ?? '')
  const args = Array.isArray(data.args) ? data.args : []
  void handleMethod(method, args)
    .then(value => reply(id, value))
    .catch(error => reply(id, null, false, error instanceof Error ? error.message : String(error)))
}

watch(() => props.chat, (chat) => {
  currentChat.value = chat ? cloneJson(chat) : null
}, { immediate: true })

onMounted(() => {
  window.addEventListener('message', onMessage)
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
})
</script>

<template>
  <div class="plugin-frame-shell">
    <iframe class="plugin-frame" :data-plugin-frame="frameId" :name="frameId"
      sandbox="allow-scripts allow-downloads allow-same-origin" :src="frameSrc" />
    <span v-if="debugMode" class="plugin-frame-debug-label">{{ debugFrameUrl }}</span>
  </div>
</template>

<style scoped>
.plugin-frame-shell {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.plugin-frame {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  border: 0px;
  background: #ffffff;
}

.plugin-frame-debug-label {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 2;
  max-width: min(100%, 680px);
  box-sizing: border-box;
  overflow: hidden;
  padding: 4px 8px;
  background: #d71920;
  color: #ffffff;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.35;
  pointer-events: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
