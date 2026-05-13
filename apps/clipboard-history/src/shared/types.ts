export type ClipboardHistoryThemeId =
  | 'calm-blue'
  | 'catppuccin-latte'
  | 'rose-pine-dawn'
  | 'nord-night'
  | 'catppuccin-mocha'
  | 'solarized-paper'
  | 'everforest-moss'
  | 'gruvbox-ember'
  | 'dracula-neon'
  | 'kanagawa-wave'
  | 'radix-graphite'

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
  theme: ClipboardHistoryThemeId
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

export type CollectionTextContent = {
  type: 'text'
  text: string
}

export type CollectionImageContent = {
  type: 'image'
  reference: string
  path: string
  mime: string
  width: number
  height: number
  sourceName?: string
}

export type CollectionItemContent = CollectionTextContent | CollectionImageContent

export type CollectionItemContentInput =
  | CollectionTextContent
  | (Partial<CollectionImageContent> & {
      type: 'image'
      dataUrl?: string
      sourceName?: string
    })

export type CollectionItemNode = {
  id: string
  type: 'item'
  title: string
  content: CollectionItemContent
  createdAt: number
  updatedAt: number
}

export type ClipboardImageDraft = {
  dataUrl?: string
  reference?: string
  path?: string
  mime: string
  width: number
  height: number
  sourceName?: string
}

export type CollectionNode = CollectionFolderNode | CollectionItemNode

export type CollectionsDoc = {
  version: 2
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

export type OrphanImageEntry = {
  fileName: string
  path: string
  sizeBytes: number
}

export type OrphanImageReport = {
  scannedFiles: number
  referencedFiles: number
  orphanCount: number
  orphanBytes: number
  orphans: OrphanImageEntry[]
}

export type OrphanImageDeleteFailure = {
  path: string
  error: string
}

export type OrphanImageCleanupReport = {
  detected: OrphanImageReport
  deletedCount: number
  deletedBytes: number
  failed: OrphanImageDeleteFailure[]
  remaining: OrphanImageReport
}
