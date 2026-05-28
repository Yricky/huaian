import { app } from 'electron'
import { registerIpcHandlers } from './ipc'
import { readConfig } from './project/app-config'
import { closeCurrentProject } from './project/state'
import { isValidProject, openProjectAt } from './project/store'
import { createWindow } from './window'

registerIpcHandlers()

app.whenReady().then(async () => {
  app.setAboutPanelOptions({ authors: ['Yricky'] })
  const config = await readConfig()
  if (config.lastProjectPath) {
    try {
      if (await isValidProject(config.lastProjectPath)) {
        await openProjectAt(config.lastProjectPath)
      }
    } catch (error) {
      console.warn('Failed to reopen last project:', error)
    }
  }
  createWindow()
})

app.on('window-all-closed', () => {
  closeCurrentProject()
  app.quit()
})
