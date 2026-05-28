import vue from '@vitejs/plugin-vue'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const rootDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  base: './',
  build: {
    emptyOutDir: true,
    minify: 'esbuild',
    outDir: resolve(rootDir, 'out/renderer'),
    rollupOptions: {
      input: resolve(rootDir, 'src/renderer/index.html')
    }
  },
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(rootDir, './src')
    }
  },
  root: resolve(rootDir, 'src/renderer'),
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  }
})
