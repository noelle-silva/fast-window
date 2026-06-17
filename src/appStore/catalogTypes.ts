import type { AppDisplayMode, RegisteredAppShortcut } from '../apps/types'

export type StoreImageIconRef =
  | { type: 'url'; url: string }
  | { type: 'data'; dataUrl: string }

export type LegacyPluginStoreIconRef =
  | { type: 'emoji'; value: string }
  | StoreImageIconRef

export interface StoreDownloadAsset {
  downloadUrl: string
  sha256: string
  sizeBytes?: number
}

export interface HostUpdateAsset extends StoreDownloadAsset {
  installerType: 'msi'
}

export interface HostUpdateEntry {
  id: 'fast-window'
  name: string
  version: string
  platforms: {
    windows: HostUpdateAsset
  }
}

export interface StoreAppEntry {
  id: string
  name: string
  description: string
  version: string
  icon: StoreImageIconRef
  platforms: {
    windows: StoreDownloadAsset
  }
  displayMode?: AppDisplayMode
  commands?: RegisteredAppShortcut[]
}

export interface LegacyPluginStoreEntry {
  id: string
  name: string
  description: string
  version: string
  icon?: LegacyPluginStoreIconRef
  downloadUrl: string
  sha256: string
  requires: string[]
}

export interface StoreCatalog {
  catalogVersion: 2
  generatedAt?: string
  host?: HostUpdateEntry
  apps: StoreAppEntry[]
  plugins: LegacyPluginStoreEntry[]
}
