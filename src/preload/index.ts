import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  ChatGenerationEvent,
  ElectronApi,
  IpcInvokeChannel,
  IpcRendererEventChannel,
  PluginToolCallRequest
} from '../shared/types'

function invokeIpc<TResult>(channel: IpcInvokeChannel, ...args: unknown[]): Promise<TResult> {
  return ipcRenderer.invoke(channel, ...args) as Promise<TResult>
}

function onIpcEvent(channel: 'plugin:toolCallRequest', callback: (event: PluginToolCallRequest) => void): () => void
function onIpcEvent(channel: 'chat:generationEvent', callback: (event: ChatGenerationEvent) => void): () => void
function onIpcEvent(
  channel: IpcRendererEventChannel,
  callback: ((event: PluginToolCallRequest) => void) | ((event: ChatGenerationEvent) => void)
): () => void {
  const listener = (_: IpcRendererEvent, event: PluginToolCallRequest | ChatGenerationEvent) => (
    (callback as (event: PluginToolCallRequest | ChatGenerationEvent) => void)(event)
  )
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const electronAPI: ElectronApi = {
  getProject: () => invokeIpc('project:get'),
  listRecentProjects: () => invokeIpc('project:listRecent'),
  updateProjectConfig: payload => invokeIpc('project:updateConfig', payload),
  openProject: () => invokeIpc('project:open'),
  openProjectPath: path => invokeIpc('project:openPath', path),
  createLlmProvider: payload => invokeIpc('llm:createProvider', payload),
  updateLlmProvider: payload => invokeIpc('llm:updateProvider', payload),
  deleteLlmProvider: id => invokeIpc('llm:deleteProvider', id),
  fetchLlmProviderModels: id => invokeIpc('llm:fetchProviderModels', id),
  clearLlmProviderModelsCache: id => invokeIpc('llm:clearProviderModelsCache', id),
  restoreProviderFromInstance: id => invokeIpc('llm:restoreProviderFromInstance', id),
  createLlmInstance: payload => invokeIpc('llm:createInstance', payload),
  updateLlmInstance: payload => invokeIpc('llm:updateInstance', payload),
  deleteLlmInstance: id => invokeIpc('llm:deleteInstance', id),
  createChat: payload => invokeIpc('chat:create', payload),
  updateChat: payload => invokeIpc('chat:update', payload),
  deleteChat: id => invokeIpc('chat:delete', id),
  createChatBlock: payload => invokeIpc('chat:createBlock', payload),
  updateChatBlock: payload => invokeIpc('chat:updateBlock', payload),
  deleteChatBlock: id => invokeIpc('chat:deleteBlock', id),
  startChatGeneration: payload => invokeIpc('chat:startGeneration', payload),
  previewChatGeneration: payload => invokeIpc('chat:previewGeneration', payload),
  stopChatGeneration: chatId => invokeIpc('chat:stopGeneration', chatId),
  listPlugins: () => invokeIpc('plugin:list'),
  readPluginFile: (pluginId, path) => invokeIpc('plugin:readFile', pluginId, path),
  listPluginDataFiles: (pluginId, path = '') => invokeIpc('plugin:listDataFiles', pluginId, path),
  readPluginDataFile: (pluginId, path) => invokeIpc('plugin:readDataFile', pluginId, path),
  readPluginDataFileBase64: (pluginId, path) => invokeIpc('plugin:readDataFileBase64', pluginId, path),
  writePluginDataFile: (pluginId, path, content) => invokeIpc('plugin:writeDataFile', pluginId, path, content),
  writePluginDataFileBase64: (pluginId, path, content) => (
    invokeIpc('plugin:writeDataFileBase64', pluginId, path, content)
  ),
  deletePluginDataFile: (pluginId, path) => invokeIpc('plugin:deleteDataFile', pluginId, path),
  pluginAssetUrl: (pluginId, path) => {
    const cleanPath = path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '')
    const encodedPath = cleanPath.split('/')
      .filter(part => part && part !== '.')
      .map(part => encodeURIComponent(part))
      .join('/')
    return `ha-ext://${encodeURIComponent(pluginId)}/${encodedPath}`
  },
  onPluginToolCallRequest: callback => onIpcEvent('plugin:toolCallRequest', callback),
  resolvePluginToolCall: response => invokeIpc('plugin:toolCallResponse', response),
  onChatGenerationEvent: callback => onIpcEvent('chat:generationEvent', callback),
  getAppVersion: () => invokeIpc('app:getVersion'),
  getAppName: () => invokeIpc('app:getName'),
  quit: () => invokeIpc('app:quit')
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

declare global {
  interface Window {
    electronAPI: ElectronApi
  }
}
