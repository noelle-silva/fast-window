import {
  createFolder,
  createItem,
  deleteNode,
  getNode,
  isFolder,
  moveNode,
  updateFolderName,
  updateItem,
  ensureCollections,
} from '../shared/collectionsDomain'
import {
  createEmptyInternalCopyMarker,
  createInternalCopyMarker,
  historyUniqKey,
  isDeleted,
  isWithinInternalCopyWindow,
  mergeHistoryItems,
  normalizeDeletedMap,
  normalizeHistoryItems,
  normalizeSettings,
} from '../shared/historyDomain'
import { isDataUrl } from '../shared/imagePaths'
import { ClipboardHistoryRpc } from '../shared/rpcMethods'
import type { ClipboardHistoryItem, ClipboardHistorySnapshot, CollectionsDoc, DeletedHistoryMap, InternalCopyMarker } from '../shared/types'
import { deleteManagedImagesForHistory, deleteManagedOutputImage, readOutputImage } from './imageStore'
import { createClipboardMonitor, type ClipboardMonitor } from './clipboardMonitor'
import { writeImage, writeText } from './clipboardWriter'
import type { ClipboardHistoryStore } from './store'
import { log } from './directServer'

export function createClipboardHistoryService(store: ClipboardHistoryStore) {
  let history: ClipboardHistoryItem[] = []
  let settings = normalizeSettings(null)
  let deleted: DeletedHistoryMap = {}
  let collections: CollectionsDoc = ensureCollections(null)
  let recentFolders: string[] = []
  let internalCopy: InternalCopyMarker = createEmptyInternalCopyMarker()
  let currentText = ''
  let currentImage = ''
  let monitor: ClipboardMonitor | null = null

  function snapshot(): ClipboardHistorySnapshot {
    return { history, settings, deleted, collections, recentFolders }
  }

  async function saveClipboard() {
    await store.saveHistory(history)
    await store.saveSettings(settings)
    await store.saveDeletedHistory(deleted)
  }

  async function saveCollectionsState() {
    await store.saveCollections(collections)
    await store.saveRecentFolders(recentFolders)
  }

  async function handleMonitorChange(item: ClipboardHistoryItem) {
    if (internalCopy.at && isWithinInternalCopyWindow(internalCopy, settings.pollInterval) && internalCopy.type === item.type) {
      internalCopy = createEmptyInternalCopyMarker()
      if (item.type === 'text') currentText = item.content
      if (item.type === 'image') currentImage = item.content
      return
    }
    if (internalCopy.at && !isWithinInternalCopyWindow(internalCopy, settings.pollInterval)) internalCopy = createEmptyInternalCopyMarker()
    if (isDeleted(item, deleted)) return
    if (item.type === 'text') {
      if (item.content === currentText) return
      currentText = item.content
    }
    if (item.type === 'image') {
      if (item.content === currentImage) return
      currentImage = item.content
    }
    history = mergeHistoryItems([item], history, settings.maxHistory)
    await saveClipboard()
  }

  async function warmup() {
    await store.ensureStorageReady()
    settings = normalizeSettings(await store.loadSettings())
    history = normalizeHistoryItems(await store.loadHistory(), settings.maxHistory)
    deleted = normalizeDeletedMap(await store.loadDeletedHistory())
    history = history.filter(item => !isDeleted(item, deleted))
    collections = ensureCollections(await store.loadCollections())
    const savedRecent = await store.loadRecentFolders()
    recentFolders = Array.isArray(savedRecent) ? savedRecent.filter(id => typeof id === 'string') : []
    currentText = history.find(item => item.type === 'text')?.content || ''
    currentImage = history.find(item => item.type === 'image')?.content || ''
    monitor = createClipboardMonitor({ settings, onChange: handleMonitorChange, log })
    if (settings.autoMonitor) monitor.start()
    await saveClipboard()
    await saveCollectionsState()
  }

  async function applySettings(raw: unknown) {
    settings = normalizeSettings(raw)
    history = normalizeHistoryItems(history, settings.maxHistory)
    monitor?.restart(settings)
    await saveClipboard()
    return snapshot()
  }

  async function deleteHistoryItem(item: ClipboardHistoryItem) {
    if (!item || !item.content) return snapshot()
    deleted = normalizeDeletedMap({ ...deleted, [historyUniqKey(item)]: Date.now() })
    history = history.filter(entry => historyUniqKey(entry) !== historyUniqKey(item))
    if (item.type === 'image') await deleteManagedOutputImage(item.path || item.content)
    await saveClipboard()
    return snapshot()
  }

  async function copyHistoryItem(item: ClipboardHistoryItem) {
    internalCopy = createInternalCopyMarker(item.type, item.content)
    if (item.type === 'image') await writeImage(isDataUrl(item.content) ? { dataUrl: item.content } : { path: item.path || item.content })
    else await writeText(item.content)
    history = mergeHistoryItems([{ ...item, time: Date.now() }], history, settings.maxHistory)
    await saveClipboard()
    return snapshot()
  }

  async function dispatch(method: string, params: any): Promise<unknown> {
    if (method === ClipboardHistoryRpc.state.load) return snapshot()
    if (method === ClipboardHistoryRpc.state.saveSettings) return applySettings(params?.settings)
    if (method === ClipboardHistoryRpc.state.clearHistory) {
      await deleteManagedImagesForHistory(history)
      history = []
      await saveClipboard()
      return snapshot()
    }
    if (method === ClipboardHistoryRpc.state.deleteHistoryItem) return deleteHistoryItem(params?.item)
    if (method === ClipboardHistoryRpc.clipboard.writeText) {
      const text = String(params?.text || '')
      internalCopy = createInternalCopyMarker('text', text)
      await writeText(text)
      history = mergeHistoryItems([{ type: 'text', content: text, time: Date.now() }], history, settings.maxHistory)
      await saveClipboard()
      return snapshot()
    }
    if (method === ClipboardHistoryRpc.clipboard.writeImage) return copyHistoryItem({ type: 'image', content: params?.dataUrl || params?.path || '', path: params?.path, time: Date.now() })
    if (method === ClipboardHistoryRpc.images.readOutput) return readOutputImage(String(params?.path || ''))
    if (method === ClipboardHistoryRpc.collections.createFolder) createFolder(collections, String(params?.parentId || ''), String(params?.name || ''))
    else if (method === ClipboardHistoryRpc.collections.createItem) createItem(collections, String(params?.parentId || ''), String(params?.title || ''), String(params?.content || ''))
    else if (method === ClipboardHistoryRpc.collections.updateFolder) updateFolderName(collections, String(params?.folderId || ''), String(params?.name || ''))
    else if (method === ClipboardHistoryRpc.collections.updateItem) updateItem(collections, String(params?.itemId || ''), String(params?.title || ''), String(params?.content || ''))
    else if (method === ClipboardHistoryRpc.collections.moveNode) moveNode(collections, String(params?.movingId || ''), String(params?.toParentId || ''), Number(params?.toIndex))
    else if (method === ClipboardHistoryRpc.collections.copyItem) {
      const item = getNode(collections, String(params?.itemId || ''))
      if (item && item.type === 'item') createItem(collections, String(params?.toParentId || ''), item.title, item.content)
    } else if (method === ClipboardHistoryRpc.collections.deleteNode) deleteNode(collections, String(params?.nodeId || ''))
    else if (method === ClipboardHistoryRpc.collections.saveRecentFolder) {
      const folderId = String(params?.folderId || '')
      if (folderId && isFolder(collections, folderId)) recentFolders = [folderId, ...recentFolders.filter(id => id !== folderId)].slice(0, 10)
    } else if (method === ClipboardHistoryRpc.monitor.restart) {
      monitor?.restart(settings)
      return snapshot()
    } else if (method === ClipboardHistoryRpc.monitor.snapshot) {
      return monitor?.snapshot() || {}
    } else {
      throw new Error(`未知方法：${method}`)
    }
    await saveCollectionsState()
    return snapshot()
  }

  return { warmup, snapshot, dispatch }
}
