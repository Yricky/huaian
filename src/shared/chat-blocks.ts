import {
  chatBlockMetadataForStorage,
  chatBlockTargetRole,
  normalizeChatBlockTargetRole
} from '@st-forge/plugin-api/chat-blocks'
import type { ChatBlock, JsonRecord } from './types'
import { asRecord, asString } from './value-utils'

type ChatBlockDisplayLike = Pick<ChatBlock, 'kind' | 'metadata' | 'status'>

export interface ChatBlockDisplayOptions {
  userName?: string
}

function asNumberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.map(Number).filter(Number.isFinite)
    : []
}

function metadataRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter(record => Object.keys(record).length > 0)
    : []
}

export { chatBlockMetadataForStorage, chatBlockTargetRole, normalizeChatBlockTargetRole }

export function chatBlockTitle(block: ChatBlockDisplayLike, options: ChatBlockDisplayOptions = {}): string {
  if (block.kind === 'injection') return '注入内容'
  if (block.kind === 'tool_definition') return asString(asRecord(block.metadata.toolDefinition).label, '工具调用定义')
  if (block.kind === 'assistant') return 'Assistant'
  if (block.kind === 'user') return options.userName || 'User'
  if (block.kind === 'system') return 'System'
  return chatBlockTargetRole(block)
}

export function chatBlockSummary(block: Pick<ChatBlock, 'kind' | 'metadata'>): string {
  if (block.kind === 'tool_definition') {
    const definition = asRecord(block.metadata.toolDefinition)
    return [asString(definition.pluginId), asString(definition.toolCallName)].filter(Boolean).join(' · ') || '工具定义'
  }
  if (block.kind !== 'injection') return ''

  const role = chatBlockTargetRole(block)
  const details = metadataRecords(block.metadata.injectionDetails)
  const firstDetail = details[0]
  const firstTitle = asString(firstDetail?.title)
  const firstReason = asString(firstDetail?.reason)
  const depth = firstReason.match(/Depth\s+(\d+)/)?.[1]
  if (depth) return `Depth ${depth} · ${role}`
  if (firstTitle === 'Post-history instructions') return firstTitle

  const sourceNames = [...new Set(details.map(detail => asString(detail.sourceName)).filter(Boolean))]
  const activatedCount = asNumberArray(block.metadata.activatedEntryIds).length
  if (sourceNames.length > 0 && activatedCount > 0) return `${sourceNames[0]} · 注入：${activatedCount} 条`
  if (sourceNames.length > 0) return sourceNames[0]!
  if (activatedCount > 0) return `注入：${activatedCount} 条 · ${role}`
  return role
}
