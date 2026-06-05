import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  AppLlmGenerationEvent,
  AppToolCallRequest,
  ElectronApi,
  IpcInvokeChannel,
  IpcRendererEventChannel
} from '../shared/types'

function invokeIpc<TResult>(channel: IpcInvokeChannel, ...args: unknown[]): Promise<TResult> {
  return ipcRenderer.invoke(channel, ...args) as Promise<TResult>
}

function onIpcEvent(channel: 'haAppChat:toolCallRequest', callback: (event: AppToolCallRequest) => void): () => void
function onIpcEvent(channel: 'haAppChat:generationEvent', callback: (event: AppLlmGenerationEvent) => void): () => void
function onIpcEvent(
  channel: IpcRendererEventChannel,
  callback: ((event: AppToolCallRequest) => void) | ((event: AppLlmGenerationEvent) => void)
): () => void {
  const listener = (_: IpcRendererEvent, event: AppToolCallRequest | AppLlmGenerationEvent) => (
    (callback as (event: AppToolCallRequest | AppLlmGenerationEvent) => void)(event)
  )
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

function cleanAssetPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '')
    .split('/')
    .filter(part => part && part !== '.')
    .map(part => encodeURIComponent(part))
    .join('/')
}

function appIdHost(appId: string): string {
  return [...appId]
    .map(char => char.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
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
  createLlmInstance: payload => invokeIpc('llm:createInstance', payload),
  updateLlmInstance: payload => invokeIpc('llm:updateInstance', payload),
  deleteLlmInstance: id => invokeIpc('llm:deleteInstance', id),
  reorderLlmInstances: ids => invokeIpc('llm:reorderInstances', ids),
  installApp: () => invokeIpc('haApp:install'),
  uninstallApp: (appId, options) => invokeIpc('haApp:uninstall', appId, options),
  createAppSession: payload => invokeIpc('haApp:createSession', payload),
  updateAppSession: payload => invokeIpc('haApp:updateSession', payload),
  deleteAppSession: (appId, id) => invokeIpc('haApp:deleteSession', appId, id),
  touchAppSession: (appId, id) => invokeIpc('haApp:touchSession', appId, id),
  listAppStorage: (kind, appId, appSessionId, path = '') => invokeIpc('haApp:listStorage', kind, appId, appSessionId, path),
  makeAppStorageDirectory: (kind, appId, appSessionId, path) => (
    invokeIpc('haApp:makeStorageDirectory', kind, appId, appSessionId, path)
  ),
  readAppStorageFile: (kind, appId, appSessionId, path) => (
    invokeIpc('haApp:readStorageFile', kind, appId, appSessionId, path)
  ),
  readAppStorageFileBytes: (kind, appId, appSessionId, path) => (
    invokeIpc('haApp:readStorageFileBytes', kind, appId, appSessionId, path)
  ),
  writeAppStorageFile: (kind, appId, appSessionId, path, content) => (
    invokeIpc('haApp:writeStorageFile', kind, appId, appSessionId, path, content)
  ),
  writeAppStorageFileBytes: (kind, appId, appSessionId, path, content) => (
    invokeIpc('haApp:writeStorageFileBytes', kind, appId, appSessionId, path, content)
  ),
  deleteAppStoragePath: (kind, appId, appSessionId, path, options) => (
    invokeIpc('haApp:deleteStoragePath', kind, appId, appSessionId, path, options)
  ),
  appAssetUrl: (appId, path) => `ha-app://${appIdHost(appId)}/${cleanAssetPath(path || 'index.html')}`,
  startAppChatGeneration: payload => invokeIpc('haAppChat:startGeneration', payload),
  stopAppChatGeneration: (appId, appSessionId, chatSessionId) => (
    invokeIpc('haAppChat:stopGeneration', appId, appSessionId, chatSessionId)
  ),
  resolveAppToolCall: response => invokeIpc('haAppChat:toolCallResponse', response),
  onAppChatGenerationEvent: callback => onIpcEvent('haAppChat:generationEvent', callback),
  onAppToolCallRequest: callback => onIpcEvent('haAppChat:toolCallRequest', callback),
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
