import type { ProjectConfig } from '../../shared/types'

export interface ProjectContext {
  path: string
  dbPath: string
  configPath: string
  exportsPath: string
  db: any
  config: ProjectConfig
}

let currentProject: ProjectContext | null = null

export function hasProject(): boolean {
  return Boolean(currentProject)
}

export function getCurrentProject(): ProjectContext | null {
  return currentProject
}

export function setCurrentProject(project: ProjectContext): void {
  currentProject?.db?.close?.()
  currentProject = project
}

export function closeCurrentProject(): void {
  currentProject?.db?.close?.()
  currentProject = null
}

export function ensureProject(): ProjectContext {
  if (!currentProject) {
    throw new Error('尚未打开项目。')
  }
  return currentProject
}
