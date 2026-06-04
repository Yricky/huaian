<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { MdApps, MdFolderOpen, MdPlayCircleFilled, MdSettings } from 'vue-icons-plus/md'
import { useProjectWorkbench } from '../composables/useProjectWorkbench'

const {
  activeView,
  appIconUrl,
  openApp,
  openProject,
  openRecentProject,
  project,
  recentApps,
  recentProjects,
  refreshRecentProjects
} = useProjectWorkbench()

const isProjectPopupOpen = ref(false)
const projectSwitcherRef = ref<HTMLElement | null>(null)

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

function appInitial(name: string | undefined, id: string): string {
  return (name || id).trim().slice(0, 1).toUpperCase() || 'A'
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
    <div class="sidebar-top">
      <button class="sidebar-nav-item" :class="{ active: activeView === 'apps' }"
        :aria-current="activeView === 'apps' ? 'page' : undefined" @click="activeView = 'apps'">
        <span class="sidebar-icon-shell">
          <MdApps class="sidebar-icon" aria-hidden="true" />
        </span>
        <span class="sidebar-label">应用</span>
      </button>
    </div>

    <div class="recent-apps" aria-label="最近应用">
      <button v-for="item in recentApps" :key="item.app.manifest.id" class="recent-app-button" type="button"
        :title="item.app.manifest.name || item.app.manifest.id" @click="openApp(item.app.manifest.id)">
        <img v-if="appIconUrl(item.app)" :src="appIconUrl(item.app)" alt="" />
        <span v-else>{{ appInitial(item.app.manifest.name, item.app.manifest.id) }}</span>
        <MdPlayCircleFilled v-if="item.running" class="running-icon" aria-label="运行中" />
      </button>
    </div>

    <div class="sidebar-bottom">
      <button class="sidebar-nav-item" :class="{ active: activeView === 'settings' }"
        :aria-current="activeView === 'settings' ? 'page' : undefined" @click="activeView = 'settings'">
        <span class="sidebar-icon-shell">
          <MdSettings class="sidebar-icon" aria-hidden="true" />
        </span>
        <span class="sidebar-label">设置</span>
      </button>

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

.sidebar-top,
.sidebar-bottom {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.recent-apps {
  width: 100%;
  min-height: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  overflow: auto;
  padding: 6px 0;
}

.recent-app-button {
  position: relative;
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  border: 1px solid #dbe2eb;
  border-radius: 8px;
  background: #ffffff;
  color: #273446;
  overflow: hidden;
  font-size: 16px;
  font-weight: 800;
}

.recent-app-button:hover {
  border-color: #c8d3e0;
  background: #f1f5fb;
}

.recent-app-button img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.running-icon {
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 15px;
  height: 15px;
  color: #2f9d63;
  filter: drop-shadow(0 1px 2px rgba(255, 255, 255, 0.95));
}

.sidebar-nav-item {
  width: 76px;
  min-height: 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  text-align: center;
  border: 0;
  border-radius: 8px;
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

.sidebar-nav-item:focus-visible,
.recent-app-button:focus-visible {
  outline: 2px solid #446bd7;
  outline-offset: 2px;
}

.sidebar-nav-item.active {
  color: #173e85;
}

.sidebar-icon-shell {
  width: 54px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 8px;
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
  width: min(360px, calc(100vw - 108px));
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
  padding: 8px;
  color: #243041;
}

.project-list-item:hover:not(:disabled) {
  background: #f1f5fb;
}

.project-list-item.current {
  background: #eef4ff;
  cursor: default;
}

.project-list-name,
.project-list-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-list-name {
  font-size: 13px;
  font-weight: 700;
}

.project-list-path {
  grid-column: 1 / -1;
  color: #708096;
  font-size: 11px;
}

.project-list-item em {
  align-self: start;
  color: #4169c8;
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
}

.project-open-other {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  border-top: 1px solid #edf0f4;
  background: #ffffff;
  color: #233246;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 700;
}

.project-open-other:hover {
  background: #f4f7fb;
}

.project-open-icon {
  width: 18px;
  height: 18px;
}
</style>
