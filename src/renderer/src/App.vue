<script setup lang="ts">
import { computed } from 'vue'
import { MdFolderOpen } from 'vue-icons-plus/md'
import ChatPage from './components/ChatPage.vue'
import CharacterPage from './components/CharacterPage.vue'
import PromptSnippetsPage from './components/PromptSnippetsPage.vue'
import SettingsPage from './components/SettingsPage.vue'
import SidebarNav from './components/SidebarNav.vue'
import ToastStack from './components/ToastStack.vue'
import WelcomeScreen from './components/WelcomeScreen.vue'
import LoreBooksPage from './components/LoreBooksPage.vue'
import { createProjectWorkbench, provideProjectWorkbench } from './composables/useProjectWorkbench'

const workbench = createProjectWorkbench()
provideProjectWorkbench(workbench)

const { activeView, openProject, project } = workbench

const projectDirectoryName = computed(() => {
  const projectPath = project.value?.path.trim()
  if (!projectPath) return '未打开'

  return projectPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || projectPath
})
</script>

<template>
  <div class="app-shell">
    <WelcomeScreen v-if="!project" />

    <template v-else>
      <header class="topbar">
        <div class="app-bar-leading">
          <div class="project-title" :title="projectDirectoryName">项目：{{ projectDirectoryName }}</div>
        </div>

        <div class="project-actions" aria-label="项目操作">
          <button class="toolbar-button" type="button" aria-label="切换项目" data-tooltip="切换项目" @click="openProject">
            <MdFolderOpen class="toolbar-icon" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div class="workspace">
        <SidebarNav />

        <main class="content">
          <CharacterPage v-if="activeView === 'characters'" />
          <LoreBooksPage v-if="activeView === 'loreBooks'" />
          <ChatPage v-if="activeView === 'chat'" />
          <PromptSnippetsPage v-if="activeView === 'prompts'" />
          <SettingsPage v-if="activeView === 'settings'" />
        </main>
      </div>
    </template>

    <ToastStack />
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
}

.topbar {
  position: relative;
  z-index: 10;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 10px 0 16px;
  border-bottom: 1px solid #dde3eb;
  background: #f9fbff;
}

.app-bar-leading {
  min-width: 0;
}

.project-title {
  color: #242a31;
  font-size: 13px;
  font-weight: 500;
  line-height: 42px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-actions {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
}

.workspace {
  display: grid;
  grid-template-columns: 72px 1fr;
  height: calc(100vh - 42px);
}

.content {
  min-width: 0;
  overflow: hidden;
}
</style>
