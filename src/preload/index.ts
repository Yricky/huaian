import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  DbChatBlock,
  ChatCreatePayload,
  DbChatBlockCreatePayload,
  DbChatBlockUpdatePayload,
  ChatGenerationEvent,
  ChatGenerationPreviewMessage,
  ChatGenerationRequest,
  ChatGenerationStartResult,
  ChatSession,
  ChatUpdatePayload,
  IpcJsonPayload,
  LlmInstance,
  LlmInstanceCreatePayload,
  LlmInstanceUpdatePayload,
  LlmProvider,
  LlmProviderCreatePayload,
  LlmProviderUpdatePayload,
  PluginDescriptor,
  PluginFileEntry,
  PluginToolCallRequest,
  PluginToolCallResponse,
  ProjectConfig,
  ProjectConfigUpdatePayload,
  ProjectSnapshot,
  RecentProject
} from '../shared/types'

const electronAPI = {
  getProject: (): Promise<ProjectSnapshot> => ipcRenderer.invoke('project:get'),
  listRecentProjects: (): Promise<RecentProject[]> => ipcRenderer.invoke('project:listRecent'),
  updateProjectConfig: (payload: IpcJsonPayload<ProjectConfigUpdatePayload>): Promise<ProjectConfig> =>
    ipcRenderer.invoke('project:updateConfig', payload),
  openProject: (): Promise<ProjectSnapshot | null> => ipcRenderer.invoke('project:open'),
  openProjectPath: (path: string): Promise<ProjectSnapshot> => ipcRenderer.invoke('project:openPath', path),
  createLlmProvider: (payload: IpcJsonPayload<LlmProviderCreatePayload>): Promise<LlmProvider> =>
    ipcRenderer.invoke('llm:createProvider', payload),
  updateLlmProvider: (payload: IpcJsonPayload<LlmProviderUpdatePayload>): Promise<LlmProvider> =>
    ipcRenderer.invoke('llm:updateProvider', payload),
  deleteLlmProvider: (id: number): Promise<ProjectSnapshot> => ipcRenderer.invoke('llm:deleteProvider', id),
  fetchLlmProviderModels: (id: number): Promise<LlmProvider> => ipcRenderer.invoke('llm:fetchProviderModels', id),
  clearLlmProviderModelsCache: (id: number): Promise<LlmProvider> =>
    ipcRenderer.invoke('llm:clearProviderModelsCache', id),
  restoreLlmProviderFromInstance: (id: number): Promise<LlmProvider> =>
    ipcRenderer.invoke('llm:restoreProviderFromInstance', id),
  createLlmInstance: (payload: IpcJsonPayload<LlmInstanceCreatePayload>): Promise<LlmInstance> =>
    ipcRenderer.invoke('llm:createInstance', payload),
  updateLlmInstance: (payload: IpcJsonPayload<LlmInstanceUpdatePayload>): Promise<LlmInstance> =>
    ipcRenderer.invoke('llm:updateInstance', payload),
  deleteLlmInstance: (id: number): Promise<ProjectSnapshot> => ipcRenderer.invoke('llm:deleteInstance', id),
  createChat: (payload?: IpcJsonPayload<ChatCreatePayload>): Promise<ChatSession> => ipcRenderer.invoke('chat:create', payload),
  updateChat: (payload: IpcJsonPayload<ChatUpdatePayload>): Promise<ChatSession> =>
    ipcRenderer.invoke('chat:update', payload),
  deleteChat: (id: number): Promise<ProjectSnapshot> => ipcRenderer.invoke('chat:delete', id),
  createChatBlock: (payload: IpcJsonPayload<DbChatBlockCreatePayload>): Promise<DbChatBlock> =>
    ipcRenderer.invoke('chat:createBlock', payload),
  updateChatBlock: (payload: IpcJsonPayload<DbChatBlockUpdatePayload>): Promise<DbChatBlock> =>
    ipcRenderer.invoke('chat:updateBlock', payload),
  deleteChatBlock: (id: number): Promise<ProjectSnapshot> => ipcRenderer.invoke('chat:deleteBlock', id),
  startChatGeneration: (payload: IpcJsonPayload<ChatGenerationRequest>): Promise<ChatGenerationStartResult> =>
    ipcRenderer.invoke('chat:startGeneration', payload),
  previewChatGeneration: (payload: IpcJsonPayload<ChatGenerationRequest>): Promise<ChatGenerationPreviewMessage[]> =>
    ipcRenderer.invoke('chat:previewGeneration', payload),
  stopChatGeneration: (chatId: number): Promise<boolean> => ipcRenderer.invoke('chat:stopGeneration', chatId),
  listPlugins: (): Promise<PluginDescriptor[]> => ipcRenderer.invoke('plugin:list'),
  readPluginFile: (pluginId: string, path: string): Promise<string> => ipcRenderer.invoke('plugin:readFile', pluginId, path),
  listPluginDataFiles: (pluginId: string, path = ''): Promise<PluginFileEntry[]> =>
    ipcRenderer.invoke('plugin:listDataFiles', pluginId, path),
  readPluginDataFile: (pluginId: string, path: string): Promise<string> =>
    ipcRenderer.invoke('plugin:readDataFile', pluginId, path),
  readPluginDataFileBase64: (pluginId: string, path: string): Promise<string> =>
    ipcRenderer.invoke('plugin:readDataFileBase64', pluginId, path),
  writePluginDataFile: (pluginId: string, path: string, content: string): Promise<void> =>
    ipcRenderer.invoke('plugin:writeDataFile', pluginId, path, content),
  writePluginDataFileBase64: (pluginId: string, path: string, content: string): Promise<void> =>
    ipcRenderer.invoke('plugin:writeDataFileBase64', pluginId, path, content),
  deletePluginDataFile: (pluginId: string, path: string): Promise<void> =>
    ipcRenderer.invoke('plugin:deleteDataFile', pluginId, path),
  pluginAssetUrl: (pluginId: string, path: string): string => {
    const cleanPath = path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '')
    const encodedPath = cleanPath.split('/')
      .filter(part => part && part !== '.')
      .map(part => encodeURIComponent(part))
      .join('/')
    return `huaianext://${encodeURIComponent(pluginId)}/${encodedPath}`
  },
  onPluginToolCallRequest: (callback: (request: PluginToolCallRequest) => void): (() => void) => {
    const listener = (_: IpcRendererEvent, request: PluginToolCallRequest) => callback(request)
    ipcRenderer.on('plugin:toolCallRequest', listener)
    return () => ipcRenderer.removeListener('plugin:toolCallRequest', listener)
  },
  resolvePluginToolCall: (response: IpcJsonPayload<PluginToolCallResponse>): Promise<void> =>
    ipcRenderer.invoke('plugin:toolCallResponse', response),
  onChatGenerationEvent: (callback: (event: ChatGenerationEvent) => void): (() => void) => {
    const listener = (_: IpcRendererEvent, event: ChatGenerationEvent) => callback(event)
    ipcRenderer.on('chat:generationEvent', listener)
    return () => ipcRenderer.removeListener('chat:generationEvent', listener)
  },
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  getAppName: (): Promise<string> => ipcRenderer.invoke('app:getName'),
  quit: (): Promise<void> => ipcRenderer.invoke('app:quit')
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

declare global {
  interface Window {
    electronAPI: typeof electronAPI
  }
}
