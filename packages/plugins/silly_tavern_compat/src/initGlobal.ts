import { applyToolInput, entryTitle, normalizeWorldEntry } from './data'
import { testWorldEntryActivations } from './st-prompt-builder'

export default function initGlobal() {
  return {
    applyToolInput,
    entryTitle,
    normalizeWorldEntry,
    testWorldEntryActivations
  }
}
