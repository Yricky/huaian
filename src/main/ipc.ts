import { app, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import type {
  ChatCreatePayload,
  ChatGenerationRequest,
  ChatUpdatePayload,
  DbChatBlockCreatePayload,
  DbChatBlockUpdatePayload,
  IpcInvokeChannel,
  LlmInstanceCreatePayload,
  LlmInstanceUpdatePayload,
  LlmProviderCreatePayload,
  LlmProviderUpdatePayload,
  PluginToolCallResponse,
  ProjectConfigUpdatePayload
} from '../shared/types'
import {
  hasActiveGeneration,
  previewChatGeneration,
  resolvePluginToolCall,
  startChatGeneration,
  stopChatGeneration,
  withActiveGenerationSnapshot
} from './project/llm-runtime'
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

function handleIpc<TArgs extends unknown[], TResult>(
  channel: IpcInvokeChannel,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>
): void {
  ipcMain.handle(channel, handler as Parameters<typeof ipcMain.handle>[1])
}

export function registerIpcHandlers(): void {
  handleIpc('project:get', async () => withActiveGenerationSnapshot(hasProject() ? getProjectSnapshot() : await openDefaultProject()))
  handleIpc('project:listRecent', () => listRecentProjects())
  handleIpc('project:updateConfig', (_, payload: ProjectConfigUpdatePayload) => updateProjectConfig(payload))
  handleIpc('project:open', async () => {
    ensureCanSwitchProject()
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) {
      return withActiveGenerationSnapshot(hasProject() ? getProjectSnapshot() : await openDefaultProject())
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
  handleIpc('llm:deleteProvider', async (_, id: number) => withActiveGenerationSnapshot(await deleteLlmProvider(id)))
  handleIpc('llm:fetchProviderModels', (_, id: number) => fetchProviderModels(id))
  handleIpc('llm:clearProviderModelsCache', (_, id: number) => clearLlmProviderModelsCache(id))
  handleIpc('llm:restoreProviderFromInstance', (_, id: number) => restoreLlmProviderFromInstance(id))

  handleIpc('llm:createInstance', (_, payload: LlmInstanceCreatePayload) => createLlmInstance(payload))
  handleIpc('llm:updateInstance', (_, payload: LlmInstanceUpdatePayload) => updateLlmInstance(payload))
  handleIpc('llm:deleteInstance', async (_, id: number) => withActiveGenerationSnapshot(await deleteLlmInstance(id)))

  handleIpc('chat:create', (_, payload?: ChatCreatePayload) => createChat(payload ?? {}))
  handleIpc('chat:update', (_, payload: ChatUpdatePayload) => updateChat(payload))
  handleIpc('chat:delete', (_, id: number) => {
    if (hasActiveGeneration(id)) {
      throw new Error('这个聊天正在生成，请先停止生成。')
    }
    return deleteChat(id)
  })
  handleIpc('chat:createBlock', (_, payload: DbChatBlockCreatePayload) => {
    if (hasActiveGeneration(payload.chatId)) {
      throw new Error('当前聊天正在生成，请等待结束或停止后再添加聊天块。')
    }
    return createChatBlock(payload)
  })
  handleIpc('chat:updateBlock', (_, payload: DbChatBlockUpdatePayload) => {
    const block = getChatBlock(payload.id)
    if (hasActiveGeneration(block.chatId)) {
      throw new Error('当前聊天正在生成，请等待结束或停止后再编辑聊天块。')
    }
    return updateChatBlock(payload)
  })
  handleIpc('chat:deleteBlock', (_, id: number) => {
    const block = getChatBlock(id)
    if (hasActiveGeneration(block.chatId)) {
      throw new Error('当前聊天正在生成，请等待结束或停止后再编辑聊天块。')
    }
    return deleteChatBlock(id)
  })
  handleIpc('chat:startGeneration', (event, payload: ChatGenerationRequest) => startChatGeneration(payload, event.sender))
  handleIpc('chat:previewGeneration', (_, payload: ChatGenerationRequest) => previewChatGeneration(payload))
  handleIpc('chat:stopGeneration', (_, chatId: number) => stopChatGeneration(chatId))

  handleIpc('plugin:list', () => listProjectPlugins())
  handleIpc('plugin:readFile', (_, pluginId: string, path: string) => readPluginFile(pluginId, path))
  handleIpc('plugin:listDataFiles', (_, pluginId: string, path: string | undefined = '') => (
    listPluginDataFiles(pluginId, path)
  ))
  handleIpc('plugin:readDataFile', (_, pluginId: string, path: string) => readPluginDataFile(pluginId, path))
  handleIpc('plugin:readDataFileBase64', (_, pluginId: string, path: string) => readPluginDataFileBase64(pluginId, path))
  handleIpc('plugin:writeDataFile', (_, pluginId: string, path: string, content: string) => (
    writePluginDataFile(pluginId, path, content)
  ))
  handleIpc('plugin:writeDataFileBase64', (_, pluginId: string, path: string, content: string) => (
    writePluginDataFileBase64(pluginId, path, content)
  ))
  handleIpc('plugin:deleteDataFile', (_, pluginId: string, path: string) => deletePluginDataFile(pluginId, path))
  handleIpc('plugin:toolCallResponse', (_, payload: PluginToolCallResponse) => resolvePluginToolCall(payload))

  handleIpc('app:getVersion', () => app.getVersion())
  handleIpc('app:getName', () => app.getName())
  handleIpc('app:quit', () => app.quit())
}
