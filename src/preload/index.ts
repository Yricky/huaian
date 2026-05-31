import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  ChatBlock,
  ChatCreatePayload,
  ChatBlockCreatePayload,
  ChatBlockUpdatePayload,
  ChatGenerationEvent,
  ChatGenerationPreview,
  ChatGenerationRequest,
  ChatGenerationStartResult,
  ChatSession,
  ChatUpdatePayload,
  CharacterEntry,
  CharacterUpdatePayload,
  ExportResult,
  IpcJsonPayload,
  LoreBookDraftApplyPayload,
  LoreBookDraftSummary,
  LlmInstance,
  LlmInstanceCreatePayload,
  LlmInstanceUpdatePayload,
  LlmProvider,
  LlmProviderCreatePayload,
  LlmProviderUpdatePayload,
  ProjectImportResult,
  ProjectConfig,
  ProjectConfigUpdatePayload,
  PromptTemplateBlockRenderRequest,
  PromptTemplateBlockRenderResult,
  ProjectSnapshot,
  RecentProject,
  LoreBook,
  LoreBookUpdatePayload,
  WorldEntry,
  WorldEntryOrderPayload,
  WorldEntryUpdatePayload
} from '../shared/types'

const electronAPI = {
  getProject: (): Promise<ProjectSnapshot> => ipcRenderer.invoke('project:get'),
  listRecentProjects: (): Promise<RecentProject[]> => ipcRenderer.invoke('project:listRecent'),
  updateProjectConfig: (payload: IpcJsonPayload<ProjectConfigUpdatePayload>): Promise<ProjectConfig> =>
    ipcRenderer.invoke('project:updateConfig', payload),
  openProject: (): Promise<ProjectSnapshot | null> => ipcRenderer.invoke('project:open'),
  openProjectPath: (path: string): Promise<ProjectSnapshot> => ipcRenderer.invoke('project:openPath', path),
  createCharacter: (): Promise<CharacterEntry> => ipcRenderer.invoke('project:createCharacter'),
  updateCharacter: (payload: IpcJsonPayload<CharacterUpdatePayload>): Promise<CharacterEntry> =>
    ipcRenderer.invoke('project:updateCharacter', payload),
  deleteCharacter: (id: number): Promise<ProjectSnapshot> => ipcRenderer.invoke('project:deleteCharacter', id),
  createWorldEntry: (loreBookId: number): Promise<WorldEntry> => ipcRenderer.invoke('project:createWorldEntry', loreBookId),
  updateWorldEntry: (payload: IpcJsonPayload<WorldEntryUpdatePayload>): Promise<WorldEntry> =>
    ipcRenderer.invoke('project:updateWorldEntry', payload),
  deleteWorldEntry: (id: number): Promise<ProjectSnapshot> => ipcRenderer.invoke('project:deleteWorldEntry', id),
  reorderWorldEntries: (payload: IpcJsonPayload<WorldEntryOrderPayload>): Promise<ProjectSnapshot> =>
    ipcRenderer.invoke('project:reorderWorldEntries', payload),
  createLoreBook: (): Promise<LoreBook> => ipcRenderer.invoke('project:createLoreBook'),
  updateLoreBook: (payload: IpcJsonPayload<LoreBookUpdatePayload>): Promise<LoreBook> =>
    ipcRenderer.invoke('project:updateLoreBook', payload),
  deleteLoreBook: (id: number): Promise<ProjectSnapshot> => ipcRenderer.invoke('project:deleteLoreBook', id),
  exportCharacter: (id: number): Promise<ExportResult> => ipcRenderer.invoke('project:exportCharacter', id),
  exportLoreBook: (id: number): Promise<ExportResult> => ipcRenderer.invoke('project:exportLoreBook', id),
  importCharacters: (): Promise<ProjectImportResult | null> => ipcRenderer.invoke('project:importCharacters'),
  importLoreBooks: (): Promise<ProjectImportResult | null> => ipcRenderer.invoke('project:importLoreBooks'),
  listLoreBookDrafts: (): Promise<LoreBookDraftSummary[]> => ipcRenderer.invoke('project:listLoreBookDrafts'),
  applyLoreBookDraft: (payload: IpcJsonPayload<LoreBookDraftApplyPayload>): Promise<ProjectSnapshot> =>
    ipcRenderer.invoke('project:applyLoreBookDraft', payload),
  discardLoreBookDraft: (loreBookId: number): Promise<void> =>
    ipcRenderer.invoke('project:discardLoreBookDraft', loreBookId),
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
  createChatBlock: (payload: IpcJsonPayload<ChatBlockCreatePayload>): Promise<ChatBlock> =>
    ipcRenderer.invoke('chat:createBlock', payload),
  updateChatBlock: (payload: IpcJsonPayload<ChatBlockUpdatePayload>): Promise<ChatBlock> =>
    ipcRenderer.invoke('chat:updateBlock', payload),
  deleteChatBlock: (id: number): Promise<ProjectSnapshot> => ipcRenderer.invoke('chat:deleteBlock', id),
  startChatGeneration: (payload: IpcJsonPayload<ChatGenerationRequest>): Promise<ChatGenerationStartResult> =>
    ipcRenderer.invoke('chat:startGeneration', payload),
  previewChatGeneration: (payload: IpcJsonPayload<ChatGenerationRequest>): Promise<ChatGenerationPreview> =>
    ipcRenderer.invoke('chat:previewGeneration', payload),
  renderPromptTemplateBlock: (payload: IpcJsonPayload<PromptTemplateBlockRenderRequest>): Promise<PromptTemplateBlockRenderResult> =>
    ipcRenderer.invoke('chat:renderPromptTemplateBlock', payload),
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
