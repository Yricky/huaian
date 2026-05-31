import ejs from 'ejs'
import {
  chatBlockTargetRole,
  type ChatBlock,
  type ChatContentPart,
  type ChatGenerationPreviewMessage,
  type JsonRecord,
  type PluginProcessorState,
  type PluginRuntimeContext
} from '@st-forge/plugin-api'
import { asRecord } from '@st-forge/plugin-api'

const DEFAULT_USER_NAME = 'User'

async function renderPromptTemplateText(content: string, variables: JsonRecord): Promise<string> {
  if (!content.includes('<%')) return content
  try {
    return await ejs.render(content, {
      ...variables,
      variables,
      userName: DEFAULT_USER_NAME
    }, {
      async: true,
      outputFunctionName: 'print'
    })
  } catch {
    return content
  }
}

function messageText(content: string | ChatContentPart[]): string {
  if (typeof content === 'string') return content
  return content.map(part => part.type === 'text' ? part.text : '').join('')
}

function messageWithText(message: ChatGenerationPreviewMessage, text: string): ChatGenerationPreviewMessage {
  if (typeof message.content === 'string') return { ...message, content: text }
  return {
    ...message,
    content: message.content.map(part => part.type === 'text' ? { ...part, text } : part)
  }
}

async function renderContentParts(parts: ChatContentPart[], variables: JsonRecord): Promise<ChatContentPart[]> {
  return Promise.all(parts.map(async part => {
    if (part.type !== 'text' && part.type !== 'reasoning') return part
    return {
      ...part,
      text: await renderPromptTemplateText(part.text, variables)
    }
  }))
}

async function renderBlock(block: ChatBlock, variables: JsonRecord): Promise<ChatBlock> {
  return {
    ...block,
    contentParts: await renderContentParts(block.contentParts, {
      ...variables,
      blockId: block.id,
      kind: block.kind,
      role: chatBlockTargetRole(block)
    }),
    metadata: {
      ...block.metadata,
      renderedByPlugin: 'st_prompt_template_compat'
    }
  }
}

export default function chatBlockProcessor(context: PluginRuntimeContext) {
  return {
    async process(state: PluginProcessorState) {
      const config = asRecord(await context.api.storage.readJson('config.json', {
        enabled: true,
        renderMessages: true,
        globalVariables: {}
      }))
      if (config.enabled === false || config.renderMessages === false) return {}
      const variables = asRecord(config.globalVariables)
      const messages = await Promise.all(state.messages.map(async message => (
        messageWithText(message, await renderPromptTemplateText(messageText(message.content), {
          ...variables,
          chatId: state.chat.id,
          role: message.role
        }))
      )))
      const blocks = await Promise.all(state.blocks.map(block => renderBlock(block, {
        ...variables,
        chatId: state.chat.id
      })))
      return {
        blocks,
        messages,
        metadata: { promptTemplateCompat: { enabled: true } }
      }
    }
  }
}
