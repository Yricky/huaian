import type { PluginRuntimeContext } from '@st-forge/plugin-api'

export default function initGlobal(context: PluginRuntimeContext) {
  return { id: context.plugin.id }
}
