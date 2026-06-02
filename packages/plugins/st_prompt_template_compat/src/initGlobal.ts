import type { PluginGlobalExport, PluginRuntimeContext } from '@st-forge/plugin-api'
import chatBlockProcessor from './chatBlockProcessor'

export default function initGlobal(context: PluginRuntimeContext): PluginGlobalExport {
  return {
    chatBlockProcessor: chatBlockProcessor(context),
    exports: {
      id: context.plugin.id
    }
  }
}
