<script setup lang="ts">
import { computed, ref } from 'vue'
import { MdClose, MdExtension, MdPowerSettingsNew } from 'vue-icons-plus/md'
import type { PluginDescriptor } from '../../../shared/types'
import { useProjectWorkbench } from '../composables/useProjectWorkbench'
import PluginFrame from './PluginFrame.vue'

const { plugins, project, saveProjectConfig, showToast } = useProjectWorkbench()
const selectedPlugin = ref<PluginDescriptor | null>(null)

const enabledPluginIds = computed(() => new Set(project.value?.config.plugins.enabledPluginIds ?? []))

function pluginName(plugin: PluginDescriptor): string {
  return plugin.manifest.name || plugin.manifest.id
}

function pluginDescription(plugin: PluginDescriptor): string {
  return plugin.manifest.description || '未提供描述。'
}

function pluginVersion(plugin: PluginDescriptor): string {
  return `v${plugin.manifest.versionCode}`
}

function isEnabled(plugin: PluginDescriptor): boolean {
  return enabledPluginIds.value.has(plugin.manifest.id)
}

async function togglePlugin(plugin: PluginDescriptor) {
  const current = new Set(project.value?.config.plugins.enabledPluginIds ?? [])
  if (current.has(plugin.manifest.id)) current.delete(plugin.manifest.id)
  else current.add(plugin.manifest.id)
  const ok = await saveProjectConfig({ plugins: { enabledPluginIds: [...current] } })
  if (ok) showToast(`${pluginName(plugin)} ${current.has(plugin.manifest.id) ? '已启用' : '已禁用'}`, 'success')
}

function openPlugin(plugin: PluginDescriptor) {
  selectedPlugin.value = plugin
}

function closePlugin() {
  selectedPlugin.value = null
}
</script>

<template>
  <section class="plugins-page">
    <header class="plugins-header">
      <div>
        <h2>插件</h2>
        <p>{{ plugins.length }} 个项目插件</p>
      </div>
    </header>

    <div class="plugin-grid">
      <article
        v-for="plugin in plugins"
        :key="plugin.manifest.id"
        class="plugin-card"
        role="button"
        tabindex="0"
        @click="openPlugin(plugin)"
        @keydown.enter.prevent="openPlugin(plugin)"
        @keydown.space.prevent="openPlugin(plugin)"
      >
        <span class="plugin-icon-shell">
          <MdExtension class="plugin-icon" aria-hidden="true" />
        </span>
        <span class="plugin-card-copy">
          <strong>{{ pluginName(plugin) }}</strong>
          <span class="plugin-id">{{ plugin.manifest.id }}</span>
          <span class="plugin-description">{{ pluginDescription(plugin) }}</span>
        </span>
        <span class="plugin-card-footer">
          <span class="plugin-version">{{ pluginVersion(plugin) }}</span>
          <span class="plugin-status" :class="{ enabled: isEnabled(plugin) }">
            {{ isEnabled(plugin) ? '已启用' : '已禁用' }}
          </span>
          <button
            class="plugin-toggle"
            type="button"
            :aria-label="`${isEnabled(plugin) ? '禁用' : '启用'} ${pluginName(plugin)}`"
            :data-tooltip="isEnabled(plugin) ? '禁用' : '启用'"
            @click.stop="togglePlugin(plugin)"
          >
            <MdPowerSettingsNew class="plugin-toggle-icon" aria-hidden="true" />
          </button>
        </span>
      </article>

      <p v-if="!plugins.length" class="empty-note">当前项目还没有插件。</p>
    </div>

    <Teleport to="body">
      <div v-if="selectedPlugin" class="plugin-modal" role="dialog" aria-modal="true" @click.self="closePlugin">
        <section class="plugin-panel">
          <header class="plugin-panel-header">
            <div>
              <h2>{{ pluginName(selectedPlugin) }}</h2>
              <p>{{ selectedPlugin.manifest.id }} · {{ pluginVersion(selectedPlugin) }}</p>
            </div>
            <button class="toolbar-button" type="button" aria-label="关闭" data-tooltip="关闭" @click="closePlugin">
              <MdClose class="toolbar-icon" aria-hidden="true" />
            </button>
          </header>

          <div class="plugin-panel-body">
            <PluginFrame
              v-if="selectedPlugin.manifest.entry?.settingsHtml"
              :plugin-id="selectedPlugin.manifest.id"
              :html-path="selectedPlugin.manifest.entry.settingsHtml"
            />
            <p v-else class="empty-note">这个插件没有提供设置页面。</p>
          </div>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.plugins-page {
  height: 100%;
  min-width: 0;
  overflow: auto;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  background: #ffffff;
}

.plugins-header {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid #edf0f4;
  padding: 12px 16px;
}

.plugins-header h2,
.plugin-panel-header h2 {
  margin: 0;
  color: #243041;
  font-size: 16px;
}

.plugins-header p,
.plugin-panel-header p {
  margin: 3px 0 0;
  color: #6d7989;
  font-size: 12px;
}

.plugin-grid {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  align-content: start;
  gap: 10px;
  padding: 14px;
}

.plugin-card {
  min-width: 0;
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 10px;
  border: 1px solid #d9e0e9;
  border-radius: 8px;
  background: #ffffff;
  color: #243041;
  padding: 12px;
  text-align: left;
}

.plugin-card:hover {
  border-color: #b8c5d4;
  background: #f8fafc;
}

.plugin-icon-shell {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: #e9f1fb;
  color: #245a9f;
}

.plugin-icon {
  width: 22px;
  height: 22px;
}

.plugin-card-copy {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.plugin-card-copy strong,
.plugin-id,
.plugin-description {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.plugin-card-copy strong {
  white-space: nowrap;
  font-size: 14px;
}

.plugin-id {
  color: #607086;
  font: 12px/1.4 "SF Mono", "Cascadia Code", "Roboto Mono", ui-monospace, Menlo, Monaco, Consolas, monospace;
  white-space: nowrap;
}

.plugin-description {
  min-height: 34px;
  color: #4f5d70;
  display: -webkit-box;
  font-size: 12px;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.plugin-card-footer {
  grid-column: 1 / -1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: 1px solid #edf0f4;
  padding-top: 10px;
}

.plugin-version,
.plugin-status {
  border-radius: 999px;
  background: #f1f4f8;
  color: #5d6c7f;
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 600;
}

.plugin-status.enabled {
  background: #e3f4ea;
  color: #237248;
}

.plugin-toggle {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #506176;
  margin-left: auto;
}

.plugin-toggle:hover {
  background: #e9eef5;
}

.plugin-toggle-icon {
  width: 18px;
  height: 18px;
}

.empty-note {
  padding: 12px 6px;
  color: #8290a3;
  font-size: 12px;
}

.plugin-modal {
  position: fixed;
  inset: 0;
  z-index: 180;
  display: grid;
  place-items: center;
  background: rgba(25, 31, 39, 0.34);
  padding: 24px;
}

.plugin-panel {
  width: min(980px, 94vw);
  height: min(760px, 88vh);
  min-width: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 18px 50px rgba(26, 33, 42, 0.26);
}

.plugin-panel-header {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid #edf0f4;
  padding: 10px 12px;
}

.plugin-panel-body {
  min-width: 0;
  min-height: 0;
  display: grid;
  overflow: hidden;
}

@media (max-width: 700px) {
  .plugin-grid {
    grid-template-columns: 1fr;
  }
}
</style>
