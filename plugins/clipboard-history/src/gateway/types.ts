import type {
  ClipboardHistoryItem,
  ClipboardHistorySettings,
  ClipboardHistorySnapshot,
  CollectionsDoc,
  DeletedHistoryMap,
} from '../shared/types'

export type HostGateway = {
  toast(message: string): Promise<void>
  back(): Promise<void>
  startDragging(): Promise<void>
}

export type ClipboardGateway = {
  writeText(text: string): Promise<ClipboardHistorySnapshot>
  writeImage(dataUrlOrRequest: string | { dataUrl?: string; path?: string }): Promise<ClipboardHistorySnapshot>
}

export type ImageGateway = {
  readOutputImage(path: string): Promise<string>
  deleteOutputImage(path: string): Promise<void>
}

export type ClipboardHistoryStateGateway = {
  load(): Promise<ClipboardHistorySnapshot>
  saveSettings(settings: ClipboardHistorySettings): Promise<ClipboardHistorySnapshot>
  clearHistory(): Promise<ClipboardHistorySnapshot>
  deleteHistoryItem(item: ClipboardHistoryItem): Promise<ClipboardHistorySnapshot>
}

export type ClipboardHistoryCollectionsGateway = {
  createFolder(parentId: string, name: string): Promise<ClipboardHistorySnapshot>
  createItem(parentId: string, title: string, content: string): Promise<ClipboardHistorySnapshot>
  updateFolder(folderId: string, name: string): Promise<ClipboardHistorySnapshot>
  updateItem(itemId: string, title: string, content: string): Promise<ClipboardHistorySnapshot>
  moveNode(movingId: string, toParentId: string, toIndex?: number): Promise<ClipboardHistorySnapshot>
  copyItem(itemId: string, toParentId: string): Promise<ClipboardHistorySnapshot>
  deleteNode(nodeId: string): Promise<ClipboardHistorySnapshot>
  saveRecentFolder(folderId: string): Promise<ClipboardHistorySnapshot>
}

export type StorageGateway = {
  loadHistory(): Promise<ClipboardHistoryItem[] | null>
  saveHistory(items: ClipboardHistoryItem[]): Promise<void>
  loadSettings(): Promise<Partial<ClipboardHistorySettings> | null>
  saveSettings(settings: ClipboardHistorySettings): Promise<void>
  loadDeletedHistory(): Promise<DeletedHistoryMap | null>
  saveDeletedHistory(deleted: DeletedHistoryMap): Promise<void>
  loadCollections(): Promise<CollectionsDoc | null>
  saveCollections(collections: CollectionsDoc): Promise<void>
  loadRecentFolders(): Promise<string[] | null>
  saveRecentFolders(folderIds: string[]): Promise<void>
}

export type MonitorGateway = {
  startClipboardWatch(payload: { intervalMs: number; maxHistory: number }): Promise<{ id: string } | null>
  getTask(taskId: string): Promise<{ id: string; status: string; result?: unknown } | null>
  cancelTask(taskId: string): Promise<void>
}

export type ClipboardHistoryGateway = {
  host: HostGateway
  state: ClipboardHistoryStateGateway
  collections: ClipboardHistoryCollectionsGateway
  clipboard: ClipboardGateway
  images: ImageGateway
  storage: StorageGateway
  monitor: MonitorGateway
  close(): void
}
