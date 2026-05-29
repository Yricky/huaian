import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  ChatBlock,
  ChatBlockCreatePayload,
  ChatBlockUpdatePayload,
  ChatGenerationEvent,
  ChatGenerationRequest,
  ChatGenerationStartResult,
  ChatSession,
  ChatUpdatePayload,
  CharacterEntry,
  CharacterUpdatePayload,
  ExportResult,
  IpcJsonPayload,
  LlmInstance,
  LlmInstanceCreatePayload,
  LlmInstanceUpdatePayload,
  LlmProvider,
  LlmProviderCreatePayload,
  LlmProviderUpdatePayload,
  ProjectSnapshot,
  WorldBook,
  WorldBookUpdatePayload,
  WorldEntry,
  WorldEntryOrderPayload,
  WorldEntryUpdatePayload
} from '../shared/types'

const electronAPI = {
  getProject: (): Promise<ProjectSnapshot | null> => ipcRenderer.invoke('project:get'),
  openProject: (): Promise<ProjectSnapshot | null> => ipcRenderer.invoke('project:open'),
  createCharacter: (): Promise<CharacterEntry> => ipcRenderer.invoke('project:createCharacter'),
  updateCharacter: (payload: IpcJsonPayload<CharacterUpdatePayload>): Promise<CharacterEntry> =>
    ipcRenderer.invoke('project:updateCharacter', payload),
  deleteCharacter: (id: number): Promise<ProjectSnapshot> => ipcRenderer.invoke('project:deleteCharacter', id),
  createWorldEntry: (worldBookId: number): Promise<WorldEntry> => ipcRenderer.invoke('project:createWorldEntry', worldBookId),
  updateWorldEntry: (payload: IpcJsonPayload<WorldEntryUpdatePayload>): Promise<WorldEntry> =>
    ipcRenderer.invoke('project:updateWorldEntry', payload),
  deleteWorldEntry: (id: number): Promise<ProjectSnapshot> => ipcRenderer.invoke('project:deleteWorldEntry', id),
  reorderWorldEntries: (payload: IpcJsonPayload<WorldEntryOrderPayload>): Promise<ProjectSnapshot> =>
    ipcRenderer.invoke('project:reorderWorldEntries', payload),
  createWorldBook: (): Promise<WorldBook> => ipcRenderer.invoke('project:createWorldBook'),
  updateWorldBook: (payload: IpcJsonPayload<WorldBookUpdatePayload>): Promise<WorldBook> =>
    ipcRenderer.invoke('project:updateWorldBook', payload),
  deleteWorldBook: (id: number): Promise<ProjectSnapshot> => ipcRenderer.invoke('project:deleteWorldBook', id),
  exportCharacter: (id: number): Promise<ExportResult> => ipcRenderer.invoke('project:exportCharacter', id),
  exportWorldBook: (id: number): Promise<ExportResult> => ipcRenderer.invoke('project:exportWorldBook', id),
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
  createChat: (): Promise<ChatSession> => ipcRenderer.invoke('chat:create'),
  updateChat: (payload: IpcJsonPayload<ChatUpdatePayload>): Promise<ChatSession> =>
    ipcRenderer.invoke('chat:update', payload),
  deleteChat: (id: number): Promise<ProjectSnapshot> => ipcRenderer.invoke('chat:delete', id),
  createChatBlock: (payload: IpcJsonPayload<ChatBlockCreatePayload>): Promise<ChatBlock> =>
    ipcRenderer.invoke('chat:createBlock', payload),
  updateChatBlock: (payload: IpcJsonPayload<ChatBlockUpdatePayload>): Promise<ChatBlock> =>
    ipcRenderer.invoke('chat:updateBlock', payload),
  deleteChatBlock: (id: number): Promise<ProjectSnapshot> => ipcRenderer.invoke('chat:deleteBlock', id),
  startChatGeneration: (payload: IpcJsonPayload<ChatGenerationRequest>): Promise<ChatGenerationStartResult> =>
    ipcRenderer.invoke('chat:startGeneration', payload),
  stopChatGeneration: (chatId: number): Promise<boolean> => ipcRenderer.invoke('chat:stopGeneration', chatId),
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
