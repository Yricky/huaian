import type {
  ChatBlockKind,
  ChatBlockTargetRole,
  ChatContentPart,
  ChatGenerationPreviewMessage,
  JsonRecord
} from './types'

type ChatBlockLike = { kind: ChatBlockKind; metadata: JsonRecord }
type RuntimeBlock = {
  id: number
  kind: ChatBlockKind
  enabled: boolean
  contentParts: ChatContentPart[]
  metadata: JsonRecord
}

export function normalizeChatBlockTargetRole(value: unknown): ChatBlockTargetRole {
  return value === 'user' || value === 'assistant' || value === 'system' ? value : 'system'
}

export function chatBlockTargetRole(block: ChatBlockLike): ChatBlockTargetRole {
  if (block.kind === 'user' || block.kind === 'assistant' || block.kind === 'system') return block.kind
  return normalizeChatBlockTargetRole(block.metadata.targetRole)
}

export function textFromContentParts(parts: ChatContentPart[]): string {
  return parts.map(part => {
    if (part.type === 'text') return part.text
    if (part.type === 'reasoning') return part.sendAsContext === true ? part.text : ''
    if (part.type !== 'tool_call' || part.sendAsContext !== true) return ''
    return [
      `[Tool call: ${part.toolName}]`,
      `input: ${JSON.stringify(part.input)}`,
      part.status === 'success' ? `output: ${JSON.stringify(part.output ?? null)}` : '',
      part.status === 'error' ? `error: ${part.error ?? ''}` : ''
    ].filter(Boolean).join('\n')
  }).join('')
}

export function messageHasContent(message: ChatGenerationPreviewMessage): boolean {
  if (typeof message.content === 'string') return message.content.trim().length > 0
  if (!Array.isArray(message.content)) return false
  return message.content.some(part => (
    part?.type === 'tool_call' ||
    ((part?.type === 'text' || part?.type === 'reasoning') && typeof part.text === 'string' && part.text.trim().length > 0)
  ))
}

export function baseMessagesFromBlocks(blocks: RuntimeBlock[]): ChatGenerationPreviewMessage[] {
  return blocks
    .filter(block => block.enabled)
    .map((block): ChatGenerationPreviewMessage | null => {
      const text = textFromContentParts(block.contentParts).trim()
      if (!text) return null
      return {
        role: chatBlockTargetRole(block),
        content: text,
        blockId: block.id
      }
    })
    .filter((message): message is ChatGenerationPreviewMessage => message !== null)
}
