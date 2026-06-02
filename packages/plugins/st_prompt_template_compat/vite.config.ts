import { defineStForgePluginConfig } from '../vite.shared'

export default defineStForgePluginConfig(import.meta.url, {
  browserEjs: true,
  entries: {
    initGlobal: 'src/initGlobal.ts'
  },
  pages: {
    settingsHtml: { input: 'src/settings.html', name: 'settings' }
  }
})
