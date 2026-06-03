import type { JsonRecord } from './types'

const SKIP = Symbol('huaian.skipStructuredCloneField')

const CLONEABLE_LEAF_TAGS = new Set([
  '[object ArrayBuffer]',
  '[object BigInt]',
  '[object BigInt64Array]',
  '[object BigUint64Array]',
  '[object Blob]',
  '[object Boolean]',
  '[object CryptoKey]',
  '[object DataView]',
  '[object Date]',
  '[object DOMException]',
  '[object DOMMatrix]',
  '[object DOMMatrixReadOnly]',
  '[object DOMPoint]',
  '[object DOMPointReadOnly]',
  '[object DOMQuad]',
  '[object DOMRect]',
  '[object DOMRectReadOnly]',
  '[object EncodedAudioChunk]',
  '[object EncodedVideoChunk]',
  '[object File]',
  '[object FileList]',
  '[object Float16Array]',
  '[object Float32Array]',
  '[object Float64Array]',
  '[object ImageBitmap]',
  '[object ImageData]',
  '[object Int8Array]',
  '[object Int16Array]',
  '[object Int32Array]',
  '[object MessagePort]',
  '[object Number]',
  '[object OffscreenCanvas]',
  '[object ReadableStream]',
  '[object RegExp]',
  '[object RTCCertificate]',
  '[object SharedArrayBuffer]',
  '[object String]',
  '[object TransformStream]',
  '[object Uint8Array]',
  '[object Uint8ClampedArray]',
  '[object Uint16Array]',
  '[object Uint32Array]',
  '[object WebAssembly.Module]',
  '[object WritableStream]'
])

const UNCLONEABLE_OBJECT_TAGS = new Set([
  '[object Arguments]',
  '[object AsyncGenerator]',
  '[object Generator]',
  '[object Promise]',
  '[object Symbol]',
  '[object WeakMap]',
  '[object WeakRef]',
  '[object WeakSet]',
  '[object FinalizationRegistry]'
])

const ERROR_CTORS: Record<string, new (message?: string) => Error> = {
  Error,
  EvalError,
  RangeError,
  ReferenceError,
  SyntaxError,
  TypeError,
  URIError
}

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

export function asNumber(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function objectTag(value: object): string | null {
  try {
    return Object.prototype.toString.call(value)
  } catch {
    return null
  }
}

function isNativeConstructor(value: unknown): boolean {
  if (typeof value !== 'function') return false
  try {
    return Function.prototype.toString.call(value).includes('[native code]')
  } catch {
    return true
  }
}

function isPlainObjectLike(value: object, tag: string): boolean {
  if (tag === '[object Object]') return true
  let prototype: object | null
  try {
    prototype = Object.getPrototypeOf(value)
  } catch {
    return false
  }
  if (prototype === null) return true
  const constructor = (prototype as { constructor?: unknown }).constructor
  return !isNativeConstructor(constructor)
}

function isMessagePortLike(value: object, tag: string): boolean {
  if (tag === '[object MessagePort]') return true
  if (tag !== '[object EventTarget]') return false
  const candidate = value as {
    close?: unknown
    postMessage?: unknown
    start?: unknown
  }
  return typeof candidate.postMessage === 'function'
    && typeof candidate.start === 'function'
    && typeof candidate.close === 'function'
}

function isArrayIndexKey(key: string, length: number): boolean {
  const index = Number(key)
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key
}

function setEnumerableValue(target: JsonRecord, key: string, value: unknown): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true
    })
    return
  }
  target[key] = value
}

function setArrayProperty(target: unknown[], key: string, value: unknown): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true
    })
    return
  }
  const record = target as unknown as Record<string, unknown>
  record[key] = value
}

function convertError(value: Error, seen: WeakMap<object, unknown>): Error | typeof SKIP {
  const constructor = ERROR_CTORS[value.name] ?? Error
  const clone = new constructor(value.message)
  clone.name = value.name
  if (value.stack) clone.stack = value.stack
  seen.set(value, clone)

  if ('cause' in value) {
    const cause = toStructuredCloneableValue((value as { cause?: unknown }).cause, seen)
    if (cause !== SKIP) {
      const cloneWithCause = clone as { cause?: unknown }
      cloneWithCause.cause = cause
    }
  }

  return clone
}

