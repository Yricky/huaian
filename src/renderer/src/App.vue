<script setup lang="ts">
import ChatPage from './components/ChatPage.vue'
import CharacterPage from './components/CharacterPage.vue'
import SettingsPage from './components/SettingsPage.vue'
import SidebarNav from './components/SidebarNav.vue'
import ToastStack from './components/ToastStack.vue'
import LoreBooksPage from './components/LoreBooksPage.vue'
import { createProjectWorkbench, provideProjectWorkbench } from './composables/useProjectWorkbench'

const workbench = createProjectWorkbench()
provideProjectWorkbench(workbench)

const { activeView } = workbench
</script>

<template>
  <div class="app-shell">
    <div class="workspace">
      <SidebarNav />

      <main class="content">
        <CharacterPage v-if="activeView === 'characters'" />
        <LoreBooksPage v-if="activeView === 'loreBooks'" />
        <ChatPage v-if="activeView === 'chat'" />
        <SettingsPage v-if="activeView === 'settings'" />
      </main>
    </div>

    <ToastStack />
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
}

.workspace {
  display: grid;
  grid-template-columns: 72px 1fr;
  height: 100vh;
}

.content {
  min-width: 0;
  overflow: hidden;
}
</style>
