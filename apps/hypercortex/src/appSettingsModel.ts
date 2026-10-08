import type { HyperCortexAppSettingsV1, HyperCortexSidebarSortModeV1 } from './core'
import { normalizeFacePluginSettingsContainer } from './facePlugins/settings'
import { normalizeGraphSettings } from './graphSettings'
import { normalizePageDisplayModes } from './pageDisplay'
import { normalizeRepoCacheLimit } from './repoCacheLimit'
import { normalizeSidebarExpandedWidth } from './sidebarWidth'
import { normalizeShortcutBindings } from './shortcuts'

// 应用设置的读取归一化与落库收敛共用同一解析，保证设置形态单一事实源。

export type AllNotesLayout = NonNullable<HyperCortexAppSettingsV1['allNotesLayout']>
// 边栏展开形态：手动展开挤压 / 悬停展开覆盖。左侧「已打开笔记」栏与右侧「收藏夹导航」栏共用。
export type SidebarDisplayMode = 'manual' | 'hover'
export type TabsMode = SidebarDisplayMode

export function normalizeAllNotesLayout(value: unknown): AllNotesLayout {
  return value === 'grid' || value === 'icon' ? value : 'list'
}

export function normalizeBoolean(value: unknown): boolean {
  return value === true
}

export function normalizeTabsMode(value: unknown): TabsMode {
  return value === 'hover' ? 'hover' : 'manual'
}

// 收藏夹导航栏的展开形态归一化：读取与落库共用同一解析。
export function normalizeFavoritesSidebarMode(value: unknown): SidebarDisplayMode {
  return value === 'hover' ? 'hover' : 'manual'
}

export function normalizeSidebarSortMode(value: unknown): HyperCortexSidebarSortModeV1 {
  return value === 'precision' ? 'precision' : 'sortable'
}

export function normalizeTrashEnabled(value: unknown): boolean {
  return value === false ? false : true
}

export function normalizeTrashAutoDeleteDays(value: unknown): number {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n)) return 30
  if (n < 0) return 0
  if (n > 3650) return 3650
  return n
}

export function sanitizeAppSettingsForSave(settings: HyperCortexAppSettingsV1): HyperCortexAppSettingsV1 {
  const next: HyperCortexAppSettingsV1 = { ...settings, version: 1 }
  if ('shortcuts' in next) next.shortcuts = normalizeShortcutBindings((next as any).shortcuts)
  next.shortcutHintsEnabled = normalizeBoolean((next as any).shortcutHintsEnabled)
  next.favoritesSidebarCollapsed = normalizeBoolean((next as any).favoritesSidebarCollapsed)
  next.favoritesSidebarMode = normalizeFavoritesSidebarMode((next as any).favoritesSidebarMode)
  next.tabsSidebarWidth = normalizeSidebarExpandedWidth((next as any).tabsSidebarWidth)
  next.favoritesSidebarWidth = normalizeSidebarExpandedWidth((next as any).favoritesSidebarWidth)
  next.trashEnabled = normalizeTrashEnabled(next.trashEnabled)
  next.trashAutoDeleteDays = normalizeTrashAutoDeleteDays(next.trashAutoDeleteDays)
  next.facePluginSettings = normalizeFacePluginSettingsContainer(next.facePluginSettings)
  next.pageDisplayModes = normalizePageDisplayModes(next.pageDisplayModes)
  next.graphSettings = normalizeGraphSettings(next.graphSettings)
  next.repoCacheLimit = normalizeRepoCacheLimit(next.repoCacheLimit)
  return next
}
