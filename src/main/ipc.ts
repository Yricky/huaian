import { app, dialog, ipcMain } from 'electron'
import type {
  ChatCreatePayload,
  ChatBlockCreatePayload,
  ChatBlockUpdatePayload,
  ChatGenerationRequest,
  ChatUpdatePayload,
  IpcJsonPayload,
  LlmInstanceCreatePayload,
  LlmInstanceUpdatePayload,
  LlmProviderCreatePayload,
  LlmProviderUpdatePayload,
  PluginToolCallResponse,
  ProjectConfigUpdatePayload
} from '../shared/types'
import { hasActiveGeneration, previewChatGeneration, resolvePluginToolCall, startChatGeneration, stopChatGeneration } from './project/llm-runtime'
import { fetchProviderModels } from './project/llm-provider'
import { hasProject } from './project/state'
import {
  listPluginDataFiles,
  listProjectPlugins,
  readPluginDataFile,
  readPluginFile,
  writePluginDataFile
} from './project/plugins'
import {
  clearLlmProviderModelsCache,
  createChat,
  createChatBlock,
  createLlmInstance,
  createLlmProvider,
  deleteChat,
  deleteChatBlock,
  deleteLlmInstance,
  deleteLlmProvider,
  forgetRecentProject,
  getChatBlock,
  getProjectSnapshot,
  listRecentProjects,
  openDefaultProject,
  openProjectAt,
  restoreLlmProviderFromInstance,
  updateChat,
  updateChatBlock,
  updateProjectConfig,
  updateLlmInstance,
  updateLlmProvider
} from './project/store'

function parseIpcPayload<T>(payload: IpcJsonPayload<T>): T {
  return typeof payload === 'string' ? JSON.parse(payload) : payload
}

function ensureCanSwitchProject(): void {
  if (hasActiveGeneration()) {
    throw new Error('有聊天正在生成，请先停止生成后再切换项目。')
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle('project:get', async () => hasProject() ? getProjectSnapshot() : openDefaultProject())
  ipcMain.handle('project:listRecent', () => listRecentProjects())
  ipcMain.handle('project:updateConfig', (_, payload: IpcJsonPayload<ProjectConfigUpdatePayload>) => (
    updateProjectConfig(parseIpcPayload(payload))
  ))
  ipcMain.handle('project:open', async () => {
    ensureCanSwitchProject()
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return hasProject() ? getProjectSnapshot() : openDefaultProject()
    return openProjectAt(result.filePaths[0])
  })
  ipcMain.handle('project:openPath', async (_, projectPath: string) => {
    ensureCanSwitchProject()
    try {
      return await openProjectAt(projectPath)
    } catch (error) {
      await forgetRecentProject(projectPath)
      throw error
    }
  })

  ipcMain.handle('llm:createProvider', (_, payload: IpcJsonPayload<LlmProviderCreatePayload>) => (
    createLlmProvider(parseIpcPayload(payload))
  ))
  ipcMain.handle('llm:updateProvider', (_, payload: IpcJsonPayload<LlmProviderUpdatePayload>) => (
    updateLlmProvider(parseIpcPayload(payload))
  ))
  ipcMain.handle('llm:deleteProvider', (_, id: number) => deleteLlmProvider(id))
  ipcMain.handle('llm:fetchProviderModels', (_, id: number) => fetchProviderModels(id))
  ipcMain.handle('llm:clearProviderModelsCache', (_, id: number) => clearLlmProviderModelsCache(id))
  ipcMain.handle('llm:restoreProviderFromInstance', (_, id: number) => restoreLlmProviderFromInstance(id))

  ipcMain.handle('llm:createInstance', (_, payload: IpcJsonPayload<LlmInstanceCreatePayload>) => (
    createLlmInstance(parseIpcPayload(payload))
  ))
  ipcMain.handle('llm:updateInstance', (_, payload: IpcJsonPayload<LlmInstanceUpdatePayload>) => (
    updateLlmInstance(parseIpcPayload(payload))
  ))
  ipcMain.handle('llm:deleteInstance', (_, id: number) => deleteLlmInstance(id))

  ipcMain.handle('chat:create', (_, payload?: IpcJsonPayload<ChatCreatePayload>) => (
    createChat(payload ? parseIpcPayload(payload) : {})
  ))
  ipcMain.handle('chat:update', (_, payload: IpcJsonPayload<ChatUpdatePayload>) => (
    updateChat(parseIpcPayload(payload))
  ))
  ipcMain.handle('chat:delete', (_, id: number) => {
    if (hasActiveGeneration(id)) {
      throw new Error('这个聊天正在生成，请先停止生成。')
    }
    return deleteChat(id)
  })
  ipcMain.handle('chat:createBlock', (_, payload: IpcJsonPayload<ChatBlockCreatePayload>) => {
    const parsed = parseIpcPayload(payload)
    if (hasActiveGeneration(parsed.chatId)) {
      throw new Error('当前聊天正在生成，请等待结束或停止后再添加聊天块。')
    }
    return createChatBlock(parsed)
  })
  ipcMain.handle('chat:updateBlock', (_, payload: IpcJsonPayload<ChatBlockUpdatePayload>) => {
    const parsed = parseIpcPayload(payload)
    const block = getChatBlock(parsed.id)
    if (hasActiveGeneration(block.chatId)) {
      throw new Error('当前聊天正在生成，请等待结束或停止后再编辑聊天块。')
    }
    return updateChatBlock(parsed)
  })
  ipcMain.handle('chat:deleteBlock', (_, id: number) => {
    const block = getChatBlock(id)
    if (hasActiveGeneration(block.chatId)) {
      throw new Error('当前聊天正在生成，请等待结束或停止后再编辑聊天块。')
    }
    return deleteChatBlock(id)
  })
  ipcMain.handle('chat:startGeneration', (event, payload: IpcJsonPayload<ChatGenerationRequest>) => (
    startChatGeneration(parseIpcPayload(payload), event.sender)
  ))
  ipcMain.handle('chat:previewGeneration', (_, payload: IpcJsonPayload<ChatGenerationRequest>) => (
    previewChatGeneration(parseIpcPayload(payload))
  ))
  ipcMain.handle('chat:stopGeneration', (_, chatId: number) => stopChatGeneration(chatId))

  ipcMain.handle('plugin:list', () => listProjectPlugins())
  ipcMain.handle('plugin:readFile', (_, pluginId: string, path: string) => readPluginFile(pluginId, path))
  ipcMain.handle('plugin:listDataFiles', (_, pluginId: string, path = '') => listPluginDataFiles(pluginId, path))
  ipcMain.handle('plugin:readDataFile', (_, pluginId: string, path: string) => readPluginDataFile(pluginId, path))
  ipcMain.handle('plugin:writeDataFile', (_, pluginId: string, path: string, content: string) => (
    writePluginDataFile(pluginId, path, content)
  ))
  ipcMain.handle('plugin:toolCallResponse', (_, payload: IpcJsonPayload<PluginToolCallResponse>) => (
    resolvePluginToolCall(parseIpcPayload(payload))
  ))

  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:getName', () => app.getName())
  ipcMain.handle('app:quit', () => app.quit())
}
