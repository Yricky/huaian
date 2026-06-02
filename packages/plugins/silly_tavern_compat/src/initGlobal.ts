import type { PluginGlobalExport, PluginRuntimeContext } from '@huaian/plugin-api'
import { applyToolInput, entryTitle, normalizeWorldEntry } from './data'
import { testWorldEntryActivations } from './st-prompt-builder'
import chatBlockProcessor from './chatBlockProcessor'

export default function initGlobal(context: PluginRuntimeContext): PluginGlobalExport {
  return {
    chatBlockProcessor: chatBlockProcessor(context),
    exports: {
      applyToolInput,
      entryTitle,
      normalizeWorldEntry,
      testWorldEntryActivations
    }
  }
}
