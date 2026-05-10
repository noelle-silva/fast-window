import type { AppDisplayMode, RegisteredAppCommand } from '../apps/types'

export type StoreIconRef =
  | { type: 'emoji'; value: string }
  | { type: 'url'; url: string }
  | { type: 'data'; dataUrl: string }

export interface StoreDownloadAsset {
  downloadUrl: string
  sha256: string
  sizeBytes?: number
}

export interface StoreAppEntry {
  id: string
  name: string
  description: string
  version: string
  icon?: StoreIconRef
  platforms: {
    windows: StoreDownloadAsset
  }
  displayMode?: AppDisplayMode
  commands?: RegisteredAppCommand[]
}

export interface LegacyPluginStoreEntry {
  id: string
  name: string
  description: string
  version: string
  icon?: StoreIconRef
  downloadUrl: string
  sha256: string
  requires: string[]
}

export interface StoreCatalog {
  catalogVersion: 2
  generatedAt?: string
  apps: StoreAppEntry[]
  plugins: LegacyPluginStoreEntry[]
}
