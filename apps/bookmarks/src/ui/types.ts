import type { DesktopGridEntry as BaseDesktopGridEntry, DesktopGridLayout } from '../shared/desktop-grid'

export type FwLaunchInfo = { launched: boolean; standalone: boolean; mode: string }

export type DataDirStatus = {
  dataDir: string
  defaultDataDir: string
  configuredDataDir?: string | null
  writable: boolean
  error?: string | null
}

export type BookmarkGroup = {
  id: string
  name: string
  createdAt: number
}

export type BookmarkItem = {
  id: string
  title: string
  url: string
  iconUrl?: string
  groupId: string
  layout?: DesktopGridLayout
  createdAt: number
  updatedAt: number
  lastOpenedAt?: number | null
}

export type BookmarkData = {
  schemaVersion: number
  dataVersion?: number
  groups: BookmarkGroup[]
  items: BookmarkItem[]
}

export type BookmarkGridEntry = BaseDesktopGridEntry & {
  kind: 'item'
  item: BookmarkItem
}

export type BookmarkFormState = {
  title: string
  url: string
  groupId: string
  iconUrl: string
}

export type GroupFormState = {
  id: string
  name: string
}

export type Phase = 'starting' | 'ready' | 'failed'

export type ConfirmState =
  | { kind: 'bookmark'; id: string; label: string }
  | { kind: 'group'; id: string; label: string }
  | null

export type ContextMenuState = { item: BookmarkItem; x: number; y: number } | null
