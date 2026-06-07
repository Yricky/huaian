import { describe, expect, it } from 'vitest'
import { AppChatMessagePayloads } from '../src/chat-message-payloads'

describe('AppChatMessagePayloads', () => {
  it('creates system, user, and assistant payloads from a single text argument', () => {
    expect(AppChatMessagePayloads.system('system prompt')).toEqual({
      role: 'system',
      contentParts: [{ type: 'text', text: 'system prompt' }]
    })
    expect(AppChatMessagePayloads.user('hello')).toEqual({
      role: 'user',
      contentParts: [{ type: 'text', text: 'hello' }]
    })
    expect(AppChatMessagePayloads.assistant('reply')).toEqual({
      role: 'assistant',
      contentParts: [{ type: 'text', text: 'reply' }]
    })
  })

  it('does not add legacy content or assistant-only status fields by default', () => {
    const payload = AppChatMessagePayloads.assistant('reply') as Record<string, unknown>

    expect(payload.content).toBeUndefined()
    expect(payload.status).toBeUndefined()
    expect(payload.errorText).toBeUndefined()
  })

  it('creates payloads by role with fromText', () => {
    expect(AppChatMessagePayloads.fromText('user', 'choice')).toEqual(AppChatMessagePayloads.user('choice'))
  })
})
