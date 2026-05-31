import { protocol } from 'electron'
import { readFile, realpath } from 'fs/promises'
import { extname, isAbsolute, relative, resolve } from 'path'
import { getCurrentProject } from './project/state'
import { pluginAssetPath } from './project/plugins'

export const ASSET_PROTOCOL = 'st-forge-asset'
export const PLUGIN_PROTOCOL = 'st-forge-plugin'

const CONTENT_TYPES: Record<string, string> = {
  '.apng': 'image/apng',
  '.css': 'text/css; charset=utf-8',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp'
}

function notFound(): Response {
  return new Response('Not found', { status: 404 })
}

function contentTypeForPath(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
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
    },
    {
      scheme: PLUGIN_PROTOCOL,
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

  protocol.handle(PLUGIN_PROTOCOL, async request => {
    const project = getCurrentProject()
    const pluginPath = decodeAssetPath(request.url)
    if (!project || !pluginPath) return notFound()
    const [pluginId, ...pathParts] = pluginPath.split('/').filter(Boolean)
    if (!pluginId || pluginId === 'base') return notFound()

    try {
      const filePath = pluginAssetPath(pluginId, pathParts.join('/'))
      const bytes = await readFile(filePath)
      return new Response(new Uint8Array(bytes), {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'self' 'unsafe-inline' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: st-forge-plugin: st-forge-asset:;",
          'Content-Type': contentTypeForPath(filePath)
        }
      })
    } catch {
      return notFound()
    }
  })
}
