import type { PluginGlobalExport, PluginGlobalRegistry, PluginRuntimeContext } from '@st-forge/plugin-api'
import handler from './handler'

export default function initGlobal(context: PluginRuntimeContext, plugins: PluginGlobalRegistry): PluginGlobalExport {
  return {
    toolCalls: {
      lorebook_edit: handler(context, plugins)
    },
    exports: {
      id: context.plugin.id
    }
  }
}
