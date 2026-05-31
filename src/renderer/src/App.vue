<script setup lang="ts">
import ChatPage from './components/ChatPage.vue'
import PluginsPage from './components/PluginsPage.vue'
import SettingsPage from './components/SettingsPage.vue'
import SidebarNav from './components/SidebarNav.vue'
import ToastStack from './components/ToastStack.vue'
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
        <ChatPage v-if="activeView === 'chat'" />
        <SettingsPage v-if="activeView === 'settings'" />
        <PluginsPage v-if="activeView === 'plugins'" />
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
