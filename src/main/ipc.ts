import { app, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import type {
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcInvokeResult
} from '../shared/types'
import { hasActiveGeneration, previewChatGeneration, resolvePluginToolCall, startChatGeneration, stopChatGeneration } from './project/llm-runtime'
import { fetchProviderModels } from './project/llm-provider'
import { hasProject } from './project/state'
import {
  deletePluginDataFile,
  listPluginDataFiles,
  listProjectPlugins,
  readPluginDataFileBase64,
  readPluginDataFile,
  readPluginFile,
  writePluginDataFileBase64,
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

function ensureCanSwitchProject(): void {
  if (hasActiveGeneration()) {
    throw new Error('有聊天正在生成，请先停止生成后再切换项目。')
  }
}

function handleIpc<T extends IpcInvokeChannel>(
  channel: T,
  handler: (event: IpcMainInvokeEvent, ...args: IpcInvokeArgs<T>) => IpcInvokeResult<T> | Promise<IpcInvokeResult<T>>
): void {
  ipcMain.handle(channel, handler as Parameters<typeof ipcMain.handle>[1])
}

export function registerIpcHandlers(): void {
  handleIpc('project:get', async () => hasProject() ? getProjectSnapshot() : openDefaultProject())
  handleIpc('project:listRecent', () => listRecentProjects())
  handleIpc('project:updateConfig', (_, payload) => updateProjectConfig(payload))
  handleIpc('project:open', async () => {
    ensureCanSwitchProject()
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return hasProject() ? getProjectSnapshot() : openDefaultProject()
    return openProjectAt(result.filePaths[0])
  })
  handleIpc('project:openPath', async (_, projectPath) => {
    ensureCanSwitchProject()
    try {
      return await openProjectAt(projectPath)
    } catch (error) {
      await forgetRecentProject(projectPath)
      throw error
    }
  })

  handleIpc('llm:createProvider', (_, payload) => createLlmProvider(payload))
  handleIpc('llm:updateProvider', (_, payload) => updateLlmProvider(payload))
  handleIpc('llm:deleteProvider', (_, id) => deleteLlmProvider(id))
  handleIpc('llm:fetchProviderModels', (_, id) => fetchProviderModels(id))
  handleIpc('llm:clearProviderModelsCache', (_, id) => clearLlmProviderModelsCache(id))
  handleIpc('llm:restoreProviderFromInstance', (_, id) => restoreLlmProviderFromInstance(id))

  handleIpc('llm:createInstance', (_, payload) => createLlmInstance(payload))
  handleIpc('llm:updateInstance', (_, payload) => updateLlmInstance(payload))
  handleIpc('llm:deleteInstance', (_, id) => deleteLlmInstance(id))

  handleIpc('chat:create', (_, payload) => createChat(payload ?? {}))
  handleIpc('chat:update', (_, payload) => updateChat(payload))
  handleIpc('chat:delete', (_, id) => {
    if (hasActiveGeneration(id)) {
      throw new Error('这个聊天正在生成，请先停止生成。')
    }
    return deleteChat(id)
  })
  handleIpc('chat:createBlock', (_, payload) => {
    if (hasActiveGeneration(payload.chatId)) {
      throw new Error('当前聊天正在生成，请等待结束或停止后再添加聊天块。')
    }
    return createChatBlock(payload)
  })
  handleIpc('chat:updateBlock', (_, payload) => {
    const block = getChatBlock(payload.id)
    if (hasActiveGeneration(block.chatId)) {
      throw new Error('当前聊天正在生成，请等待结束或停止后再编辑聊天块。')
    }
    return updateChatBlock(payload)
  })
  handleIpc('chat:deleteBlock', (_, id) => {
    const block = getChatBlock(id)
    if (hasActiveGeneration(block.chatId)) {
      throw new Error('当前聊天正在生成，请等待结束或停止后再编辑聊天块。')
    }
    return deleteChatBlock(id)
  })
  handleIpc('chat:startGeneration', (event, payload) => startChatGeneration(payload, event.sender))
  handleIpc('chat:previewGeneration', (_, payload) => previewChatGeneration(payload))
  handleIpc('chat:stopGeneration', (_, chatId) => stopChatGeneration(chatId))

  handleIpc('plugin:list', () => listProjectPlugins())
  handleIpc('plugin:readFile', (_, pluginId, path) => readPluginFile(pluginId, path))
  handleIpc('plugin:listDataFiles', (_, pluginId, path = '') => listPluginDataFiles(pluginId, path))
  handleIpc('plugin:readDataFile', (_, pluginId, path) => readPluginDataFile(pluginId, path))
  handleIpc('plugin:readDataFileBase64', (_, pluginId, path) => readPluginDataFileBase64(pluginId, path))
  handleIpc('plugin:writeDataFile', (_, pluginId, path, content) => (
    writePluginDataFile(pluginId, path, content)
  ))
  handleIpc('plugin:writeDataFileBase64', (_, pluginId, path, content) => (
    writePluginDataFileBase64(pluginId, path, content)
  ))
  handleIpc('plugin:deleteDataFile', (_, pluginId, path) => deletePluginDataFile(pluginId, path))
  handleIpc('plugin:toolCallResponse', (_, payload) => resolvePluginToolCall(payload))

  handleIpc('app:getVersion', () => app.getVersion())
  handleIpc('app:getName', () => app.getName())
  handleIpc('app:quit', () => app.quit())
}
