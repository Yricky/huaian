import { app, dialog, ipcMain } from 'electron'
import type {
  ChatCreatePayload,
  ChatBlockCreatePayload,
  ChatBlockUpdatePayload,
  ChatGenerationRequest,
  ChatUpdatePayload,
  CharacterUpdatePayload,
  IpcJsonPayload,
  LoreBookDraftApplyPayload,
  LlmInstanceCreatePayload,
  LlmInstanceUpdatePayload,
  LlmProviderCreatePayload,
  LlmProviderUpdatePayload,
  LoreBookUpdatePayload,
  ProjectConfigUpdatePayload,
  WorldEntryOrderPayload,
  WorldEntryUpdatePayload
} from '../shared/types'
import { fetchProviderModels, hasActiveGeneration, previewChatGeneration, startChatGeneration, stopChatGeneration } from './project/llm-runtime'
import { exportCharacter, exportLoreBook } from './project/exporters'
import { importCharactersFromDialog, importLoreBooksFromDialog } from './project/importers'
import { applyLoreBookDraft, discardLoreBookDraft, listLoreBookDrafts } from './project/lorebook-drafts'
import { hasProject } from './project/state'
import {
  clearLlmProviderModelsCache,
  createChat,
  createChatBlock,
  createCharacter,
  createLlmInstance,
  createLlmProvider,
  createLoreBook,
  createWorldEntry,
  deleteChat,
  deleteChatBlock,
  deleteCharacter,
  deleteLlmInstance,
  deleteLlmProvider,
  deleteLoreBook,
  deleteWorldEntry,
  forgetRecentProject,
  getChatBlock,
  getProjectSnapshot,
  listRecentProjects,
  openDefaultProject,
  openProjectAt,
  reorderWorldEntries,
  restoreLlmProviderFromInstance,
  updateChat,
  updateChatBlock,
  updateCharacter,
  updateProjectConfig,
  updateLlmInstance,
  updateLlmProvider,
  updateLoreBook,
  updateWorldEntry
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

  ipcMain.handle('project:createCharacter', () => createCharacter())
  ipcMain.handle('project:updateCharacter', (_, payload: IpcJsonPayload<CharacterUpdatePayload>) => (
    updateCharacter(parseIpcPayload(payload))
  ))
  ipcMain.handle('project:deleteCharacter', (_, id: number) => deleteCharacter(id))

  ipcMain.handle('project:createWorldEntry', (_, loreBookId: number) => createWorldEntry(loreBookId))
  ipcMain.handle('project:updateWorldEntry', (_, payload: IpcJsonPayload<WorldEntryUpdatePayload>) => (
    updateWorldEntry(parseIpcPayload(payload))
  ))
  ipcMain.handle('project:deleteWorldEntry', (_, id: number) => deleteWorldEntry(id))
  ipcMain.handle('project:reorderWorldEntries', (_, payload: IpcJsonPayload<WorldEntryOrderPayload>) => (
    reorderWorldEntries(parseIpcPayload(payload))
  ))

  ipcMain.handle('project:createLoreBook', () => createLoreBook())
  ipcMain.handle('project:updateLoreBook', (_, payload: IpcJsonPayload<LoreBookUpdatePayload>) => (
    updateLoreBook(parseIpcPayload(payload))
  ))
  ipcMain.handle('project:deleteLoreBook', (_, id: number) => deleteLoreBook(id))

  ipcMain.handle('project:exportCharacter', (_, id: number) => exportCharacter(id))
  ipcMain.handle('project:exportLoreBook', (_, id: number) => exportLoreBook(id))
  ipcMain.handle('project:importCharacters', () => importCharactersFromDialog())
  ipcMain.handle('project:importLoreBooks', () => importLoreBooksFromDialog())
  ipcMain.handle('project:listLoreBookDrafts', () => listLoreBookDrafts())
  ipcMain.handle('project:applyLoreBookDraft', (_, payload: IpcJsonPayload<LoreBookDraftApplyPayload>) => (
    applyLoreBookDraft(parseIpcPayload(payload))
  ))
  ipcMain.handle('project:discardLoreBookDraft', (_, loreBookId: number) => discardLoreBookDraft(loreBookId))

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

  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:getName', () => app.getName())
  ipcMain.handle('app:quit', () => app.quit())
}
