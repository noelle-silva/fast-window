import type {
  ClipboardHistoryItem,
  ClipboardHistorySettings,
  ClipboardHistorySnapshot,
  CollectionsDoc,
  LegacyDataImportResult,
  OrphanImageCleanupReport,
  OrphanImageReport,
} from '../shared/types'

export type HostGateway = {
  toast(message: string): Promise<void>
  back(): Promise<void>
  startDragging(): Promise<void>
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  closeToTray(): Promise<void>
}

export type ClipboardGateway = {
  writeText(text: string): Promise<ClipboardHistorySnapshot>
  writeImage(dataUrlOrRequest: string | { dataUrl?: string; path?: string }): Promise<ClipboardHistorySnapshot>
}

export type ImageGateway = {
  readOutputImage(path: string): Promise<string>
  scanOrphanImages(): Promise<OrphanImageReport>
  deleteOrphanImages(): Promise<OrphanImageCleanupReport>
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

export type LegacyGateway = {
  importData(sourceDir: string): Promise<LegacyDataImportResult>
}

export type ClipboardHistoryGateway = {
  state: ClipboardHistoryStateGateway
  collections: ClipboardHistoryCollectionsGateway
  clipboard: ClipboardGateway
  images: ImageGateway
  legacy: LegacyGateway
  onSnapshot(listener: (snapshot: ClipboardHistorySnapshot) => void): () => void
  close(): void
}
