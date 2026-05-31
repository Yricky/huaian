import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

interface StForgePluginViteOptions {
  browserEjs?: boolean
  entries: Record<string, string>
}

export function defineStForgePluginConfig(importMetaUrl: string, options: StForgePluginViteOptions) {
  const packageDir = dirname(fileURLToPath(importMetaUrl))
  const pluginApiRoot = resolve(packageDir, '../../plugin-api/src')
  const entryNames = Object.keys(options.entries)
  const alias = [
    { find: '@st-forge/plugin-api/chat-blocks', replacement: resolve(pluginApiRoot, 'chat-blocks.ts') },
    { find: '@st-forge/plugin-api/types', replacement: resolve(pluginApiRoot, 'types.ts') },
    { find: '@st-forge/plugin-api/value-utils', replacement: resolve(pluginApiRoot, 'value-utils.ts') },
    { find: '@st-forge/plugin-api', replacement: resolve(pluginApiRoot, 'index.ts') }
  ]
  if (options.browserEjs) {
    alias.unshift({ find: 'ejs', replacement: resolve(packageDir, 'node_modules/ejs/ejs.min.js') })
  }

  return defineConfig(({ mode }) => {
    const entryName = options.entries[mode] ? mode : entryNames[0]
    if (!entryName) throw new Error('插件 Vite 构建缺少入口。')
    return {
      build: {
        emptyOutDir: entryName === entryNames[0],
        lib: {
          entry: resolve(packageDir, options.entries[entryName]),
          fileName: () => `${entryName}.js`,
          formats: ['es']
        },
        minify: 'esbuild',
        outDir: resolve(packageDir, 'out'),
        rolldownOptions: {
          output: {
            codeSplitting: false
          }
        },
        rollupOptions: {
          output: {
            assetFileNames: '[name][extname]',
            chunkFileNames: '[name]-[hash].js',
            entryFileNames: '[name].js',
            format: 'es'
          }
        },
        target: 'es2020'
      },
      define: {
        'process.env.NODE_ENV': JSON.stringify('production')
      },
      publicDir: resolve(packageDir, 'plugin'),
      resolve: {
        alias
      },
      root: packageDir
    }
  })
}
