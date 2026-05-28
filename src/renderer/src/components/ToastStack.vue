<script setup lang="ts">
import { useProjectWorkbench } from '../composables/useProjectWorkbench'

const { toasts } = useProjectWorkbench()
</script>

<template>
  <div class="toast-stack">
    <div v-for="toast in toasts" :key="toast.id" class="toast" :class="toast.kind">{{ toast.text }}</div>
  </div>
</template>

<style scoped>
.toast-stack {
  position: fixed;
  right: 14px;
  bottom: 14px;
  display: grid;
  gap: 8px;
  z-index: 20;
}

.toast {
  max-width: 520px;
  border: 1px solid #b9c4d1;
  border-radius: 9px;
  background: #ffffff;
  padding: 9px 12px;
  color: #263342;
  font-size: 13px;
}

.toast.success {
  border-color: #47916c;
  background: #f5fbf7;
}

.toast.error {
  border-color: #c85656;
  background: #fff7f7;
}
</style>
