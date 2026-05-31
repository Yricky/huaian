import { protocol } from 'electron'
import { readFile, realpath } from 'fs/promises'
import { extname, isAbsolute, relative, resolve } from 'path'
import { getCurrentProject } from './project/state'

export const ASSET_PROTOCOL = 'st-forge-asset'

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.apng': 'image/apng',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
}

function notFound(): Response {
  return new Response('Not found', { status: 404 })
}

function contentTypeForPath(filePath: string): string {
  return IMAGE_CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

function decodeAssetPath(url: string): string | null {
  try {
    const parsed = new URL(url)
    const pathSegments = parsed.pathname.split('/').filter(Boolean)
    const segments = parsed.hostname ? [parsed.hostname, ...pathSegments] : pathSegments
    return segments.map(segment => decodeURIComponent(segment)).join('/')
  } catch {
    return null
  }
}

function isInDirectory(filePath: string, directoryPath: string): boolean {
  const directoryRelativePath = relative(directoryPath, filePath)
  return directoryRelativePath === '' || (!directoryRelativePath.startsWith('..') && !isAbsolute(directoryRelativePath))
}

export function registerAssetProtocolSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ASSET_PROTOCOL,
      privileges: {
        corsEnabled: true,
        secure: true,
        standard: true,
        supportFetchAPI: true
      }
    }
  ])
}

export function registerAssetProtocol(): void {
  protocol.handle(ASSET_PROTOCOL, async request => {
    const project = getCurrentProject()
    const assetPath = decodeAssetPath(request.url)
    if (!project || !assetPath) return notFound()

    const requestedPath = resolve(project.path, assetPath)
    const assetsRoot = resolve(project.assetsPath)
    if (!isInDirectory(requestedPath, assetsRoot)) return notFound()

    try {
      const [filePath, realAssetsRoot] = await Promise.all([
        realpath(requestedPath),
        realpath(assetsRoot)
      ])
      if (!isInDirectory(filePath, realAssetsRoot)) return notFound()

      const bytes = await readFile(filePath)
      return new Response(new Uint8Array(bytes), {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': contentTypeForPath(filePath)
        }
      })
    } catch {
      return notFound()
    }
  })
}
