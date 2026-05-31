<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, type Component } from 'vue'
import { MdChat, MdExtension, MdFolderOpen, MdSettings } from 'vue-icons-plus/md'
import type { SidebarView } from '@/shared/types'
import { useProjectWorkbench } from '../composables/useProjectWorkbench'

const {
  activeView,
  openProject,
  openRecentProject,
  project,
  recentProjects,
  refreshRecentProjects
} = useProjectWorkbench()

const isProjectPopupOpen = ref(false)
const projectSwitcherRef = ref<HTMLElement | null>(null)

interface NavItem {
  view: SidebarView
  label: string
  icon: Component
}

const navItems: NavItem[] = [
  { view: 'chat', label: '聊天', icon: MdChat },
  { view: 'settings', label: '设置', icon: MdSettings },
  { view: 'plugins', label: '插件', icon: MdExtension }
]

const recentProjectItems = computed(() => {
  const currentPath = project.value?.path
  const currentProject = currentPath
    ? recentProjects.value.find(item => item.path === currentPath) ?? {
      path: currentPath,
      name: projectName(currentPath)
    }
    : null
  const projects = recentProjects.value.filter(item => item.path !== currentPath)
  return currentProject ? [currentProject, ...projects] : projects
})

function projectName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
}

function toggleProjectPopup() {
  isProjectPopupOpen.value = !isProjectPopupOpen.value
  if (isProjectPopupOpen.value) void refreshRecentProjects()
}

async function chooseRecentProject(path: string) {
  if (path === project.value?.path) return
  isProjectPopupOpen.value = false
  await openRecentProject(path)
}

async function chooseOtherProject() {
  isProjectPopupOpen.value = false
  await openProject()
}

function handleDocumentClick(event: MouseEvent) {
  if (!isProjectPopupOpen.value) return
  const target = event.target
  if (target instanceof Node && projectSwitcherRef.value?.contains(target)) return
  isProjectPopupOpen.value = false
}

onMounted(() => {
  document.addEventListener('click', handleDocumentClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick)
})
</script>

<template>
  <aside class="sidebar" aria-label="主导航">
    <div class="sidebar-main">
      <button v-for="item in navItems" :key="item.view" class="sidebar-nav-item"
        :class="{ active: activeView === item.view }" :aria-current="activeView === item.view ? 'page' : undefined"
        @click="activeView = item.view">
        <span class="sidebar-icon-shell">
          <component :is="item.icon" class="sidebar-icon" aria-hidden="true" />
        </span>
        <span class="sidebar-label">{{ item.label }}</span>
      </button>
    </div>

    <div ref="projectSwitcherRef" class="project-switcher" @keydown.escape="isProjectPopupOpen = false">
      <button class="sidebar-nav-item project-switcher-button" type="button" :aria-expanded="isProjectPopupOpen"
        aria-haspopup="menu" aria-label="项目" @click.stop="toggleProjectPopup">
        <span class="sidebar-icon-shell">
          <MdFolderOpen class="sidebar-icon" aria-hidden="true" />
        </span>
        <span class="sidebar-label">项目</span>
      </button>

      <section v-if="isProjectPopupOpen" class="project-popup" role="menu" aria-label="最近项目" @click.stop>
        <header class="project-popup-header">
          <strong>最近项目</strong>
        </header>

        <div class="project-list">
          <button v-for="item in recentProjectItems" :key="item.path" class="project-list-item" type="button"
            :class="{ current: item.path === project?.path }" :disabled="item.path === project?.path"
            :title="item.path" role="menuitem" @click="chooseRecentProject(item.path)">
            <span class="project-list-name">{{ item.name }}</span>
            <span class="project-list-path">{{ item.path }}</span>
            <em v-if="item.path === project?.path">当前</em>
          </button>
        </div>

        <button class="project-open-other" type="button" role="menuitem" @click="chooseOtherProject">
          <MdFolderOpen class="project-open-icon" aria-hidden="true" />
          <span>打开其他项目...</span>
        </button>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  position: relative;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  height: 100%;
  padding: 8px 0;
  border-right: 1px solid #d8dee7;
  background: #f8fafc;
}

.sidebar-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.sidebar-nav-item {
  width: 72px;
  min-height: 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  text-align: center;
  border: 0;
  border-radius: 18px;
  background: transparent;
  color: #465465;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
  transition: color 140ms ease, background 140ms ease;
}

.sidebar-nav-item:hover {
  color: #233246;
}

.sidebar-nav-item:focus-visible {
  outline: 2px solid #446bd7;
  outline-offset: 2px;
}

.sidebar-nav-item.active {
  color: #173e85;
}

.sidebar-icon-shell {
  width: 56px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 16px;
  transition: background 140ms ease;
}

.sidebar-nav-item:hover .sidebar-icon-shell {
  background: #edf2f8;
}

.sidebar-nav-item.active .sidebar-icon-shell {
  background: #dce6ff;
}

.sidebar-icon {
  width: 24px;
  height: 24px;
}

.sidebar-label {
  width: 100%;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.project-switcher {
  position: relative;
  margin-top: auto;
}

.project-switcher-button[aria-expanded="true"] {
  color: #173e85;
}

.project-switcher-button[aria-expanded="true"] .sidebar-icon-shell {
  background: #dce6ff;
}

.project-popup {
  position: absolute;
  bottom: 0;
  left: calc(100% + 8px);
  width: min(360px, calc(100vw - 96px));
  max-height: min(420px, calc(100vh - 20px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #cfd7e2;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 16px 40px rgba(22, 31, 44, 0.18);
}

.project-popup-header {
  flex-shrink: 0;
  padding: 10px 12px;
  border-bottom: 1px solid #edf0f4;
  color: #263141;
  font-size: 13px;
}

.project-list {
  min-height: 0;
  overflow: auto;
  padding: 6px;
}

.project-list-item {
  position: relative;
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 3px 8px;
  text-align: left;
  border: 0;
  border-radius: 6px;
  background: transparent;
  padding: 8px 8px;
  color: #243041;
}

.project-list-item:hover:not(:disabled) {
  background: #f1f5fb;
}

.project-list-item:focus-visible,
.project-open-other:focus-visible {
  outline: 2px solid #446bd7;
  outline-offset: 2px;
}

.project-list-item.current {
  background: #eef4ff;
  cursor: default;
}

.project-list-name {
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-list-path {
  grid-column: 1 / -1;
  min-width: 0;
  overflow: hidden;
  color: #667386;
  font-size: 11px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-list-item em {
  align-self: start;
  border-radius: 999px;
  background: #d8e6ff;
  padding: 2px 6px;
  color: #174f99;
  font-size: 11px;
  font-style: normal;
  font-weight: 600;
}

.project-open-other {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  border: 0;
  border-top: 1px solid #edf0f4;
  background: #ffffff;
  padding: 10px 12px;
  color: #174f99;
  font-size: 13px;
  font-weight: 600;
}

.project-open-other:hover {
  background: #f4f8ff;
}

.project-open-icon {
  width: 18px;
  height: 18px;
}

@media (max-width: 980px) {
  .sidebar-nav-item {
    width: 72px;
  }
}
</style>
