import { defineHuaianPluginConfig } from '../vite.shared'

export default defineHuaianPluginConfig(import.meta.url, {
  browserEjs: true,
  entries: {
    initGlobal: 'src/initGlobal.ts'
  },
  pages: {
    settingsHtml: { input: 'src/settings.html', name: 'settings' }
  }
})
