<script setup lang="ts">
import { useProjectWorkbench } from '../composables/useProjectWorkbench'

const { toasts } = useProjectWorkbench()
</script>

<template>
  <div class="toast-stack">
    <div v-for="toast in toasts" :key="toast.id" class="toast" :class="toast.kind">{{ toast.text }}</div>
  </div>
</template>
