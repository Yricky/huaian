<script setup lang="ts">
import { useProjectWorkbench } from '../composables/useProjectWorkbench'

const { activeView } = useProjectWorkbench()
</script>

<template>
  <aside class="sidebar">
    <button :class="{ active: activeView === 'characters' }" @click="activeView = 'characters'">角色卡</button>
    <button :class="{ active: activeView === 'worldBooks' }" @click="activeView = 'worldBooks'">世界书</button>
    <button :class="{ active: activeView === 'worldEntries' }" @click="activeView = 'worldEntries'">世界书条目</button>
  </aside>
</template>
