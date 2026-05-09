import type { BookmarkData, BookmarkGroup, BookmarkItem, FwLaunchInfo } from './types'

export const DEFAULT_GROUP_ID = 'default'
export const ALL_GROUP_ID = '__all__'
export const DEFAULT_LAUNCH_INFO: FwLaunchInfo = { launched: false, standalone: false, mode: 'default' }

export const EMPTY_DATA: BookmarkData = {
  schemaVersion: 1,
  dataVersion: 1,
  groups: [],
  items: [],
}

export function bookmarkTitle(item: BookmarkItem): string {
  return item.title.trim() || item.url
}

export function bookmarkDetail(item: BookmarkItem): string {
  try {
    return new URL(item.url).hostname.replace(/^www\./, '')
  } catch {
    return item.url
  }
}

export function sortedGroups(groups: BookmarkGroup[]): BookmarkGroup[] {
  return groups.slice().sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name))
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  const value = String(error || '').trim()
  return value || fallback
}

export function isInteractiveTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null
  return Boolean(element?.closest('button, a, input, textarea, select, [role="button"], [data-window-control="true"], [data-desktop-grid-no-drag="1"]'))
}

export function groupName(groups: BookmarkGroup[], groupId: string): string {
  return groups.find(group => group.id === groupId)?.name || '默认'
}

export function isDataDirBroken(status: DataDirStatusLike | null, error: string | null): boolean {
  return Boolean(error || status?.error || status?.writable === false)
}

type DataDirStatusLike = {
  writable: boolean
  error?: string | null
}
