import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const packageDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: resolve(packageDir, 'demo-dist'),
    rollupOptions: {
      input: resolve(packageDir, 'demo/index.html')
    }
  },
  root: resolve(packageDir, 'demo'),
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true
  }
})
