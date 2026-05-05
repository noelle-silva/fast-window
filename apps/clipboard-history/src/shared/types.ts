export type ClipboardHistoryItem = {
  type: 'text' | 'image'
  content: string
  time: number
  path?: string
}

export type ClipboardHistorySettings = {
  autoMonitor: boolean
  pollInterval: number
  maxHistory: number
  collapseLines: number
}

export type DeletedHistoryMap = Record<string, number>

export type CollectionFolderNode = {
  id: string
  type: 'folder'
  name: string
  children: string[]
  createdAt: number
  updatedAt: number
}

export type CollectionItemNode = {
  id: string
  type: 'item'
  title: string
  content: string
  createdAt: number
  updatedAt: number
}

export type CollectionNode = CollectionFolderNode | CollectionItemNode

export type CollectionsDoc = {
  version: 1
  rootId: string
  nodes: Record<string, CollectionNode>
}

export type ClipboardHistorySnapshot = {
  history: ClipboardHistoryItem[]
  settings: ClipboardHistorySettings
  deleted: DeletedHistoryMap
  collections: CollectionsDoc
  recentFolders: string[]
}

export type LegacyDataImportReport = {
  sourceDir: string
  backupDir?: string | null
  importedFiles: string[]
  copiedImages: number
  historyCount: number
  collectionCount: number
  recentFolderCount: number
}

export type LegacyDataImportResult = {
  report: LegacyDataImportReport
  snapshot: ClipboardHistorySnapshot
}
