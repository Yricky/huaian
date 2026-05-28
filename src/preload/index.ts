import { contextBridge, ipcRenderer } from 'electron'
import type {
  CharacterEntry,
  CharacterUpdatePayload,
  ExportResult,
  IpcJsonPayload,
  ProjectConfig,
  ProjectSnapshot,
  WorldBookExportConfig,
  WorldEntry,
  WorldEntryUpdatePayload
} from '../shared/types'

const electronAPI = {
  getProject: (): Promise<ProjectSnapshot | null> => ipcRenderer.invoke('project:get'),
  openProject: (): Promise<ProjectSnapshot | null> => ipcRenderer.invoke('project:open'),
  createCharacter: (): Promise<CharacterEntry> => ipcRenderer.invoke('project:createCharacter'),
  updateCharacter: (payload: IpcJsonPayload<CharacterUpdatePayload>): Promise<CharacterEntry> =>
    ipcRenderer.invoke('project:updateCharacter', payload),
  deleteCharacter: (id: number): Promise<ProjectSnapshot> => ipcRenderer.invoke('project:deleteCharacter', id),
  createWorldEntry: (): Promise<WorldEntry> => ipcRenderer.invoke('project:createWorldEntry'),
  updateWorldEntry: (payload: IpcJsonPayload<WorldEntryUpdatePayload>): Promise<WorldEntry> =>
    ipcRenderer.invoke('project:updateWorldEntry', payload),
  deleteWorldEntry: (id: number): Promise<ProjectSnapshot> => ipcRenderer.invoke('project:deleteWorldEntry', id),
  createWorldBookExport: (): Promise<ProjectConfig> => ipcRenderer.invoke('project:createWorldBookExport'),
  updateWorldBookExport: (payload: IpcJsonPayload<WorldBookExportConfig>): Promise<ProjectConfig> =>
    ipcRenderer.invoke('project:updateWorldBookExport', payload),
  deleteWorldBookExport: (id: string): Promise<ProjectConfig> => ipcRenderer.invoke('project:deleteWorldBookExport', id),
  exportCharacter: (id: number): Promise<ExportResult> => ipcRenderer.invoke('project:exportCharacter', id),
  exportWorldBook: (id: string): Promise<ExportResult> => ipcRenderer.invoke('project:exportWorldBook', id),
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
