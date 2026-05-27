import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  main: {
    build: {
      minify: 'oxc',
      rollupOptions: {
        external: ['electron'],
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
        output: {
          format: 'cjs'
        }
      }
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, './src')
      }
    }
  },
  preload: {
    build: {
      minify: 'oxc',
      rollupOptions: {
        external: ['electron'],
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
        output: {
          format: 'cjs'
        }
      }
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, './src')
      }
    }
  },
  renderer: {
    build: {
      minify: 'oxc',
      rollupOptions: {
        external: ['electron'],
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    },
    plugins: [vue()],
    resolve: {
      alias: {
        '@': resolve(__dirname, './src')
      }
    }
  }
})