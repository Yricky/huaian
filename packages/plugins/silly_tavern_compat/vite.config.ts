import vue from '@vitejs/plugin-vue'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const packageDir = dirname(fileURLToPath(import.meta.url))
const pluginApiRoot = resolve(packageDir, '../../plugin-api/src')

const scriptEntries: Record<string, string> = {
  initGlobal: 'src/initGlobal.ts',
  initChat: 'src/initChat.ts',
  chatBlockProcessor: 'src/chatBlockProcessor.ts'
}

const pageEntries: Record<string, { input: string; name: string }> = {
  settingsHtml: { input: 'src/pages/settings.html', name: 'settings' },
  chatHtml: { input: 'src/pages/chat.html', name: 'chat' }
}

function flattenPageHtml(): Plugin {
  return {
    name: 'st-forge-flatten-page-html',
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const [fileName, file] of Object.entries(bundle)) {
        if (file.type !== 'asset' || !fileName.endsWith('.html')) continue
        const html = String(file.source)
        const outputName = fileName.endsWith('/settings.html') ? 'settings.html'
          : fileName.endsWith('/chat.html') ? 'chat.html'
            : fileName
        if (outputName !== fileName) {
          file.source = html.replace(/((?:\.\.\/)+)assets\//g, './assets/')
          file.fileName = outputName
        }
      }
    }
  }
}

export default defineConfig(({ mode }) => {
  const scriptEntry = scriptEntries[mode]
  const pageEntry = pageEntries[mode]
  if (!scriptEntry && !pageEntry) throw new Error(`未知插件构建入口：${mode}`)

  const common = {
    define: {
      'process.env.NODE_ENV': JSON.stringify('production')
    },
    publicDir: resolve(packageDir, 'plugin'),
    resolve: {
      alias: [
        { find: '@st-forge/plugin-api/chat-blocks', replacement: resolve(pluginApiRoot, 'chat-blocks.ts') },
        { find: '@st-forge/plugin-api/types', replacement: resolve(pluginApiRoot, 'types.ts') },
        { find: '@st-forge/plugin-api/value-utils', replacement: resolve(pluginApiRoot, 'value-utils.ts') },
        { find: '@st-forge/plugin-api', replacement: resolve(pluginApiRoot, 'index.ts') }
      ]
    },
    root: packageDir
  }

  if (pageEntry) {
    return {
      ...common,
      base: './',
      plugins: [vue(), flattenPageHtml()],
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
      }
    }
  }

  return {
    ...common,
    build: {
      emptyOutDir: mode === 'initGlobal',
      lib: {
        entry: resolve(packageDir, scriptEntry),
        fileName: () => `${mode}.js`,
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
    }
  }
})