function convertArray(value: unknown[], seen: WeakMap<object, unknown>): unknown[] | typeof SKIP {
  let length: number
  try {
    length = value.length
  } catch {
    return SKIP
  }

  const clone = new Array(length)
  seen.set(value, clone)

  for (let index = 0; index < length; index += 1) {
    let item: unknown
    try {
      item = Object.prototype.hasOwnProperty.call(value, index) ? value[index] : undefined
    } catch {
      clone[index] = null
      continue
    }
    const next = toStructuredCloneableValue(item, seen)
    clone[index] = next === SKIP || next === undefined ? null : next
  }

  let keys: string[]
  try {
    keys = Object.keys(value)
  } catch {
    return clone
  }

  for (const key of keys) {
    if (isArrayIndexKey(key, length)) continue
    let item: unknown
    try {
      item = (value as unknown as Record<string, unknown>)[key]
    } catch {
      continue
    }
    const next = toStructuredCloneableValue(item, seen)
    if (next !== SKIP && next !== undefined) setArrayProperty(clone, key, next)
  }

  return clone
}

function convertMap(value: Map<unknown, unknown>, seen: WeakMap<object, unknown>): Map<unknown, unknown> | typeof SKIP {
  const clone = new Map<unknown, unknown>()
  seen.set(value, clone)

  try {
    for (const [key, item] of value) {
      const nextKey = toStructuredCloneableValue(key, seen)
      if (nextKey === SKIP) continue

      const nextItem = toStructuredCloneableValue(item, seen)
      if (nextItem === SKIP) continue

      clone.set(nextKey, nextItem)
    }
  } catch {
    seen.delete(value)
    return SKIP
  }

  return clone
}

function convertSet(value: Set<unknown>, seen: WeakMap<object, unknown>): Set<unknown> | typeof SKIP {
  const clone = new Set<unknown>()
  seen.set(value, clone)

  try {
    for (const item of value) {
      const next = toStructuredCloneableValue(item, seen)
      if (next !== SKIP) clone.add(next)
    }
  } catch {
    seen.delete(value)
    return SKIP
  }

  return clone
}

function convertObject(value: object, seen: WeakMap<object, unknown>): JsonRecord | typeof SKIP {
  let keys: string[]
  try {
    keys = Object.keys(value)
  } catch {
    return SKIP
  }

  const clone: JsonRecord = {}
  seen.set(value, clone)

  for (const key of keys) {
    let item: unknown
    try {
      item = (value as JsonRecord)[key]
    } catch {
      continue
    }
    const next = toStructuredCloneableValue(item, seen)
    if (next !== SKIP && next !== undefined) setEnumerableValue(clone, key, next)
  }

  return clone
}

function toStructuredCloneableValue(value: unknown, seen: WeakMap<object, unknown>): unknown | typeof SKIP {
  if (value === null) return null

  const type = typeof value
  if (type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint' || type === 'undefined') {
    return value
  }
  if (type === 'symbol' || type === 'function') return SKIP

  const objectValue = value as object
  const existing = seen.get(objectValue)
  if (existing !== undefined || seen.has(objectValue)) return existing

  if (Array.isArray(value)) return convertArray(value, seen)
  if (value instanceof Map) return convertMap(value, seen)
  if (value instanceof Set) return convertSet(value, seen)
  if (value instanceof Error) return convertError(value, seen)

  const tag = objectTag(objectValue)
  if (!tag || UNCLONEABLE_OBJECT_TAGS.has(tag)) return SKIP
  if (tag === '[object Map]') return convertMap(value as Map<unknown, unknown>, seen)
  if (tag === '[object Set]') return convertSet(value as Set<unknown>, seen)
  if (tag === '[object Error]') return convertError(value as Error, seen)
  if (isMessagePortLike(objectValue, tag)) return value
  if (CLONEABLE_LEAF_TAGS.has(tag)) return value
  if (!isPlainObjectLike(objectValue, tag)) return SKIP

  return convertObject(objectValue, seen)
}

export function toStructuredCloneable<T>(value: T): T | undefined {
  const cloneable = toStructuredCloneableValue(value, new WeakMap())
  return (cloneable === SKIP ? undefined : cloneable) as T | undefined
}
