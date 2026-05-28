import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { CONFIG_PATH } from './constants'

export interface AppConfig {
  lastProjectPath?: string
}

export async function readConfig(): Promise<AppConfig> {
  try {
    const content = await readFile(CONFIG_PATH, 'utf-8')
    return JSON.parse(content)
  } catch {
    return {}
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
}
