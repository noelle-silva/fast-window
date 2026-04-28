import { ClipboardHistoryRpc } from '../shared/rpcMethods'
import { createDirectBackgroundClient } from '../ui/directClient'
import type { ClipboardHistoryGateway } from './types'

export async function createDirectBackgroundGateway(baseApi: any): Promise<Omit<ClipboardHistoryGateway, 'host' | 'storage' | 'monitor'>> {
  const client = await createDirectBackgroundClient(baseApi)
  return {
    state: {
      load: () => client.invoke(ClipboardHistoryRpc.state.load),
      saveSettings: settings => client.invoke(ClipboardHistoryRpc.state.saveSettings, { settings }),
      clearHistory: () => client.invoke(ClipboardHistoryRpc.state.clearHistory),
      deleteHistoryItem: item => client.invoke(ClipboardHistoryRpc.state.deleteHistoryItem, { item }),
    },
    clipboard: {
      writeText: text => client.invoke(ClipboardHistoryRpc.clipboard.writeText, { text }),
      writeImage: req => client.invoke(ClipboardHistoryRpc.clipboard.writeImage, typeof req === 'string' ? { dataUrl: req } : req),
    },
    images: {
      readOutputImage: path => client.invoke(ClipboardHistoryRpc.images.readOutput, { path }),
      deleteOutputImage: async () => {},
    },
    collections: {
      createFolder: (parentId, name) => client.invoke(ClipboardHistoryRpc.collections.createFolder, { parentId, name }),
      createItem: (parentId, title, content) => client.invoke(ClipboardHistoryRpc.collections.createItem, { parentId, title, content }),
      updateFolder: (folderId, name) => client.invoke(ClipboardHistoryRpc.collections.updateFolder, { folderId, name }),
      updateItem: (itemId, title, content) => client.invoke(ClipboardHistoryRpc.collections.updateItem, { itemId, title, content }),
      moveNode: (movingId, toParentId, toIndex) => client.invoke(ClipboardHistoryRpc.collections.moveNode, { movingId, toParentId, toIndex }),
      copyItem: (itemId, toParentId) => client.invoke(ClipboardHistoryRpc.collections.copyItem, { itemId, toParentId }),
      deleteNode: nodeId => client.invoke(ClipboardHistoryRpc.collections.deleteNode, { nodeId }),
      saveRecentFolder: folderId => client.invoke(ClipboardHistoryRpc.collections.saveRecentFolder, { folderId }),
    },
    onSnapshot: listener => client.onEvent(event => {
      if (event.type === 'event' && event.event === 'snapshot') listener(event.snapshot as any)
    }),
    close: () => client.close(),
  }
}
