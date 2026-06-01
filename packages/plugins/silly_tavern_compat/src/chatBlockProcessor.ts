import { mergeVirtualBlocks, type PluginProcessorState, type PluginRuntimeContext } from '@st-forge/plugin-api'
import { loadSillyTavernCompatData } from './data'
import { buildSillyTavernLikePrompt } from './st-prompt-builder'

export default function chatBlockProcessor(context: PluginRuntimeContext) {
  return {
    async process(state: PluginProcessorState) {
      const data = await loadSillyTavernCompatData(context.api.storage, state.chat, context.api.chat.getPluginData())
      const prompt = buildSillyTavernLikePrompt({
        chat: {
          ...state.chat,
          runtimeConfig: data.runtimeConfig
        },
        characters: data.characters,
        loreBooks: data.loreBooks,
        worldEntries: data.worldEntries,
        blocks: state.blocks
      })
      return {
        blocks: mergeVirtualBlocks(state.blocks, prompt.virtualBlocks),
        messages: prompt.messages,
        virtualBlocks: prompt.virtualBlocks,
        metadata: {
          sillyTavernCompat: {
            characterId: data.runtimeConfig.characterId,
            loreBookIds: data.runtimeConfig.loreBookIds
          }
        }
      }
    }
  }
}
