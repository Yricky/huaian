import { app } from 'electron'
import { registerAssetProtocol, registerAssetProtocolSchemes } from './asset-protocol'
import { registerIpcHandlers } from './ipc'
import { readConfig } from './project/app-config'
import { closeCurrentProject } from './project/state'
import { isValidProject, openDefaultProject, openProjectAt } from './project/store'
import { createWindow } from './window'

registerAssetProtocolSchemes()
registerIpcHandlers()

app.whenReady().then(async () => {
  registerAssetProtocol()
  app.setAboutPanelOptions({ authors: ['Yricky'] })
  const config = await readConfig()
  const candidateProjectPaths = [
    config.lastProjectPath,
    ...(config.recentProjectPaths ?? [])
  ].filter((path, index, paths): path is string => Boolean(path) && paths.indexOf(path) === index)
  let openedProject = false

  for (const projectPath of candidateProjectPaths) {
    try {
      if (await isValidProject(projectPath)) {
        await openProjectAt(projectPath)
        openedProject = true
        break
      }
    } catch (error) {
      console.warn('Failed to reopen project:', error)
    }
  }

  if (!openedProject) {
    await openDefaultProject()
  }

  createWindow()
})

app.on('window-all-closed', () => {
  closeCurrentProject()
  app.quit()
})
