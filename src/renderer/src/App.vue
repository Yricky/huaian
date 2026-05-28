<script setup lang="ts">
import CharacterPage from './components/CharacterPage.vue'
import SidebarNav from './components/SidebarNav.vue'
import ToastStack from './components/ToastStack.vue'
import WelcomeScreen from './components/WelcomeScreen.vue'
import WorldBooksPage from './components/WorldBooksPage.vue'
import WorldEntriesPage from './components/WorldEntriesPage.vue'
import { createProjectWorkbench, provideProjectWorkbench } from './composables/useProjectWorkbench'

const workbench = createProjectWorkbench()
provideProjectWorkbench(workbench)

const { activeView, openProject, project } = workbench
</script>

<template>
  <div class="app-shell">
    <WelcomeScreen v-if="!project" />

    <template v-else>
      <header class="topbar">
        <div>
          <div class="app-title">ST Forge</div>
          <div class="project-path">{{ project.path }}</div>
        </div>
        <button class="outline-button" @click="openProject">切换项目</button>
      </header>

      <div class="workspace">
        <SidebarNav />

        <main class="content">
          <CharacterPage v-if="activeView === 'characters'" />
          <WorldBooksPage v-if="activeView === 'worldBooks'" />
          <WorldEntriesPage v-if="activeView === 'worldEntries'" />
        </main>
      </div>
    </template>

    <ToastStack />
  </div>
</template>
