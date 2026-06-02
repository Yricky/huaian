import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const pluginsRoot = join(rootDir, 'packages/plugins')
const appBuiltinDir = join(rootDir, 'out/main/builtin-plugins')
const onlyIds = new Set(process.argv.slice(2).filter(Boolean))
const crcTable = makeCrcTable()

function makeCrcTable() {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
}

function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8)
  }
  return (value ^ 0xffffffff) >>> 0
}

function writeUInt16(value) {
  const bytes = Buffer.allocUnsafe(2)
  bytes.writeUInt16LE(value)
  return bytes
}

function writeUInt32(value) {
  const bytes = Buffer.allocUnsafe(4)
  bytes.writeUInt32LE(value >>> 0)
  return bytes
}

function zipDate() {
  return writeUInt16((1 << 5) | 1)
}

async function collectFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectFiles(root, fullPath))
      continue
    }
    if (!entry.isFile()) continue
    files.push({
      absolutePath: fullPath,
      zipPath: relative(root, fullPath).replace(/\\/g, '/')
    })
  }
  return files.sort((a, b) => a.zipPath.localeCompare(b.zipPath))
}

async function createZip(sourceDir) {
  const files = await collectFiles(sourceDir)
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const file of files) {
    const name = Buffer.from(file.zipPath, 'utf8')
    const content = await readFile(file.absolutePath)
    const checksum = crc32(content)
    const localHeader = Buffer.concat([
      writeUInt32(0x04034b50),
      writeUInt16(20),
      writeUInt16(0x0800),
      writeUInt16(0),
      writeUInt16(0),
      zipDate(),
      writeUInt32(checksum),
      writeUInt32(content.length),
      writeUInt32(content.length),
      writeUInt16(name.length),
      writeUInt16(0),
      name
    ])
    const centralHeader = Buffer.concat([
      writeUInt32(0x02014b50),
      writeUInt16(20),
      writeUInt16(20),
      writeUInt16(0x0800),
      writeUInt16(0),
      writeUInt16(0),
      zipDate(),
      writeUInt32(checksum),
      writeUInt32(content.length),
      writeUInt32(content.length),
      writeUInt16(name.length),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(0),
      writeUInt32(offset),
      name
    ])
    localParts.push(localHeader, content)
    centralParts.push(centralHeader)
    offset += localHeader.length + content.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const endOfCentralDirectory = Buffer.concat([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(files.length),
    writeUInt16(files.length),
    writeUInt32(centralDirectory.length),
    writeUInt32(offset),
    writeUInt16(0)
  ])

  return Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory])
}

async function readPluginPackage(packageDir) {
  const packageJson = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
  const staticDir = resolve(packageDir, packageJson.huaianPlugin?.source ?? 'plugin')
  const outDir = resolve(packageDir, packageJson.huaianPlugin?.out ?? 'out')
  const manifest = await readPluginManifest(staticDir)
  if (!manifest.id) throw new Error(`插件包缺少 id：${packageDir}`)
  if (!packageJson.name) throw new Error(`插件包缺少 package name：${packageDir}`)
  return {
    id: String(manifest.id),
    outDir,
    packageName: String(packageJson.name),
    packageDir,
    staticDir
  }
}

async function readPluginManifest(pluginDir) {
  for (const fileName of ['plugin.json', 'manifest.json']) {
    try {
      return JSON.parse(await readFile(join(pluginDir, fileName), 'utf8'))
    } catch {
      // Try the next supported manifest file name.
    }
  }
  throw new Error(`插件包缺少 plugin.json 或 manifest.json：${pluginDir}`)
}

async function runPnpm(args) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn('pnpm', args, {
      cwd: rootDir,
      shell: process.platform === 'win32',
      stdio: 'inherit'
    })
    child.on('error', rejectRun)
    child.on('exit', code => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(`pnpm ${args.join(' ')} failed with exit code ${code}`))
    })
  })
}

async function writeZipForPlugin(plugin) {
  await runPnpm(['--filter', plugin.packageName, 'build'])
  const builtManifest = await readPluginManifest(plugin.outDir)
  if (builtManifest.id !== plugin.id) throw new Error(`插件构建产物 id 不匹配：${plugin.id}`)
  const zip = await createZip(plugin.outDir)
  const packageDist = join(plugin.packageDir, 'dist')
  await Promise.all([
    mkdir(packageDist, { recursive: true }),
    mkdir(appBuiltinDir, { recursive: true })
  ])
  await Promise.all([
    writeFile(join(packageDist, `${plugin.id}.zip`), zip),
    writeFile(join(appBuiltinDir, `${plugin.id}.zip`), zip)
  ])
  console.log(`built ${plugin.id}.zip`)
}

async function main() {
  const packageNames = await readdir(pluginsRoot).catch(() => [])
  const packages = []
  for (const name of packageNames) {
    const packageDir = join(pluginsRoot, name)
    const stats = await stat(packageDir).catch(() => null)
    if (!stats?.isDirectory()) continue
    const plugin = await readPluginPackage(packageDir)
    if (!onlyIds.size || onlyIds.has(plugin.id)) packages.push(plugin)
  }

  if (!packages.length) {
    throw new Error(onlyIds.size ? `未找到插件包：${[...onlyIds].join(', ')}` : '未找到内置插件包。')
  }

  if (!onlyIds.size) await rm(appBuiltinDir, { recursive: true, force: true })
  for (const plugin of packages) {
    await rm(join(plugin.packageDir, 'dist'), { recursive: true, force: true })
    await writeZipForPlugin(plugin)
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
