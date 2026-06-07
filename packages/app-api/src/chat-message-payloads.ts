import type {
  AppChatMessageCreatePayload,
  AppChatRole,
  AssistantContentPart,
  SystemContentPart,
  TextContentPart,
  UserContentPart
} from './types'

export type SystemChatMessageCreatePayload = Extract<AppChatMessageCreatePayload, { role: 'system' }>
export type UserChatMessageCreatePayload = Extract<AppChatMessageCreatePayload, { role: 'user' }>
export type AssistantChatMessageCreatePayload = Extract<AppChatMessageCreatePayload, { role: 'assistant' }>

export function textContentPart(text: string): TextContentPart {
  return { type: 'text', text }
}

export class AppChatMessagePayloads {
  private constructor() { }

  static system(text: string): SystemChatMessageCreatePayload {
    return {
      role: 'system',
      contentParts: [textContentPart(text)] as SystemContentPart[]
    }
  }

  static user(text: string): UserChatMessageCreatePayload {
    return {
      role: 'user',
      contentParts: [textContentPart(text)] as UserContentPart[]
    }
  }

  static assistant(text: string): AssistantChatMessageCreatePayload {
    return {
      role: 'assistant',
      contentParts: [textContentPart(text)] as AssistantContentPart[]
    }
  }

  static fromText(role: 'system', text: string): SystemChatMessageCreatePayload
  static fromText(role: 'user', text: string): UserChatMessageCreatePayload
  static fromText(role: 'assistant', text: string): AssistantChatMessageCreatePayload
  static fromText(role: AppChatRole, text: string): AppChatMessageCreatePayload {
    if (role === 'system') return AppChatMessagePayloads.system(text)
    if (role === 'user') return AppChatMessagePayloads.user(text)
    return AppChatMessagePayloads.assistant(text)
  }
}
