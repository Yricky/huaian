import { describe, expect, it } from 'vitest'
import { toStructuredCloneable } from '../src/value-utils'

describe('toStructuredCloneable', () => {
  it('drops uncloneable object fields and fills array slots with null', () => {
    const symbol = Symbol('skip')
    const fn = () => undefined
    const source = {
      keep: 1,
      missing: undefined,
      fn,
      symbol,
      nested: {
        ok: true,
        fn
      },
      list: [undefined, fn, symbol, , { ok: 2, fn }]
    }

    const result = toStructuredCloneable(source) as typeof source

    expect(result).toEqual({
      keep: 1,
      nested: {
        ok: true
      },
      list: [null, null, null, null, { ok: 2 }]
    })
    expect('missing' in result).toBe(false)
    expect('fn' in result).toBe(false)
    expect('symbol' in result).toBe(false)
  })

  it('returns undefined for a top-level uncloneable value', () => {
    expect(toStructuredCloneable(() => undefined)).toBeUndefined()
    expect(toStructuredCloneable(Symbol('skip'))).toBeUndefined()
  })

  it('preserves recursive and shared object references', () => {
    const shared: Record<string, unknown> = { label: 'shared' }
    const source: Record<string, unknown> = {
      first: shared,
      second: shared
    }
    source.self = source
    shared.parent = source

    const result = toStructuredCloneable(source) as Record<string, any>

    expect(result).not.toBe(source)
    expect(result.self).toBe(result)
    expect(result.first).toBe(result.second)
    expect(result.first).not.toBe(shared)
    expect(result.first.parent).toBe(result)
  })

  it('sanitizes Map and Set entries while preserving entry graph identity', () => {
    const shared = { ok: true }
    const fn = () => undefined
    const source = {
      map: new Map<unknown, unknown>([
        [shared, shared],
        [fn, 1],
        ['bad-value', fn],
        ['undefined-value', undefined]
      ]),
      set: new Set<unknown>([shared, fn, undefined])
    }

    const result = toStructuredCloneable(source) as {
      map: Map<unknown, unknown>
      set: Set<unknown>
    }
    const clonedObjectKey = [...result.map.keys()].find(key => typeof key === 'object' && key !== null)

    expect(result.map).toBeInstanceOf(Map)
    expect(result.set).toBeInstanceOf(Set)
    expect(clonedObjectKey).toBeTruthy()
    expect(result.map.get(clonedObjectKey)).toBe(clonedObjectKey)
    expect(result.map.has(fn)).toBe(false)
    expect(result.map.has('bad-value')).toBe(false)
    expect(result.map.has('undefined-value')).toBe(true)
    expect(result.map.get('undefined-value')).toBeUndefined()
    expect([...result.set].some(value => typeof value === 'function')).toBe(false)
    expect(result.set.has(undefined)).toBe(true)
  })

  it('keeps cloneable binary values ready for the platform structured clone', () => {
    const buffer = new ArrayBuffer(4)
    const view = new Uint8Array(buffer)
    view[0] = 42

    const result = toStructuredCloneable({ buffer, view }) as {
      buffer: ArrayBuffer
      view: Uint8Array
    }
    const platformClone = structuredClone(result)

    expect(result.buffer).toBe(buffer)
    expect(result.view).toBe(view)
    expect(platformClone.buffer).not.toBe(buffer)
    expect(platformClone.view.buffer).toBe(platformClone.buffer)
    expect(platformClone.view[0]).toBe(42)
  })

  it('keeps transferable MessagePort values', () => {
    if (typeof MessageChannel === 'undefined') return

    const channel = new MessageChannel()
    const result = toStructuredCloneable({ port: channel.port1 }) as { port: MessagePort }

    expect(result.port).toBe(channel.port1)
    expect(() => structuredClone(result, { transfer: [result.port] })).not.toThrow()
    channel.port2.close()
  })

  it('sanitizes Error cause values that would otherwise fail structured clone', () => {
    const error = new Error('boom') as Error & { cause?: unknown }
    error.cause = {
      ok: true,
      fn: () => undefined
    }

    const result = toStructuredCloneable(error) as Error & { cause?: unknown }

    expect(result).toBeInstanceOf(Error)
    expect(result.message).toBe('boom')
    expect(result.cause).toEqual({ ok: true })
    expect(() => structuredClone(result)).not.toThrow()
  })
})
