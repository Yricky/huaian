import { characterName, replaceCharacterMacros } from './st-regex-scripts'
import type { ChatBlock, ChatBlockKind, ChatBlockTargetRole, CharacterEntry, JsonRecord } from './types'
import { asRecord, asString } from './value-utils'

type ChatBlockLike = Pick<ChatBlock, 'kind' | 'metadata'>
type ChatBlockDisplayLike = Pick<ChatBlock, 'kind' | 'metadata' | 'status'>

export interface ChatBlockDisplayOptions {
  character?: CharacterEntry | null
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

export function normalizeChatBlockTargetRole(value: unknown): ChatBlockTargetRole {
  return value === 'user' || value === 'assistant' || value === 'system' ? value : 'system'
}

export function chatBlockTargetRole(block: ChatBlockLike): ChatBlockTargetRole {
  if (block.kind === 'user' || block.kind === 'assistant' || block.kind === 'system') return block.kind
  if (block.kind === 'tool_definition') return 'system'
  return normalizeChatBlockTargetRole(block.metadata.targetRole)
}

export function chatBlockMetadataForStorage(kind: ChatBlockKind, metadata: unknown): JsonRecord {
  const next = { ...asRecord(metadata) }
  if (kind === 'injection') {
    next.targetRole = normalizeChatBlockTargetRole(next.targetRole)
  } else {
    delete next.targetRole
  }
  return next
}

export function chatBlockTitle(block: ChatBlockDisplayLike, options: ChatBlockDisplayOptions = {}): string {
  if (block.kind === 'injection') return '注入内容'
  if (block.kind === 'tool_definition') return '世界书编辑工具'
  if (block.kind === 'assistant') return characterName(options.character ?? null)
  if (block.kind === 'user') return replaceCharacterMacros('{{user}}', options.character ?? null, { userName: options.userName })
  if (block.kind === 'system') return 'System'
  return chatBlockTargetRole(block)
}

export function chatBlockSummary(block: ChatBlockLike): string {
  if (block.kind === 'tool_definition') return '工具定义'
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
  if (sourceNames.length > 0 && activatedCount > 0) return `${sourceNames[0]} · 世界书：${activatedCount} 条`
  if (sourceNames.length > 0) return sourceNames[0]!
  if (activatedCount > 0) return `世界书：${activatedCount} 条 · ${role}`
  return role
}
