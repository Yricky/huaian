import { defineStForgePluginConfig } from '../vite.shared'

export default defineStForgePluginConfig(import.meta.url, {
  browserEjs: true,
  entries: {
    initGlobal: 'src/initGlobal.ts',
    initChat: 'src/initChat.ts',
    chatBlockProcessor: 'src/chatBlockProcessor.ts'
  }
})
