import type { AppDisplayMode, AppKind, RegisteredAppShortcut } from '../apps/types'

export type StoreImageIconRef =
  | { type: 'url'; url: string }
  | { type: 'data'; dataUrl: string }

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
  type: AppKind
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

export interface StoreCatalog {
  catalogVersion: 2
  generatedAt?: string
  host?: HostUpdateEntry
  apps: StoreAppEntry[]
}
