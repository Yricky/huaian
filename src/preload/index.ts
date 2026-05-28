import { contextBridge, ipcRenderer } from 'electron'
import type {
  CharacterEntry,
  CharacterUpdatePayload,
  ExportResult,
  IpcJsonPayload,
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
