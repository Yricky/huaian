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
