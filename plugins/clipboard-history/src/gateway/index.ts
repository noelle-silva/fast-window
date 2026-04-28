import { createDirectBackgroundGateway } from './directBackgroundGateway'
import { createHostGateway } from './hostGateway'
import type { ClipboardHistoryGateway } from './types'

export async function createClipboardHistoryGateway(baseApi: any): Promise<ClipboardHistoryGateway> {
  const background = await createDirectBackgroundGateway(baseApi)
  let cached = await background.state.load()
  return {
    host: createHostGateway(baseApi),
    state: {
      load: async () => (cached = await background.state.load()),
      saveSettings: async settings => (cached = await background.state.saveSettings(settings)),
      clearHistory: async () => (cached = await background.state.clearHistory()),
      deleteHistoryItem: async item => (cached = await background.state.deleteHistoryItem(item)),
    },
    collections: background.collections,
    clipboard: background.clipboard,
    images: background.images,
    storage: {
      loadHistory: async () => cached.history,
      saveHistory: async () => { cached = await background.state.load() },
      loadSettings: async () => cached.settings,
      saveSettings: async settings => { cached = await background.state.saveSettings(settings) },
      loadDeletedHistory: async () => cached.deleted,
      saveDeletedHistory: async () => { cached = await background.state.load() },
      loadCollections: async () => cached.collections,
      saveCollections: async () => { cached = await background.state.load() },
      loadRecentFolders: async () => cached.recentFolders,
      saveRecentFolders: async () => { cached = await background.state.load() },
    },
    monitor: {
      startClipboardWatch: async () => {
        cached = await background.state.load()
        return { id: 'direct-monitor' }
      },
      getTask: async () => ({ id: 'direct-monitor', status: 'running', result: await background.state.load() }),
      cancelTask: async () => {},
    },
    close: background.close,
  }
}
