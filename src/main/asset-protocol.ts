import { protocol } from 'electron'
import { readFile, realpath } from 'fs/promises'
import { extname, isAbsolute, relative, resolve } from 'path'
import { getCurrentProject } from './project/state'
import { pluginAssetPath, pluginAssetRoot } from './project/plugins'

export const ASSET_PROTOCOL = 'ha-asset'
export const PLUGIN_PROTOCOL = 'ha-ext'

const CONTENT_TYPES: Record<string, string> = {
  '.apng': 'image/apng',
  '.css': 'text/css; charset=utf-8',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

const PLUGIN_CONTENT_SECURITY_POLICY = [
  "default-src 'self' 'unsafe-inline' data:",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: ${PLUGIN_PROTOCOL}: ${ASSET_PROTOCOL}:`,
  `font-src 'self' data: ${PLUGIN_PROTOCOL}:`,
  `media-src 'self' data: ${PLUGIN_PROTOCOL}:`,
  `connect-src 'self' data: ${PLUGIN_PROTOCOL}: ${ASSET_PROTOCOL}:`,
  "worker-src 'self' blob:"
].join('; ')

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

function decodePluginAssetUrl(url: string): { pluginId: string, path: string } | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== `${PLUGIN_PROTOCOL}:` || !parsed.hostname) return null
    const pathSegments = parsed.pathname.split('/').filter(Boolean).map(segment => decodeURIComponent(segment))
    return {
      pluginId: decodeURIComponent(parsed.hostname),
      path: pathSegments.join('/')
    }
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

  const handlePluginAssetRequest = async (request: Request) => {
    const project = getCurrentProject()
    const asset = decodePluginAssetUrl(request.url)
    if (!project || !asset?.pluginId) return notFound()

    try {
      const requestedPath = pluginAssetPath(asset.pluginId, asset.path)
      const [filePath, realPluginRoot] = await Promise.all([
        realpath(requestedPath),
        realpath(pluginAssetRoot(asset.pluginId))
      ])
      if (!isInDirectory(filePath, realPluginRoot)) return notFound()

      const bytes = await readFile(filePath)
      return new Response(new Uint8Array(bytes), {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': PLUGIN_CONTENT_SECURITY_POLICY,
          'Content-Type': contentTypeForPath(filePath)
        }
      })
    } catch {
      return notFound()
    }
  }

  protocol.handle(PLUGIN_PROTOCOL, handlePluginAssetRequest)
}
