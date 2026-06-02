import { defineStForgePluginConfig } from '../vite.shared'

export default defineStForgePluginConfig(import.meta.url, {
  entries: {
    initGlobal: 'src/initGlobal.ts'
  },
  pages: {
    toolSettingsHtml: { input: 'src/toolSettings.html', name: 'toolSettings' }
  }
})
