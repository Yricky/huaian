import { app, dialog, ipcMain } from 'electron'
import type {
  ChatBlockCreatePayload,
  ChatBlockUpdatePayload,
  ChatGenerationRequest,
  ChatUpdatePayload,
  CharacterUpdatePayload,
  IpcJsonPayload,
  LlmInstanceCreatePayload,
  LlmInstanceUpdatePayload,
  LlmProviderCreatePayload,
  LlmProviderUpdatePayload,
  PromptSnippetUpdatePayload,
  PromptTagCreatePayload,
  PromptTagUpdatePayload,
  WorldBookUpdatePayload,
  WorldEntryOrderPayload,
  WorldEntryUpdatePayload
} from '../shared/types'
import { fetchProviderModels, hasActiveGeneration, previewChatGeneration, startChatGeneration, stopChatGeneration } from './project/llm-runtime'
import { exportCharacter, exportWorldBook } from './project/exporters'
import { hasProject } from './project/state'
import {
  clearLlmProviderModelsCache,
  createChat,
  createChatBlock,
  createCharacter,
  createLlmInstance,
  createLlmProvider,
  createPromptSnippet,
  createPromptTag,
  createWorldBook,
  createWorldEntry,
  deleteChat,
  deleteChatBlock,
  deleteCharacter,
  deleteLlmInstance,
  deleteLlmProvider,
  deletePromptSnippet,
  deletePromptTag,
  deleteWorldBook,
  deleteWorldEntry,
  getChatBlock,
  getProjectSnapshot,
  openProjectAt,
  reorderWorldEntries,
  restoreLlmProviderFromInstance,
  updateChat,
  updateChatBlock,
  updateCharacter,
  updateLlmInstance,
  updateLlmProvider,
  updatePromptSnippet,
  updatePromptTag,
  updateWorldBook,
  updateWorldEntry
} from './project/store'

function parseIpcPayload<T>(payload: IpcJsonPayload<T>): T {
  return typeof payload === 'string' ? JSON.parse(payload) : payload
}

export function registerIpcHandlers(): void {
  ipcMain.handle('project:get', async () => hasProject() ? getProjectSnapshot() : null)
  ipcMain.handle('project:open', async () => {
    if (hasActiveGeneration()) {
      throw new Error('有聊天正在生成，请先停止生成后再切换项目。')
    }
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return hasProject() ? getProjectSnapshot() : null
    return openProjectAt(result.filePaths[0])
  })

  ipcMain.handle('project:createCharacter', () => createCharacter())
  ipcMain.handle('project:updateCharacter', (_, payload: IpcJsonPayload<CharacterUpdatePayload>) => (
    updateCharacter(parseIpcPayload(payload))
  ))
  ipcMain.handle('project:deleteCharacter', (_, id: number) => deleteCharacter(id))

  ipcMain.handle('project:createWorldEntry', (_, worldBookId: number) => createWorldEntry(worldBookId))
  ipcMain.handle('project:updateWorldEntry', (_, payload: IpcJsonPayload<WorldEntryUpdatePayload>) => (
    updateWorldEntry(parseIpcPayload(payload))
  ))
  ipcMain.handle('project:deleteWorldEntry', (_, id: number) => deleteWorldEntry(id))
  ipcMain.handle('project:reorderWorldEntries', (_, payload: IpcJsonPayload<WorldEntryOrderPayload>) => (
    reorderWorldEntries(parseIpcPayload(payload))
  ))

  ipcMain.handle('project:createWorldBook', () => createWorldBook())
  ipcMain.handle('project:updateWorldBook', (_, payload: IpcJsonPayload<WorldBookUpdatePayload>) => (
    updateWorldBook(parseIpcPayload(payload))
  ))
  ipcMain.handle('project:deleteWorldBook', (_, id: number) => deleteWorldBook(id))

  ipcMain.handle('project:exportCharacter', (_, id: number) => exportCharacter(id))
  ipcMain.handle('project:exportWorldBook', (_, id: number) => exportWorldBook(id))

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

  ipcMain.handle('chat:create', () => createChat())
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

  ipcMain.handle('prompt:createSnippet', () => createPromptSnippet())
  ipcMain.handle('prompt:updateSnippet', (_, payload: IpcJsonPayload<PromptSnippetUpdatePayload>) => (
    updatePromptSnippet(parseIpcPayload(payload))
  ))
  ipcMain.handle('prompt:deleteSnippet', (_, id: number) => deletePromptSnippet(id))
  ipcMain.handle('prompt:createTag', (_, payload: IpcJsonPayload<PromptTagCreatePayload>) => (
    createPromptTag(parseIpcPayload(payload))
  ))
  ipcMain.handle('prompt:updateTag', (_, payload: IpcJsonPayload<PromptTagUpdatePayload>) => (
    updatePromptTag(parseIpcPayload(payload))
  ))
  ipcMain.handle('prompt:deleteTag', (_, id: number) => deletePromptTag(id))

  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:getName', () => app.getName())
  ipcMain.handle('app:quit', () => app.quit())
}
