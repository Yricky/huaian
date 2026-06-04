import { app } from 'electron'
import { join } from 'path'

export const isDev = process.env.NODE_ENV === 'development'
export const CONFIG_PATH = join(app.getPath('userData'), 'config.json')
export const DEFAULT_PROJECT_DIR = 'default-project'
export const PROJECT_FILE = 'forge.project.json'
export const DATABASE_FILE = 'forge.db'
export const EXPORTS_DIR = 'exports'
export const ASSETS_DIR = 'assets'
export const APP_DIR = 'app'
export const APP_DATA_DIR = 'appData'
export const APP_SAVE_DIR = 'appSave'
