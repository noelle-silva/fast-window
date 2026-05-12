import { ClipboardHistoryRpc } from '../shared/rpcMethods'
import { createDirectBackgroundClient } from '../ui/directClient'
import type { ClipboardHistoryGateway } from './types'

export async function createDirectBackgroundGateway(loadEndpoint: () => Promise<any>): Promise<Omit<ClipboardHistoryGateway, 'host'>> {
  const client = await createDirectBackgroundClient(loadEndpoint)
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
      outputImageUrl: (reference, cacheKey) => validateImageEndpoint(client.endpoint()).outputImageUrl(reference, cacheKey),
      scanOrphanImages: () => client.invoke(ClipboardHistoryRpc.images.scanOrphans),
      deleteOrphanImages: () => client.invoke(ClipboardHistoryRpc.images.deleteOrphans),
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
    legacy: {
      importData: sourceDir => client.invoke(ClipboardHistoryRpc.legacy.importData, { sourceDir }),
    },
    onSnapshot: listener => client.onEvent(event => {
      if (event.type === 'event' && event.event === 'snapshot') listener(event.snapshot as any)
    }),
    close: () => client.close(),
  }
}

function validateImageEndpoint(endpoint: any) {
  if (!endpoint || typeof endpoint !== 'object') throw new Error('剪贴板历史后台 endpoint 不完整')
  const imageBaseUrl = String(endpoint.imageBaseUrl || '')
  const token = String(endpoint.token || '')
  if (!/^http:\/\/127\.0\.0\.1:\d+\/images$/i.test(imageBaseUrl) || !token) {
    throw new Error('剪贴板历史图片服务 endpoint 不完整')
  }
  return {
    outputImageUrl(reference: string, cacheKey?: string | number) {
      const ref = String(reference || '').trim()
      if (!ref) return ''
      const query = new URLSearchParams({ ref, token })
      if (cacheKey !== undefined && cacheKey !== null && String(cacheKey).trim()) query.set('v', String(cacheKey))
      return `${imageBaseUrl}?${query.toString()}`
    },
  }
}
