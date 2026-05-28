import { app, dialog, ipcMain } from 'electron'
import type {
  CharacterUpdatePayload,
  IpcJsonPayload,
  WorldBookExportConfig,
  WorldEntryUpdatePayload
} from '../shared/types'
import { exportCharacter, exportWorldBook } from './project/exporters'
import { hasProject } from './project/state'
import {
  createCharacter,
  createWorldBookExport,
  createWorldEntry,
  deleteCharacter,
  deleteWorldBookExport,
  deleteWorldEntry,
  getProjectSnapshot,
  openProjectAt,
  updateCharacter,
  updateWorldBookExport,
  updateWorldEntry
} from './project/store'

function parseIpcPayload<T>(payload: IpcJsonPayload<T>): T {
  return typeof payload === 'string' ? JSON.parse(payload) : payload
}

export function registerIpcHandlers(): void {
  ipcMain.handle('project:get', async () => hasProject() ? getProjectSnapshot() : null)
  ipcMain.handle('project:open', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return hasProject() ? getProjectSnapshot() : null
    return openProjectAt(result.filePaths[0])
  })

  ipcMain.handle('project:createCharacter', () => createCharacter())
  ipcMain.handle('project:updateCharacter', (_, payload: IpcJsonPayload<CharacterUpdatePayload>) => (
    updateCharacter(parseIpcPayload(payload))
  ))
  ipcMain.handle('project:deleteCharacter', (_, id: number) => deleteCharacter(id))

  ipcMain.handle('project:createWorldEntry', () => createWorldEntry())
  ipcMain.handle('project:updateWorldEntry', (_, payload: IpcJsonPayload<WorldEntryUpdatePayload>) => (
    updateWorldEntry(parseIpcPayload(payload))
  ))
  ipcMain.handle('project:deleteWorldEntry', (_, id: number) => deleteWorldEntry(id))

  ipcMain.handle('project:createWorldBookExport', () => createWorldBookExport())
  ipcMain.handle('project:updateWorldBookExport', (_, payload: IpcJsonPayload<WorldBookExportConfig>) => (
    updateWorldBookExport(parseIpcPayload(payload))
  ))
  ipcMain.handle('project:deleteWorldBookExport', (_, id: string) => deleteWorldBookExport(id))

  ipcMain.handle('project:exportCharacter', (_, id: number) => exportCharacter(id))
  ipcMain.handle('project:exportWorldBook', (_, id: string) => exportWorldBook(id))

  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:getName', () => app.getName())
  ipcMain.handle('app:quit', () => app.quit())
}
