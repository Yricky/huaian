import { defineStForgePluginConfig } from '../vite.shared'

export default defineStForgePluginConfig(import.meta.url, {
  entries: {
    initGlobal: 'src/initGlobal.ts',
    initChat: 'src/initChat.ts',
    handler: 'src/handler.ts'
  }
})
