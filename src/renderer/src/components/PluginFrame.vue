<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ChatSession, JsonRecord } from '../../../shared/types'
import { asRecord, cloneJson } from '../../../shared/value-utils'

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
const frameSrc = ref('')
const currentChat = ref<ChatSession | null>(null)
const currentCommonArgs = computed(() => asRecord(props.commonArgs))
let frameObjectUrl = ''
let mounted = false
let loadToken = 0

function bridgeScript(): string {
  return `
<script>
(() => {
  const frameId = ${JSON.stringify(frameId)};
  let nextId = 0;
  const pending = new Map();
  window.addEventListener('message', event => {
    const data = event.data || {};
    if (data.source !== 'st-forge-plugin-host' || data.frameId !== frameId) return;
    const item = pending.get(data.id);
    if (!item) return;
    pending.delete(data.id);
    if (data.ok) item.resolve(data.value);
    else item.reject(new Error(data.error || 'Plugin API call failed'));
  });
  function call(method, args) {
    const id = ++nextId;
    window.parent.postMessage({ source: 'st-forge-plugin-frame', frameId, id, method, args }, '*');
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }
  window.parentPluginApi = {
    storage: {
      list: path => call('storage.list', [path || '']),
      listFor: (pluginId, path) => call('storage.listFor', [pluginId, path || '']),
      readText: path => call('storage.readText', [path]),
      readTextFor: (pluginId, path) => call('storage.readTextFor', [pluginId, path]),
      readBase64: path => call('storage.readBase64', [path]),
      readBase64For: (pluginId, path) => call('storage.readBase64For', [pluginId, path]),
      writeText: (path, content) => call('storage.writeText', [path, content]),
      writeTextFor: (pluginId, path, content) => call('storage.writeTextFor', [pluginId, path, content]),
      writeBase64: (path, content) => call('storage.writeBase64', [path, content]),
      writeBase64For: (pluginId, path, content) => call('storage.writeBase64For', [pluginId, path, content]),
      delete: path => call('storage.delete', [path]),
      deleteFor: (pluginId, path) => call('storage.deleteFor', [pluginId, path]),
      readJson: (path, fallback) => call('storage.readJson', [path, fallback]),
      readJsonFor: (pluginId, path, fallback) => call('storage.readJsonFor', [pluginId, path, fallback]),
      writeJson: (path, value) => call('storage.writeJson', [path, value]),
      writeJsonFor: (pluginId, path, value) => call('storage.writeJsonFor', [pluginId, path, value])
    },
    chat: {
      getSession: () => call('chat.getSession', []),
      getPluginData: () => call('chat.getPluginData', []),
      setPluginData: value => call('chat.setPluginData', [value])
    },
    toolSettings: {
      getCommonArgs: () => call('toolSettings.getCommonArgs', []),
      setCommonArgs: value => call('toolSettings.setCommonArgs', [value])
    }
  };
})();
<\/script>`
}

function withBridge(html: string): string {
  const base = `<base href="${window.electronAPI.pluginAssetUrl(props.pluginId, './')}">`
  const injected = `${base}${bridgeScript()}`
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${injected}`)
  return `${injected}${html}`
}

async function loadHtml() {
  const token = ++loadToken
  const html = await window.electronAPI.readPluginFile(props.pluginId, props.htmlPath)
  if (!mounted || token !== loadToken) return
  const nextUrl = URL.createObjectURL(new Blob([withBridge(html)], { type: 'text/html' }))
  if (frameObjectUrl) URL.revokeObjectURL(frameObjectUrl)
  frameObjectUrl = nextUrl
  frameSrc.value = nextUrl
}

function reply(id: number, value: unknown, ok = true, error = '') {
  const frame = document.querySelector<HTMLIFrameElement>(`iframe[data-plugin-frame="${frameId}"]`)
  const messageValue = value === undefined ? null : cloneJson(value)
  frame?.contentWindow?.postMessage({
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
  const id = Number(data.id)
  const method = String(data.method ?? '')
  const args = Array.isArray(data.args) ? data.args : []
  void handleMethod(method, args)
    .then(value => reply(id, value))
    .catch(error => reply(id, null, false, error instanceof Error ? error.message : String(error)))
}

watch(() => [props.pluginId, props.htmlPath], () => {
  if (mounted) void loadHtml()
})

watch(() => props.chat, (chat) => {
  currentChat.value = chat ? cloneJson(chat) : null
}, { immediate: true })

onMounted(() => {
  mounted = true
  window.addEventListener('message', onMessage)
  void loadHtml()
})

onBeforeUnmount(() => {
  mounted = false
  loadToken += 1
  window.removeEventListener('message', onMessage)
  if (frameObjectUrl) URL.revokeObjectURL(frameObjectUrl)
})
</script>

<template>
  <iframe class="plugin-frame" :data-plugin-frame="frameId" sandbox="allow-scripts allow-downloads" :src="frameSrc" />
</template>

<style scoped>
.plugin-frame {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  border: 0px;
  background: #ffffff;
}
</style>
