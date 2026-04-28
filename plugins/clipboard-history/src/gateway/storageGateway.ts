import { ClipboardHistoryStorageKeys } from '../shared/storageKeys'
import type { ClipboardHistoryItem, ClipboardHistorySettings, CollectionsDoc, DeletedHistoryMap } from '../shared/types'
import type { StorageGateway } from './types'
import type { V2HostAdapter } from './v2HostAdapter'

function keyToPath(key: string): string {
  return `${key}.json`
}

export function createStorageGateway(adapter: V2HostAdapter): StorageGateway {
  return {
    loadHistory: () => adapter.rawStorage.readJson(keyToPath(ClipboardHistoryStorageKeys.history)) as Promise<ClipboardHistoryItem[] | null>,
    saveHistory: (items) => adapter.rawStorage.writeJson(keyToPath(ClipboardHistoryStorageKeys.history), items),
    loadSettings: () => adapter.rawStorage.readJson(keyToPath(ClipboardHistoryStorageKeys.settings)) as Promise<Partial<ClipboardHistorySettings> | null>,
    saveSettings: (settings) => adapter.rawStorage.writeJson(keyToPath(ClipboardHistoryStorageKeys.settings), settings),
    loadDeletedHistory: () => adapter.rawStorage.readJson(keyToPath(ClipboardHistoryStorageKeys.deletedHistory)) as Promise<DeletedHistoryMap | null>,
    saveDeletedHistory: (deleted) => adapter.rawStorage.writeJson(keyToPath(ClipboardHistoryStorageKeys.deletedHistory), deleted),
    loadCollections: () => adapter.rawStorage.readJson(keyToPath(ClipboardHistoryStorageKeys.collections)) as Promise<CollectionsDoc | null>,
    saveCollections: (collections) => adapter.rawStorage.writeJson(keyToPath(ClipboardHistoryStorageKeys.collections), collections),
    loadRecentFolders: () => adapter.rawStorage.readJson(keyToPath(ClipboardHistoryStorageKeys.recentFolders)) as Promise<string[] | null>,
    saveRecentFolders: (folderIds) => adapter.rawStorage.writeJson(keyToPath(ClipboardHistoryStorageKeys.recentFolders), folderIds),
  }
}
