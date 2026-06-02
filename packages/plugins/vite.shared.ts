import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

interface HuaianPluginViteOptions {
  browserEjs?: boolean
  entries: Record<string, string>
  pages?: Record<string, { input: string; name: string }>
}

function flattenPageHtml(): Plugin {
  return {
    name: 'huaian-flatten-page-html',
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const [fileName, file] of Object.entries(bundle)) {
        if (file.type !== 'asset' || !fileName.endsWith('.html') || !fileName.includes('/')) continue
        const outputName = fileName.split('/').pop()
        if (!outputName) continue
        file.source = String(file.source).replace(/((?:\.\.\/)+)assets\//g, './assets/')
        file.fileName = outputName
      }
    }
  }
}

export function defineHuaianPluginConfig(importMetaUrl: string, options: HuaianPluginViteOptions) {
    const packageDir = dirname(fileURLToPath(importMetaUrl))
    const pluginApiRoot = resolve(packageDir, '../../plugin-api/src')
    const entryNames = Object.keys(options.entries)
      const alias = [
        { find: '@huaian/plugin-api/chat-blocks', replacement: resolve(pluginApiRoot, 'chat-blocks.ts') },
        { find: '@huaian/plugin-api/client', replacement: resolve(pluginApiRoot, 'client.ts') },
        { find: '@huaian/plugin-api/types', replacement: resolve(pluginApiRoot, 'types.ts') },
        { find: '@huaian/plugin-api/value-utils', replacement: resolve(pluginApiRoot, 'value-utils.ts') },
        { find: '@huaian/plugin-api', replacement: resolve(pluginApiRoot, 'index.ts') }
  ]
  if (options.browserEjs) {
    alias.unshift({ find: 'ejs', replacement: resolve(packageDir, 'node_modules/ejs/ejs.min.js') })
  }

  return defineConfig(({ mode }) => {
    const entryName = options.entries[mode] ? mode : entryNames[0]
    const pageEntry = options.pages?.[mode]
    if (!entryName && !pageEntry) throw new Error('插件 Vite 构建缺少入口。')
    if (pageEntry) {
      return {
        base: './',
        build: {
          emptyOutDir: false,
          minify: 'esbuild',
          outDir: resolve(packageDir, 'out'),
          rollupOptions: {
            input: {
              [pageEntry.name]: resolve(packageDir, pageEntry.input)
            },
            output: {
              assetFileNames: 'assets/[name]-[hash][extname]',
              chunkFileNames: 'assets/[name]-[hash].js',
              entryFileNames: 'assets/[name]-[hash].js'
            }
          },
          target: 'es2020'
        },
        define: {
          'process.env.NODE_ENV': JSON.stringify('production')
        },
        plugins: [flattenPageHtml()],
        publicDir: resolve(packageDir, 'plugin'),
        resolve: {
          alias
        },
        root: packageDir
      }
    }
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
