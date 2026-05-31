import { mkdir, readFile, writeFile } from 'fs/promises'
import { inflateRawSync } from 'zlib'
import { dirname, isAbsolute, relative, resolve } from 'path'

function isInDirectory(filePath: string, directoryPath: string): boolean {
  const directoryRelativePath = relative(directoryPath, filePath)
  return directoryRelativePath === '' || (!directoryRelativePath.startsWith('..') && !isAbsolute(directoryRelativePath))
}

function safeChildPath(root: string, childPath = ''): string {
  const normalized = childPath.replace(/\\/g, '/').replace(/^\/+/, '')
  const filePath = resolve(root, normalized)
  if (!isInDirectory(filePath, root)) throw new Error('zip 文件包含不安全路径。')
  return filePath
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minimumOffset = Math.max(0, buffer.length - 0xffff - 22)
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset
  }
  throw new Error('zip 文件格式不合法：找不到中央目录。')
}

function entryContent(buffer: Buffer, localHeaderOffset: number, compressedSize: number, method: number): Buffer {
  if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
    throw new Error('zip 文件格式不合法：本地文件头损坏。')
  }
  const nameLength = buffer.readUInt16LE(localHeaderOffset + 26)
  const extraLength = buffer.readUInt16LE(localHeaderOffset + 28)
  const start = localHeaderOffset + 30 + nameLength + extraLength
  const compressed = buffer.subarray(start, start + compressedSize)
  if (method === 0) return compressed
  if (method === 8) return inflateRawSync(compressed)
  throw new Error(`不支持的 zip 压缩方法：${method}`)
}

export async function extractZipFile(zipPath: string, targetRoot: string): Promise<void> {
  const buffer = await readFile(zipPath)
  const eocd = findEndOfCentralDirectory(buffer)
  const totalEntries = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  await mkdir(targetRoot, { recursive: true })

  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('zip 文件格式不合法：中央目录损坏。')
    }
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localHeaderOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    offset += 46 + nameLength + extraLength + commentLength

    if (!name || name.endsWith('/')) {
      if (name) await mkdir(safeChildPath(targetRoot, name), { recursive: true })
      continue
    }

    const filePath = safeChildPath(targetRoot, name)
    const content = entryContent(buffer, localHeaderOffset, compressedSize, method)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, content)
  }
}
