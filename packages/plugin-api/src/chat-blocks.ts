import type {
  ChatBlock,
  ChatBlockTargetRole,
  ChatContentPart,
  ChatGenerationPreviewMessage
} from './types'
import { asRecord } from './value-utils'

type ChatBlockLike = Pick<ChatBlock, 'kind' | 'metadata'>
type RuntimeBlock = Pick<ChatBlock, 'id' | 'kind' | 'enabled' | 'contentParts' | 'metadata'>

export function normalizeChatBlockTargetRole(value: unknown): ChatBlockTargetRole {
  return value === 'user' || value === 'assistant' || value === 'system' ? value : 'system'
}

export function chatBlockTargetRole(block: ChatBlockLike): ChatBlockTargetRole {
  if (block.kind === 'user' || block.kind === 'assistant' || block.kind === 'system') return block.kind
  if (block.kind === 'tool_definition') return 'system'
  return normalizeChatBlockTargetRole(block.metadata.targetRole)
}

export function textFromContentParts(parts: ChatContentPart[]): string {
  return parts.map(part => {
    if (part.type === 'text') return part.text
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
    .filter(block => block.enabled && block.metadata.virtual !== true)
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

export function mergeVirtualBlocks(blocks: ChatBlock[], virtualBlocks: ChatBlock[]): ChatBlock[] {
  const startBlocks: ChatBlock[] = []
  const endBlocks: ChatBlock[] = []
  const before = new Map<number, ChatBlock[]>()
  const after = new Map<number, ChatBlock[]>()

  for (const block of virtualBlocks) {
    const metadata = asRecord(block.metadata)
    const beforeBlockId = typeof metadata.displayBeforeBlockId === 'number' ? metadata.displayBeforeBlockId : null
    const afterBlockId = typeof metadata.displayAfterBlockId === 'number' ? metadata.displayAfterBlockId : null
    if (beforeBlockId !== null) {
      const list = before.get(beforeBlockId) ?? []
      list.push(block)
      before.set(beforeBlockId, list)
      continue
    }
    if (afterBlockId !== null) {
      const list = after.get(afterBlockId) ?? []
      list.push(block)
      after.set(afterBlockId, list)
      continue
    }
    if (metadata.displaySlot === 'end') endBlocks.push(block)
    else startBlocks.push(block)
  }

  const result = [...startBlocks]
  for (const block of blocks) {
    result.push(...(before.get(block.id) ?? []), block, ...(after.get(block.id) ?? []))
  }
  result.push(...endBlocks)
  return result
}
