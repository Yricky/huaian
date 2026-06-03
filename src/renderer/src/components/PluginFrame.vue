<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import type { ChatSession, JsonRecord } from '../../../shared/types'
import { asRecord, toStructuredCloneable } from '../../../shared/value-utils'
import { useProjectWorkbench } from '../composables/useProjectWorkbench'
import { connectPluginFrame, registerPluginFrame, type PluginFrameRegistration } from '../pluginWorkerHost'

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
let unregisterFrame: (() => void) | null = null
let registration: PluginFrameRegistration | null = null

const frameCapabilities = computed(() => ({
  chat: props.chat !== undefined,
  toolSettings: props.commonArgs !== undefined
}))

function pluginFrame(): HTMLIFrameElement | null {
  return document.querySelector<HTMLIFrameElement>(`iframe[data-plugin-frame="${frameId}"]`)
}

function dispatchPluginDataChanged(pluginId: string): void {
  window.dispatchEvent(new CustomEvent('huaian-plugin-data-changed', { detail: { pluginId } }))
}

function dispatchProjectSnapshotChanged(): void {
  window.dispatchEvent(new CustomEvent('huaian-project-snapshot-changed'))
}

async function setChatPluginData(value: JsonRecord): Promise<JsonRecord> {
  if (!currentChat.value) throw new Error('当前插件页面没有绑定聊天。')
  const runtimeConfig = toRaw(currentChat.value.runtimeConfig)
  const nextChat = await window.electronAPI.updateChat({
    id: currentChat.value.id,
    title: currentChat.value.title,
    runtimeConfig: {
      ...runtimeConfig,
      pluginData: {
        ...asRecord(runtimeConfig.pluginData),
        [props.pluginId]: asRecord(value)
      }
    }
  })
  const clonedChat = toStructuredCloneable(nextChat) ?? nextChat
  currentChat.value = clonedChat
  emit('update:chat', clonedChat)
  dispatchPluginDataChanged(props.pluginId)
  dispatchProjectSnapshotChanged()
  return asRecord(asRecord(clonedChat.runtimeConfig.pluginData)[props.pluginId])
}

function setCommonArgs(value: JsonRecord): JsonRecord {
  const nextCommonArgs = toStructuredCloneable(asRecord(value)) ?? {}
  emit('update:commonArgs', nextCommonArgs)
  return nextCommonArgs
}

function connectFrame(): void {
  connectPluginFrame(frameId)
}

watch(() => props.chat, (chat) => {
  currentChat.value = chat ? (toStructuredCloneable(chat) ?? null) : null
}, { immediate: true })

onMounted(() => {
  registration = {
    capabilities: frameCapabilities.value,
    frameId,
    getChat: () => currentChat.value,
    getCommonArgs: () => toStructuredCloneable(currentCommonArgs.value) ?? {},
    getWindow: () => pluginFrame()?.contentWindow ?? null,
    pluginId: props.pluginId,
    setChatPluginData,
    setCommonArgs
  }
  unregisterFrame = registerPluginFrame(registration)
})

onBeforeUnmount(() => {
  unregisterFrame?.()
  unregisterFrame = null
  registration = null
})

watch(frameCapabilities, capabilities => {
  if (registration) registration.capabilities = capabilities
})
</script>

<template>
  <div class="plugin-frame-shell">
    <iframe class="plugin-frame" :data-plugin-frame="frameId" :name="frameId"
      sandbox="allow-scripts allow-downloads allow-same-origin allow-modals" :src="frameSrc" @load="connectFrame" />
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
