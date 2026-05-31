import type { PluginRuntimeContext } from '@st-forge/plugin-api'

export default function initChat(context: PluginRuntimeContext) {
  return { id: context.plugin.id, chatId: context.chat?.id ?? null }
}
