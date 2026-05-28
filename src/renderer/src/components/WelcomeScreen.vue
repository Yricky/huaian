<script setup lang="ts">
import { useProjectWorkbench } from '../composables/useProjectWorkbench'

const { openProject } = useProjectWorkbench()
</script>

<template>
  <div class="welcome">
    <div class="welcome-panel">
      <h1>ST Forge</h1>
      <p>打开一个空目录初始化项目，或打开已有 Forge 项目。</p>
      <button class="primary-button" @click="openProject">打开项目目录</button>
    </div>
  </div>
</template>

<style scoped>
.welcome {
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 24px;
}

.welcome-panel {
  width: min(440px, 100%);
  border: 1px solid #cfd6df;
  border-radius: 10px;
  background: #ffffff;
  padding: 24px;
}

.welcome-panel h1 {
  margin: 0 0 8px;
  font-size: 28px;
}

.welcome-panel p {
  margin: 0 0 18px;
  color: #5a6573;
}
</style>
