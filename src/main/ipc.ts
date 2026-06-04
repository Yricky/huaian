import { app, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import type {
  AppLlmGenerationRequest,
  AppSessionCreatePayload,
  AppSessionUpdatePayload,
  AppStorageDeleteOptions,
  AppStorageKind,
  AppToolCallResponse,
  AppUninstallOptions,
  IpcInvokeChannel,
  LlmInstanceCreatePayload,
  LlmInstanceUpdatePayload,
  LlmProviderCreatePayload,
  LlmProviderUpdatePayload,
  ProjectConfigUpdatePayload
} from '../shared/types'
import {
  hasActiveGeneration,
  resolveAppToolCall,
  startAppChatGeneration,
  stopAppChatGeneration
} from './project/llm-runtime'
import { fetchProviderModels } from './project/llm-provider'
import { hasProject } from './project/state'
import {
  deleteAppStoragePath,
  installAppZip,
  listAppStorageFiles,
  makeAppStorageDirectory,
  readAppStorageFile,
  readAppStorageFileBytes,
  uninstallApp,
  writeAppStorageFile,
  writeAppStorageFileBytes
} from './project/apps'
import {
  clearLlmProviderModelsCache,
  createAppSession,
  createLlmInstance,
  createLlmProvider,
  deleteAppSession,
  deleteAppSessionsForApp,
  deleteLlmInstance,
  deleteLlmProvider,
  forgetRecentProject,
  getProjectSnapshot,
  listRecentProjects,
  openDefaultProject,
  openProjectAt,
  restoreLlmProviderFromInstance,
  touchAppSession,
  updateAppSession,
  updateProjectConfig,
  updateLlmInstance,
  updateLlmProvider
} from './project/store'

function ensureCanSwitchProject(): void {
  if (hasActiveGeneration()) {
    throw new Error('有应用正在生成回复，请先停止生成后再切换项目。')
  }
}

function handleIpc<TArgs extends unknown[], TResult>(
  channel: IpcInvokeChannel,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>
): void {
  ipcMain.handle(channel, handler as Parameters<typeof ipcMain.handle>[1])
}

export function registerIpcHandlers(): void {
  handleIpc('project:get', async () => hasProject() ? getProjectSnapshot() : await openDefaultProject())
  handleIpc('project:listRecent', () => listRecentProjects())
  handleIpc('project:updateConfig', (_, payload: ProjectConfigUpdatePayload) => updateProjectConfig(payload))
  handleIpc('project:open', async () => {
    ensureCanSwitchProject()
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) {
      return hasProject() ? getProjectSnapshot() : await openDefaultProject()
    }
    return openProjectAt(result.filePaths[0])
  })
  handleIpc('project:openPath', async (_, projectPath: string) => {
    ensureCanSwitchProject()
    try {
      return await openProjectAt(projectPath)
    } catch (error) {
      await forgetRecentProject(projectPath)
      throw error
    }
  })

  handleIpc('llm:createProvider', (_, payload: LlmProviderCreatePayload) => createLlmProvider(payload))
  handleIpc('llm:updateProvider', (_, payload: LlmProviderUpdatePayload) => updateLlmProvider(payload))
  handleIpc('llm:deleteProvider', (_, id: number) => deleteLlmProvider(id))
  handleIpc('llm:fetchProviderModels', (_, id: number) => fetchProviderModels(id))
  handleIpc('llm:clearProviderModelsCache', (_, id: number) => clearLlmProviderModelsCache(id))
  handleIpc('llm:restoreProviderFromInstance', (_, id: number) => restoreLlmProviderFromInstance(id))

  handleIpc('llm:createInstance', (_, payload: LlmInstanceCreatePayload) => createLlmInstance(payload))
  handleIpc('llm:updateInstance', (_, payload: LlmInstanceUpdatePayload) => updateLlmInstance(payload))
  handleIpc('llm:deleteInstance', (_, id: number) => deleteLlmInstance(id))

  handleIpc('haApp:install', async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Huaian App', extensions: ['zip'] }],
      properties: ['openFile']
    })
    if (!result.filePaths[0] || result.canceled) return getProjectSnapshot()
    await installAppZip(result.filePaths[0])
    return getProjectSnapshot()
  })
  handleIpc('haApp:uninstall', async (_, appId: string, options: AppUninstallOptions) => {
    await uninstallApp(appId, options)
    if (options.deleteAllSaves) await deleteAppSessionsForApp(appId)
    return getProjectSnapshot()
  })
  handleIpc('haApp:createSession', (_, payload: AppSessionCreatePayload) => createAppSession(payload))
  handleIpc('haApp:updateSession', (_, payload: AppSessionUpdatePayload) => updateAppSession(payload))
  handleIpc('haApp:deleteSession', (_, appId: string, id: number) => deleteAppSession(appId, id))
  handleIpc('haApp:touchSession', (_, appId: string, id: number) => touchAppSession(appId, id))
  handleIpc('haApp:listStorage', (_, kind: AppStorageKind, appId: string, appSessionId: number | null, path: string | undefined = '') => (
    listAppStorageFiles(kind, appId, appSessionId, path)
  ))
  handleIpc('haApp:makeStorageDirectory', (_, kind: AppStorageKind, appId: string, appSessionId: number | null, path: string) => (
    makeAppStorageDirectory(kind, appId, appSessionId, path)
  ))
  handleIpc('haApp:readStorageFile', (_, kind: AppStorageKind, appId: string, appSessionId: number | null, path: string) => (
    readAppStorageFile(kind, appId, appSessionId, path)
  ))
  handleIpc('haApp:readStorageFileBytes', (_, kind: AppStorageKind, appId: string, appSessionId: number | null, path: string) => (
    readAppStorageFileBytes(kind, appId, appSessionId, path)
  ))
  handleIpc('haApp:writeStorageFile', (_, kind: AppStorageKind, appId: string, appSessionId: number | null, path: string, content: string) => (
    writeAppStorageFile(kind, appId, appSessionId, path, content)
  ))
  handleIpc('haApp:writeStorageFileBytes', (_, kind: AppStorageKind, appId: string, appSessionId: number | null, path: string, content: Uint8Array) => (
    writeAppStorageFileBytes(kind, appId, appSessionId, path, content)
  ))
  handleIpc('haApp:deleteStoragePath', (_, kind: AppStorageKind, appId: string, appSessionId: number | null, path: string, options?: AppStorageDeleteOptions) => (
    deleteAppStoragePath(kind, appId, appSessionId, path, options)
  ))

  handleIpc('haAppChat:startGeneration', (event, payload: AppLlmGenerationRequest) => startAppChatGeneration(payload, event.sender))
  handleIpc('haAppChat:stopGeneration', (_, appId: string, appSessionId: number, chatSessionId?: number) => (
    stopAppChatGeneration(appId, appSessionId, chatSessionId)
  ))
  handleIpc('haAppChat:toolCallResponse', (_, payload: AppToolCallResponse) => resolveAppToolCall(payload))

  handleIpc('app:getVersion', () => app.getVersion())
  handleIpc('app:getName', () => app.getName())
  handleIpc('app:quit', () => app.quit())
}
