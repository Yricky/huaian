import { app } from 'electron'
import { join } from 'path'

export const isDev = process.env.NODE_ENV === 'development'
export const CONFIG_PATH = join(app.getPath('userData'), 'config.json')
export const PROJECT_FILE = 'forge.project.json'
export const DATABASE_FILE = 'forge.db'
export const EXPORTS_DIR = 'exports'
export const ASSETS_DIR = 'assets'
