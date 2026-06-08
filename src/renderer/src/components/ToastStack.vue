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
  border: 1px solid var(--border-strong);
  border-radius: 9px;
  background: var(--surface-raised);
  padding: 9px 12px;
  color: var(--text-primary);
  font-size: 13px;
}

.toast.success {
  border-color: var(--success-border);
  background: var(--success-soft);
}

.toast.error {
  border-color: var(--danger-solid);
  background: var(--danger-soft);
}
</style>
