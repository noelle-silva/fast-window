export const STORAGE_SCHEMA_VERSION = 1
export const STORAGE_META_PATH = '_meta.json'

export const ClipboardHistoryStorageKeys = {
  history: 'history',
  settings: 'settings',
  deletedHistory: 'deletedHistory',
  collections: 'collections',
  recentFolders: 'recentFolders',
} as const

export const STORAGE_KEYS = Object.values(ClipboardHistoryStorageKeys)
