import type {
  ChatBlockKind,
  ChatGenerationPreviewMessage,
  ChatContentPart,
  MixedChatBlock,
  ProcessingChat,
  PluginRuntimeContext
} from '@huaian/plugin-api'
import { asRecord } from '@huaian/plugin-api'
import { loadSillyTavernCompatData } from './data'
import { buildSillyTavernLikePrompt, type RuntimeBlock } from './st-prompt-builder'

function kindFromRole(role: MixedChatBlock['role']): ChatBlockKind {
  if (role === 'system' || role === 'assistant') return role
  return 'user'
}

function legacyBlocks(chat: ProcessingChat): RuntimeBlock[] {
  return chat.chatBlocks.flatMap((block, index): RuntimeBlock[] => {
    if (!block.original) return []
    return [{
      id: block.original.id,
      kind: kindFromRole(block.role),
      enabled: block.original.enabled,
      orderIndex: index + 1,
      contentParts: block.original.contentParts,
      metadata: block.original.metadata
    }]
  })
}

function blockContentParts(message: ChatGenerationPreviewMessage): ChatContentPart[] {
  return typeof message.content === 'string'
    ? [{ type: 'text', text: message.content }]
    : message.content
}

function originallessBlock(message: ChatGenerationPreviewMessage): MixedChatBlock {
  return {
    role: message.role,
    llm: { content: message.content },
    user: { contentParts: blockContentParts(message) },
    pluginData: {}
  }
}

function promptMessagesToChatBlocks(chat: ProcessingChat, messages: ChatGenerationPreviewMessage[]): MixedChatBlock[] {
  const originalBlocks = chat.chatBlocks.filter(block => block.original)
  const originalById = new Map(originalBlocks.map(block => [block.original!.id, block]))
  const output: MixedChatBlock[] = []
  let originalIndex = 0

  function pushOriginalsBefore(blockId: number): MixedChatBlock | null {
    const targetIndex = originalBlocks.findIndex(block => block.original?.id === blockId)
    if (targetIndex < 0) return null
    while (originalIndex < targetIndex) {
      output.push({
        ...originalBlocks[originalIndex],
        llm: {}
      })
      originalIndex += 1
    }
    const block = originalById.get(blockId) ?? null
    if (block) originalIndex = targetIndex + 1
    return block
  }

  for (const message of messages) {
    const blockId = typeof message.blockId === 'number' ? message.blockId : null
    if (blockId === null || blockId < 0) {
      output.push(originallessBlock(message))
      continue
    }
    const block = pushOriginalsBefore(blockId)
    if (!block) {
      output.push(originallessBlock(message))
      continue
    }
    output.push({
      ...block,
      role: message.role,
      llm: { content: message.content }
    })
  }

  while (originalIndex < originalBlocks.length) {
    output.push({
      ...originalBlocks[originalIndex],
      llm: {}
    })
    originalIndex += 1
  }

  return output.map(block => ({
    ...block,
    pluginData: asRecord(block.pluginData)
  }))
}

export default function chatBlockProcessor(context: PluginRuntimeContext) {
  return {
    async process(chat: ProcessingChat): Promise<ProcessingChat> {
      const pluginData = asRecord(chat.chatSession.pluginData[context.plugin.id])
      const data = await loadSillyTavernCompatData(context.haExtApi.storage, chat.chatSession, pluginData)
      const prompt = buildSillyTavernLikePrompt({
        chat: {
          ...chat.chatSession,
          runtimeConfig: data.runtimeConfig
        },
        characters: data.characters,
        loreBooks: data.loreBooks,
        worldEntries: data.worldEntries,
        blocks: legacyBlocks(chat)
      })
      return {
        ...chat,
        chatBlocks: promptMessagesToChatBlocks(chat, prompt.messages)
      }
    }
  }
}
