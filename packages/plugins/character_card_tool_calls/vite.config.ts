import { defineHuaianPluginConfig } from '../vite.shared'

export default defineHuaianPluginConfig(import.meta.url, {
  entries: {
    initGlobal: 'src/initGlobal.ts'
  },
  pages: {
    toolSettingsHtml: { input: 'src/toolSettings.html', name: 'toolSettings' }
  }
})
