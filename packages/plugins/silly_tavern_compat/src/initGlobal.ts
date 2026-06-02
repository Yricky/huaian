import type { PluginGlobalExport, PluginRuntimeContext } from '@huaian/plugin-api'
import { applyToolInput, entryTitle, normalizeWorldEntry } from './data'
import { testWorldEntryActivations } from './st-prompt-builder'
import chatBlockProcessor from './chatBlockProcessor'
import { worldbookEditToolHandler } from './worldbookTool'

export default function initGlobal(context: PluginRuntimeContext): PluginGlobalExport {
  return {
    chatBlockProcessor: chatBlockProcessor(context),
    toolCalls: {
      lorebook_edit: worldbookEditToolHandler(context)
    },
    exports: {
      applyToolInput,
      entryTitle,
      normalizeWorldEntry,
      testWorldEntryActivations
    }
  }
}
