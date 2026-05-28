import { builtinModules } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const rootDir = dirname(fileURLToPath(import.meta.url))
const nodeExternals = [...builtinModules, ...builtinModules.map(moduleName => `node:${moduleName}`)]

export default defineConfig(({ mode }) => ({
  build: {
    emptyOutDir: true,
    minify: mode === 'production' ? 'esbuild' : false,
    outDir: resolve(rootDir, 'out/main'),
    rollupOptions: {
      external: ['electron', 'better-sqlite3', ...nodeExternals],
      input: resolve(rootDir, 'src/main/index.ts'),
      output: {
        entryFileNames: 'index.js',
        format: 'cjs'
      }
    },
    ssr: true,
    target: 'node20'
  },
  resolve: {
    alias: {
      '@': resolve(rootDir, './src')
    }
  }
}))
