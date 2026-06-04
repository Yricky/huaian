import { protocol } from 'electron'
import { readFile, realpath } from 'fs/promises'
import { extname, isAbsolute, relative, resolve } from 'path'
import { getCurrentProject } from './project/state'
import { appAssetPath, appAssetRoot } from './project/apps'

export const ASSET_PROTOCOL = 'ha-asset'
export const APP_PROTOCOL = 'ha-app'

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

const APP_CONTENT_SECURITY_POLICY = [
  "default-src 'self' 'unsafe-inline' data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${APP_PROTOCOL}: ${ASSET_PROTOCOL}:`,
  `font-src 'self' data: ${APP_PROTOCOL}:`,
  `media-src 'self' data: blob: ${APP_PROTOCOL}:`,
  `connect-src 'self' data: blob: ${APP_PROTOCOL}: ${ASSET_PROTOCOL}: http: https:`,
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

function decodeAppAssetUrl(url: string): { appId: string, path: string } | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== `${APP_PROTOCOL}:`) return null
    const segments = parsed.pathname.split('/').filter(Boolean).map(segment => decodeURIComponent(segment))
    if (parsed.hostname !== 'app' || !segments.length) return null
    const [appId, ...pathSegments] = segments
    return {
      appId,
      path: pathSegments.join('/') || 'index.html'
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
      scheme: APP_PROTOCOL,
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

  protocol.handle(APP_PROTOCOL, async request => {
    const project = getCurrentProject()
    const asset = decodeAppAssetUrl(request.url)
    if (!project || !asset?.appId) return notFound()

    try {
      const requestedPath = appAssetPath(asset.appId, asset.path)
      const [filePath, realAppRoot] = await Promise.all([
        realpath(requestedPath),
        realpath(appAssetRoot(asset.appId))
      ])
      if (!isInDirectory(filePath, realAppRoot)) return notFound()

      const bytes = await readFile(filePath)
      return new Response(new Uint8Array(bytes), {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': APP_CONTENT_SECURITY_POLICY,
          'Content-Type': contentTypeForPath(filePath)
        }
      })
    } catch {
      return notFound()
    }
  })
}
