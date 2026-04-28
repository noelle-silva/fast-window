import type {
  ClipboardHistoryItem,
  ClipboardHistorySettings,
  ClipboardHistorySnapshot,
  ClipboardWatchPayload,
  ClipboardWatchTask,
  CollectionsDoc,
  DeletedHistoryMap,
} from '../shared/types'

export type HostGateway = {
  toast(message: string): Promise<void>
  back(): Promise<void>
  startDragging(): Promise<void>
}

export type ClipboardGateway = {
  writeText(text: string): Promise<void>
  writeImage(dataUrl: string): Promise<void>
}

export type ImageGateway = {
  readOutputImage(path: string): Promise<string>
  deleteOutputImage(path: string): Promise<void>
}

export type ClipboardHistoryStateGateway = {
  loadState(): Promise<ClipboardHistorySnapshot>
  saveSettings(settings: ClipboardHistorySettings): Promise<ClipboardHistorySnapshot>
  clearHistory(): Promise<ClipboardHistorySnapshot>
  deleteHistoryItem(item: ClipboardHistoryItem): Promise<ClipboardHistorySnapshot>
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
  listRecentTasks(limit: number): Promise<ClipboardWatchTask[]>
  startClipboardWatch(payload: ClipboardWatchPayload): Promise<ClipboardWatchTask | null>
  getTask(taskId: string): Promise<ClipboardWatchTask | null>
  cancelTask(taskId: string): Promise<void>
}

export type ClipboardHistoryGateway = {
  host: HostGateway
  clipboard: ClipboardGateway
  images: ImageGateway
  storage: StorageGateway
  monitor: MonitorGateway
  state?: ClipboardHistoryStateGateway
}
