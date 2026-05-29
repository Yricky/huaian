<script setup lang="ts">
import type { Component } from 'vue'
import { MdChat, MdMenuBook, MdPerson, MdSettings } from 'vue-icons-plus/md'
import type { SidebarView } from '@/shared/types'
import { useProjectWorkbench } from '../composables/useProjectWorkbench'

const { activeView } = useProjectWorkbench()

interface NavItem {
  view: SidebarView
  label: string
  icon: Component
}

const navItems: NavItem[] = [
  { view: 'characters', label: '角色卡', icon: MdPerson },
  { view: 'worldBooks', label: '世界书', icon: MdMenuBook },
  { view: 'chat', label: '聊天', icon: MdChat },
  { view: 'settings', label: '设置', icon: MdSettings }
]
</script>

<template>
  <aside class="sidebar" aria-label="主导航">
    <button v-for="item in navItems" :key="item.view" class="sidebar-nav-item"
      :class="{ active: activeView === item.view }" :aria-current="activeView === item.view ? 'page' : undefined"
      @click="activeView = item.view">
      <span class="sidebar-icon-shell">
        <component :is="item.icon" class="sidebar-icon" aria-hidden="true" />
      </span>
      <span class="sidebar-label">{{ item.label }}</span>
    </button>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  border-right: 1px solid #d8dee7;
  background: #f8fafc;
}

.sidebar-nav-item {
  width: 72px;
  min-height: 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  text-align: center;
  border: 0;
  border-radius: 18px;
  background: transparent;
  color: #465465;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
  transition: color 140ms ease, background 140ms ease;
}

.sidebar-nav-item:hover {
  color: #233246;
}

.sidebar-nav-item:focus-visible {
  outline: 2px solid #446bd7;
  outline-offset: 2px;
}

.sidebar-nav-item.active {
  color: #173e85;
}

.sidebar-icon-shell {
  width: 56px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 16px;
  transition: background 140ms ease;
}

.sidebar-nav-item:hover .sidebar-icon-shell {
  background: #edf2f8;
}

.sidebar-nav-item.active .sidebar-icon-shell {
  background: #dce6ff;
}

.sidebar-icon {
  width: 24px;
  height: 24px;
}

.sidebar-label {
  width: 100%;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

@media (max-width: 980px) {
  .sidebar-nav-item {
    width: 72px;
  }
}
</style>
