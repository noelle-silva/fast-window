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

export type ClipboardWatchPayload = {
  intervalMs: number
  maxHistory: number
}

export type ClipboardWatchTask = {
  id: string
  kind: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled' | string
  result?: unknown
}

export type ClipboardMonitorSnapshot = {
  latest?: ClipboardHistoryItem | null
  items?: ClipboardHistoryItem[]
}

export type ClipboardHistorySnapshot = {
  history: ClipboardHistoryItem[]
  settings: ClipboardHistorySettings
  deleted: DeletedHistoryMap
  collections: CollectionsDoc
  recentFolders: string[]
}

export type InternalCopyMarker = {
  type: '' | 'text' | 'image'
  content: string
  at: number
}
