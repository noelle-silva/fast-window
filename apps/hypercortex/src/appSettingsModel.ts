import type { HyperCortexAppSettingsV1, HyperCortexSidebarSortModeV1 } from './core'
import { normalizeFacePluginSettingsContainer } from './facePlugins/settings'
import { normalizePageDisplayModes } from './pageDisplay'
import { normalizeRepoCacheLimit } from './repoCacheLimit'
import { normalizeShortcutBindings } from './shortcuts'

// 应用设置的读取归一化与落库收敛共用同一解析，保证设置形态单一事实源。

export type AllNotesLayout = NonNullable<HyperCortexAppSettingsV1['allNotesLayout']>
export type TabsMode = NonNullable<HyperCortexAppSettingsV1['tabsMode']>

export function normalizeAllNotesLayout(value: unknown): AllNotesLayout {
  return value === 'grid' || value === 'icon' ? value : 'list'
}

export function normalizeBoolean(value: unknown): boolean {
  return value === true
}

export function normalizeTabsMode(value: unknown): TabsMode {
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
  next.trashEnabled = normalizeTrashEnabled(next.trashEnabled)
  next.trashAutoDeleteDays = normalizeTrashAutoDeleteDays(next.trashAutoDeleteDays)
  next.facePluginSettings = normalizeFacePluginSettingsContainer(next.facePluginSettings)
  next.pageDisplayModes = normalizePageDisplayModes(next.pageDisplayModes)
  next.repoCacheLimit = normalizeRepoCacheLimit(next.repoCacheLimit)
  return next
}
