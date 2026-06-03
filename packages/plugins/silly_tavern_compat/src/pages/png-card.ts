const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_CHUNK_SIZE = 8192
const TEXT_CHUNK_TYPE = new Uint8Array([0x74, 0x45, 0x58, 0x74])
const textDecoder = new TextDecoder()
const textEncoder = new TextEncoder()

let crcTable: Uint32Array | null = null
let base64Lookup: Int16Array | null = null

function table(): Uint32Array {
  if (crcTable) return crcTable
  const next = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    next[index] = value >>> 0
  }
  crcTable = next
  return next
}

function crc32Parts(parts: Uint8Array[]): number {
  const lookup = table()
  let value = 0xffffffff
  for (const bytes of parts) {
    for (const byte of bytes) {
      value = lookup[(value ^ byte) & 0xff] ^ (value >>> 8)
    }
  }
  return (value ^ 0xffffffff) >>> 0
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff
  bytes[offset + 1] = (value >>> 16) & 0xff
  bytes[offset + 2] = (value >>> 8) & 0xff
  bytes[offset + 3] = value & 0xff
}

function assertPng(bytes: Uint8Array): void {
  if (bytes.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    throw new Error('不是有效的 PNG 文件。')
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.length, 0)
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}

function getBase64Lookup(): Int16Array {
  if (base64Lookup) return base64Lookup
  const lookup = new Int16Array(256)
  lookup.fill(-1)
  for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
    lookup[BASE64_ALPHABET.charCodeAt(index)] = index
  }
  lookup['-'.charCodeAt(0)] = 62
  lookup['_'.charCodeAt(0)] = 63
  lookup['='.charCodeAt(0)] = -2
  lookup[' '.charCodeAt(0)] = -3
  lookup['\n'.charCodeAt(0)] = -3
  lookup['\r'.charCodeAt(0)] = -3
  lookup['\t'.charCodeAt(0)] = -3
  base64Lookup = lookup
  return lookup
}

function decodeBase64(length: number, charCodeAt: (index: number) => number): Uint8Array {
  const lookup = getBase64Lookup()
  const output = new Uint8Array(Math.ceil(length * 3 / 4))
  let outputOffset = 0
  let buffer = 0
  let bits = 0

  for (let index = 0; index < length; index += 1) {
    const code = charCodeAt(index)
    if (code > 0xff) throw new Error('base64 数据包含非 ASCII 字符。')
    const value = lookup[code]
    if (value === -3) continue
    if (value === -2) break
    if (value < 0) throw new Error('base64 数据无效。')

    buffer = ((buffer << 6) | value) >>> 0
    bits += 6
    if (bits >= 8) {
      bits -= 8
      output[outputOffset] = (buffer >>> bits) & 0xff
      outputOffset += 1
    }
  }
  return output.subarray(0, outputOffset)
}

function decodeBase64Bytes(bytes: Uint8Array, start: number, end: number): Uint8Array {
  return decodeBase64(end - start, index => bytes[start + index])
}

function encodeBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  let chunk = ''
  let index = 0

  for (; index + 2 < bytes.length; index += 3) {
    const value = (bytes[index] << 16) | (bytes[index + 1] << 8) | bytes[index + 2]
    chunk += BASE64_ALPHABET[(value >>> 18) & 0x3f]
      + BASE64_ALPHABET[(value >>> 12) & 0x3f]
      + BASE64_ALPHABET[(value >>> 6) & 0x3f]
      + BASE64_ALPHABET[value & 0x3f]
    if (chunk.length >= BASE64_CHUNK_SIZE) {
      chunks.push(chunk)
      chunk = ''
    }
  }

  if (index < bytes.length) {
    const first = bytes[index]
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0
    const value = (first << 16) | (second << 8)
    chunk += BASE64_ALPHABET[(value >>> 18) & 0x3f]
      + BASE64_ALPHABET[(value >>> 12) & 0x3f]
      + (index + 1 < bytes.length ? BASE64_ALPHABET[(value >>> 6) & 0x3f] : '=')
      + '='
  }

  if (chunk) chunks.push(chunk)
  return chunks.join('')
}

function encodeBase64Utf8(text: string): string {
  return encodeBase64(textEncoder.encode(text))
}

function decodeBase64Utf8Bytes(bytes: Uint8Array, start: number, end: number): string {
  return textDecoder.decode(decodeBase64Bytes(bytes, start, end))
}

function chunkTypeEquals(bytes: Uint8Array, offset: number, type: string): boolean {
  return bytes[offset + 4] === type.charCodeAt(0)
    && bytes[offset + 5] === type.charCodeAt(1)
    && bytes[offset + 6] === type.charCodeAt(2)
    && bytes[offset + 7] === type.charCodeAt(3)
}

