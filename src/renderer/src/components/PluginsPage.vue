<script setup lang="ts">
import { computed, ref } from 'vue'
import { MdClose, MdExtension, MdPowerSettingsNew, MdSettings } from 'vue-icons-plus/md'
import type { PluginDescriptor } from '../../../shared/types'
import { useProjectWorkbench } from '../composables/useProjectWorkbench'
import PluginFrame from './PluginFrame.vue'

const { plugins, project, saveProjectConfig, showToast } = useProjectWorkbench()
const selectedPlugin = ref<PluginDescriptor | null>(null)

const enabledPluginIds = computed(() => new Set(project.value?.config.plugins.enabledPluginIds ?? []))
const pluginById = computed(() => new Map(plugins.value.map(plugin => [plugin.manifest.id, plugin])))

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

function missingDependencyIds(plugin: PluginDescriptor): string[] {
  if (!isEnabled(plugin)) return []

  const missing = new Set<string>()
  const visited = new Set<string>()
  const visiting = new Set<string>()

  const visit = (pluginId: string) => {
    if (visited.has(pluginId) || visiting.has(pluginId)) return
    visiting.add(pluginId)

    const descriptor = pluginById.value.get(pluginId)
    for (const dependencyId of descriptor?.manifest.dependencies ?? []) {
      const dependency = pluginById.value.get(dependencyId)
      if (!dependency || !enabledPluginIds.value.has(dependencyId)) {
        missing.add(dependencyId)
        continue
      }
      visit(dependencyId)
    }

    visiting.delete(pluginId)
    visited.add(pluginId)
  }

  visit(plugin.manifest.id)
  return [...missing].sort()
}

function hasMissingDependencies(plugin: PluginDescriptor): boolean {
  return missingDependencyIds(plugin).length > 0
}

function dependencyTooltip(plugin: PluginDescriptor): string | undefined {
  const ids = missingDependencyIds(plugin)
  return ids.length ? ids.join(', ') : undefined
}

function pluginStatusLabel(plugin: PluginDescriptor): string {
  if (!isEnabled(plugin)) return '已禁用'
  return hasMissingDependencies(plugin) ? '依赖缺失' : '已启用'
}

function canOpenSettings(plugin: PluginDescriptor): boolean {
  return isEnabled(plugin) && Boolean(plugin.manifest.entry?.settingsHtml)
}

async function togglePlugin(plugin: PluginDescriptor) {
  const current = new Set(project.value?.config.plugins.enabledPluginIds ?? [])
  if (current.has(plugin.manifest.id)) current.delete(plugin.manifest.id)
  else current.add(plugin.manifest.id)
  const ok = await saveProjectConfig({ plugins: { enabledPluginIds: [...current] } })
  if (ok) showToast(`${pluginName(plugin)} ${current.has(plugin.manifest.id) ? '已启用' : '已禁用'}`, 'success')
}

function openPluginSettings(plugin: PluginDescriptor) {
  if (!canOpenSettings(plugin)) return
  selectedPlugin.value = plugin
}

function closePlugin() {
  selectedPlugin.value = null
}
</script>

<template>
  <section class="plugins-page">
    <section v-if="selectedPlugin" class="plugin-settings-page">
      <header class="plugin-settings-header">
        <div>
          <h2>{{ pluginName(selectedPlugin) }}</h2>
          <p>{{ selectedPlugin.manifest.id }} · {{ pluginVersion(selectedPlugin) }}</p>
        </div>
        <button class="toolbar-button" type="button" aria-label="关闭" data-tooltip="关闭" @click="closePlugin">
          <MdClose class="toolbar-icon" aria-hidden="true" />
        </button>
      </header>

      <div class="plugin-settings-body">
        <PluginFrame
          v-if="selectedPlugin.manifest.entry?.settingsHtml"
          :plugin-id="selectedPlugin.manifest.id"
          :html-path="selectedPlugin.manifest.entry.settingsHtml"
        />
      </div>
    </section>

    <template v-else>
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
            <span
              class="plugin-status"
              :class="{ enabled: isEnabled(plugin) && !hasMissingDependencies(plugin), missing: hasMissingDependencies(plugin) }"
              :data-tooltip="dependencyTooltip(plugin)"
            >
              {{ pluginStatusLabel(plugin) }}
            </span>
            <button
              v-if="canOpenSettings(plugin)"
              class="plugin-settings-button"
              type="button"
              :aria-label="`打开 ${pluginName(plugin)} 设置`"
              data-tooltip="设置"
              @click="openPluginSettings(plugin)"
            >
              <MdSettings class="plugin-settings-icon" aria-hidden="true" />
            </button>
            <button
              class="plugin-toggle"
              type="button"
              :aria-label="`${isEnabled(plugin) ? '禁用' : '启用'} ${pluginName(plugin)}`"
              :data-tooltip="isEnabled(plugin) ? '禁用' : '启用'"
              @click="togglePlugin(plugin)"
            >
              <MdPowerSettingsNew class="plugin-toggle-icon" aria-hidden="true" />
            </button>
          </span>
        </article>

        <p v-if="!plugins.length" class="empty-note">当前项目还没有插件。</p>
      </div>
    </template>
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
.plugin-settings-header h2 {
  margin: 0;
  color: #243041;
  font-size: 16px;
}

.plugins-header p,
.plugin-settings-header p {
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

.plugin-status.missing {
  position: relative;
  background: #fde7e7;
  color: #b42323;
}

.plugin-status.missing::after {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 20;
  max-width: min(320px, 70vw);
  pointer-events: none;
  content: attr(data-tooltip);
  opacity: 0;
  transform: translateY(2px);
  border-radius: 4px;
  background: #30343a;
  padding: 6px 8px;
  color: #ffffff;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.35;
  white-space: normal;
  box-shadow: 0 2px 8px rgba(32, 36, 42, 0.2);
  transition: opacity 120ms ease, transform 120ms ease;
}

.plugin-status.missing:hover::after {
  opacity: 1;
  transform: translateY(0);
}

.plugin-toggle,
.plugin-settings-button {
  position: relative;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #506176;
}

.plugin-toggle {
  margin-left: auto;
}

.plugin-toggle:hover,
.plugin-settings-button:hover {
  background: #e9eef5;
}

.plugin-toggle::after,
.plugin-settings-button::after {
  position: absolute;
  top: calc(100% + 7px);
  right: 0;
  z-index: 20;
  pointer-events: none;
  content: attr(data-tooltip);
  opacity: 0;
  transform: translateY(-2px);
  border-radius: 4px;
  background: #30343a;
  padding: 5px 8px;
  color: #ffffff;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(32, 36, 42, 0.2);
  transition: opacity 120ms ease, transform 120ms ease;
}

.plugin-toggle:hover::after,
.plugin-toggle:focus-visible::after,
.plugin-settings-button:hover::after,
.plugin-settings-button:focus-visible::after {
  opacity: 1;
  transform: translateY(0);
}

.plugin-toggle-icon,
.plugin-settings-icon {
  width: 18px;
  height: 18px;
}

.empty-note {
  padding: 12px 6px;
  color: #8290a3;
  font-size: 12px;
}

.plugin-settings-page {
  grid-row: 1 / -1;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  background: #ffffff;
}

.plugin-settings-header {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid #edf0f4;
  padding: 10px 12px;
}

.plugin-settings-body {
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
