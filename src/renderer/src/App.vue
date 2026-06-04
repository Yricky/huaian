<script setup lang="ts">
import AppsPage from './components/AppsPage.vue'
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
        <AppsPage v-if="activeView === 'apps'" />
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
  grid-template-columns: 84px 1fr;
  height: 100vh;
}

.content {
  min-width: 0;
  overflow: hidden;
}
</style>