function lowerAscii(byte: number): number {
  return byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte
}

function findZero(bytes: Uint8Array, start: number, end: number): number {
  for (let index = start; index < end; index += 1) {
    if (bytes[index] === 0) return index
  }
  return -1
}

function keywordEquals(bytes: Uint8Array, start: number, end: number, keyword: string): boolean {
  if (end - start !== keyword.length) return false
  for (let index = 0; index < keyword.length; index += 1) {
    if (lowerAscii(bytes[start + index]) !== keyword.charCodeAt(index)) return false
  }
  return true
}

function characterTextChunk(bytes: Uint8Array, dataStart: number, dataEnd: number): { keyword: 'chara' | 'ccv3'; valueStart: number } | null {
  const separator = findZero(bytes, dataStart, dataEnd)
  if (separator < 0) return null
  if (keywordEquals(bytes, dataStart, separator, 'ccv3')) return { keyword: 'ccv3', valueStart: separator + 1 }
  if (keywordEquals(bytes, dataStart, separator, 'chara')) return { keyword: 'chara', valueStart: separator + 1 }
  return null
}

function encodeTextChunk(keyword: string, value: string): Uint8Array {
  const keywordBytes = textEncoder.encode(keyword)
  const valueBytes = textEncoder.encode(value)
  const data = new Uint8Array(keywordBytes.length + 1 + valueBytes.length)
  data.set(keywordBytes, 0)
  data[keywordBytes.length] = 0
  data.set(valueBytes, keywordBytes.length + 1)

  const chunk = new Uint8Array(12 + data.length)
  writeUint32(chunk, 0, data.length)
  chunk.set(TEXT_CHUNK_TYPE, 4)
  chunk.set(data, 8)
  writeUint32(chunk, 8 + data.length, crc32Parts([TEXT_CHUNK_TYPE, data]))
  return chunk
}

function v3Json(jsonText: string): string | null {
  try {
    const data = JSON.parse(jsonText)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null
    return JSON.stringify({ ...data, spec: 'chara_card_v3', spec_version: '3.0' })
  } catch {
    return null
  }
}

export function readPngCharacterJson(bytes: Uint8Array): string {
  assertPng(bytes)
  let charaRange: { start: number; end: number } | null = null
  let offset = PNG_SIGNATURE.length
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > bytes.length) throw new Error('PNG chunk 数据不完整。')
    const isText = chunkTypeEquals(bytes, offset, 'tEXt')
    const isEnd = chunkTypeEquals(bytes, offset, 'IEND')

    if (isText) {
      const textChunk = characterTextChunk(bytes, dataStart, dataEnd)
      if (textChunk?.keyword === 'ccv3') return decodeBase64Utf8Bytes(bytes, textChunk.valueStart, dataEnd)
      if (textChunk?.keyword === 'chara') charaRange = { start: textChunk.valueStart, end: dataEnd }
    }
    offset = dataEnd + 4
    if (isEnd) break
  }

  if (!charaRange) throw new Error('PNG 中没有 SillyTavern 角色卡 metadata。')
  return decodeBase64Utf8Bytes(bytes, charaRange.start, charaRange.end)
}

export function writePngCharacterJson(original: Uint8Array, jsonText: string): Uint8Array {
  assertPng(original)
  const parts: Uint8Array[] = [original.subarray(0, PNG_SIGNATURE.length)]
  const charaChunk = encodeTextChunk('chara', encodeBase64Utf8(jsonText))
  const ccv3 = v3Json(jsonText)
  const ccv3Chunk = ccv3 ? encodeTextChunk('ccv3', encodeBase64Utf8(ccv3)) : null
  let offset = PNG_SIGNATURE.length
  let wrote = false

  while (offset + 12 <= original.length) {
    const length = readUint32(original, offset)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const chunkEnd = dataEnd + 4
    if (chunkEnd > original.length) throw new Error('PNG chunk 数据不完整。')
    const isText = chunkTypeEquals(original, offset, 'tEXt')
    const isEnd = chunkTypeEquals(original, offset, 'IEND')
    const isCharacterText = isText && characterTextChunk(original, dataStart, dataEnd) !== null

    if (isEnd && !wrote) {
      parts.push(charaChunk)
      if (ccv3Chunk) parts.push(ccv3Chunk)
      wrote = true
    }
    if (!isCharacterText) parts.push(original.subarray(offset, chunkEnd))
    offset = chunkEnd
    if (isEnd) break
  }

  if (!wrote) throw new Error('PNG 缺少 IEND chunk。')
  return concat(parts)
}
