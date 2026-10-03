import * as React from 'react'
import type { HyperCortexAppSettingsV1 } from '../core'
import {
  normalizeAllNotesLayout,
  normalizeBoolean,
  normalizeFavoritesSidebarMode,
  normalizeSidebarSortMode,
  normalizeTabsMode,
  normalizeTrashAutoDeleteDays,
  normalizeTrashEnabled,
} from '../appSettingsModel'
import { normalizeRepoCacheLimit } from '../repoCacheLimit'
import { normalizeSidebarExpandedWidth } from '../sidebarWidth'
import { normalizeColorPresetId } from './colorPresets'
import {
  DEFAULT_SHORTCUT_BINDINGS,
  normalizeShortcutBindings,
  type HyperCortexShortcutBindingsV1,
} from '../shortcuts'
import { normalizePageDisplayModes, type ModalCapablePageId, type PageDisplayMode } from '../pageDisplay'
import { normalizeFaceSettingValue } from '../facePlugins/settings'
import { normalizeDefaultFaceKinds, normalizeFaceKindOrder } from '../facePreferences'
import { getCreatableFaceDeclarations, getFaceDeclaration, getFaceKindOrder } from '../facePlugins'
import type { PageId } from './workspacePages'

// 应用设置的读取派生与写回：从外壳派生全部设置值与其归一化引用，并把设置改动统一回写外壳。
// 读取在现场顶部接线；写回涉及界面/导航联动依赖，在依赖齐备处接线；模块不持有任何隐式全局。

export function useAppSettings(appSettings: HyperCortexAppSettingsV1) {
  // ---- 应用设置（全局唯一，只读派生；修改统一回写外壳）
  const shortcutBindings = React.useMemo<HyperCortexShortcutBindingsV1>(
    () => normalizeShortcutBindings(appSettings.shortcuts),
    [appSettings.shortcuts],
  )
  const shortcutHintsEnabled = normalizeBoolean(appSettings.shortcutHintsEnabled)
  const pageDisplayModes = React.useMemo(() => normalizePageDisplayModes(appSettings.pageDisplayModes), [appSettings.pageDisplayModes])
  const allNotesLayout = normalizeAllNotesLayout(appSettings.allNotesLayout)
  const tabsCollapsed = normalizeBoolean(appSettings.tabsCollapsed)
  const tabsMode = normalizeTabsMode(appSettings.tabsMode)
  const tabsSidebarWidth = normalizeSidebarExpandedWidth(appSettings.tabsSidebarWidth)
  const favoritesSidebarCollapsed = normalizeBoolean(appSettings.favoritesSidebarCollapsed)
  const favoritesSidebarMode = normalizeFavoritesSidebarMode(appSettings.favoritesSidebarMode)
  const favoritesSidebarWidth = normalizeSidebarExpandedWidth(appSettings.favoritesSidebarWidth)
  const sidebarSortMode = normalizeSidebarSortMode(appSettings.sidebarSortMode)
  const trashEnabled = normalizeTrashEnabled(appSettings.trashEnabled)
  const trashAutoDeleteDays = normalizeTrashAutoDeleteDays(appSettings.trashAutoDeleteDays)
  const facePluginSettings = appSettings.facePluginSettings || {}
  const faceKindOrder = appSettings.faceKindOrder || []
  const defaultFaceKinds = appSettings.defaultFaceKinds || []
  const colorPresetId = normalizeColorPresetId(appSettings.colorPresetId)
  const repoCacheLimit = normalizeRepoCacheLimit(appSettings.repoCacheLimit)

  const shortcutBindingsRef = React.useRef<HyperCortexShortcutBindingsV1>(DEFAULT_SHORTCUT_BINDINGS)
  const shortcutRecordingRef = React.useRef(false)
  const handleShortcutRecordingChange = React.useCallback((active: boolean) => {
    shortcutRecordingRef.current = active === true
  }, [])
  React.useEffect(() => {
    shortcutBindingsRef.current = shortcutBindings
  }, [shortcutBindings])

  const pageDisplayModesRef = React.useRef(pageDisplayModes)
  React.useEffect(() => {
    pageDisplayModesRef.current = pageDisplayModes
  }, [pageDisplayModes])

  const trashAutoDeleteDaysRef = React.useRef(trashAutoDeleteDays)
  React.useEffect(() => {
    trashAutoDeleteDaysRef.current = trashAutoDeleteDays
  }, [trashAutoDeleteDays])

  const facePluginSettingsRef = React.useRef(facePluginSettings)
  React.useEffect(() => {
    facePluginSettingsRef.current = facePluginSettings
  }, [facePluginSettings])

  return {
    shortcutBindings,
    shortcutHintsEnabled,
    pageDisplayModes,
    allNotesLayout,
    tabsCollapsed,
    tabsMode,
    tabsSidebarWidth,
    favoritesSidebarCollapsed,
    favoritesSidebarMode,
    favoritesSidebarWidth,
    sidebarSortMode,
    trashEnabled,
    trashAutoDeleteDays,
    facePluginSettings,
    faceKindOrder,
    defaultFaceKinds,
    colorPresetId,
    repoCacheLimit,
    shortcutBindingsRef,
    shortcutRecordingRef,
    pageDisplayModesRef,
    trashAutoDeleteDaysRef,
    facePluginSettingsRef,
    handleShortcutRecordingChange,
  }
}

export function useAppSettingsWritebacks(opts: {
  settings: ReturnType<typeof useAppSettings>
  patchAppSettings: (patch: Partial<HyperCortexAppSettingsV1>) => void
  setShortcutHintsOpen: React.Dispatch<React.SetStateAction<boolean>>
  setTabsHoverOpen: React.Dispatch<React.SetStateAction<boolean>>
  setFavoritesHoverOpen: React.Dispatch<React.SetStateAction<boolean>>
  navigatePage: (next: PageId, opts?: { recordHistory?: boolean }) => void
  syncNavStackCounts: () => void
  navHistoryRef: React.MutableRefObject<{ page: PageId; tabKey?: string }[]>
  fwdNavHistoryRef: React.MutableRefObject<{ page: PageId; tabKey?: string }[]>
  pageRef: React.MutableRefObject<PageId>
  setOpenModalPage: React.Dispatch<React.SetStateAction<PageId | null>>
}) {
  const {
    settings,
    patchAppSettings,
    setShortcutHintsOpen,
    setTabsHoverOpen,
    setFavoritesHoverOpen,
    navigatePage,
    syncNavStackCounts,
    navHistoryRef,
    fwdNavHistoryRef,
    pageRef,
    setOpenModalPage,
  } = opts
  const { allNotesLayout, tabsMode, tabsCollapsed, favoritesSidebarMode, favoritesSidebarCollapsed, pageDisplayModesRef, facePluginSettingsRef } =
    settings

  const handleShortcutBindingsChange = React.useCallback(
    (next: HyperCortexShortcutBindingsV1) => {
      patchAppSettings({ shortcuts: normalizeShortcutBindings(next) })
    },
    [patchAppSettings],
  )

  const handleShortcutHintsEnabledChange = React.useCallback(
    (enabled: boolean) => {
      const next = enabled === true
      if (!next) setShortcutHintsOpen(false)
      patchAppSettings({ shortcutHintsEnabled: next })
    },
    [patchAppSettings],
  )

  const handlePageDisplayModeChange = React.useCallback(
    (targetId: ModalCapablePageId, mode: PageDisplayMode) => {
      const nextModes = { ...pageDisplayModesRef.current, [targetId]: mode }
      pageDisplayModesRef.current = nextModes
      patchAppSettings({ pageDisplayModes: nextModes })

      if (mode === 'modal') {
        // 该页从页面家族除名：清掉历史里的旧条目，前进/后退从此看不见它。
        navHistoryRef.current = navHistoryRef.current.filter(entry => entry.page !== targetId)
        fwdNavHistoryRef.current = fwdNavHistoryRef.current.filter(entry => entry.page !== targetId)
        syncNavStackCounts()
        if (pageRef.current === targetId) navigatePage('home')
      } else {
        setOpenModalPage(prevOpen => (prevOpen === targetId ? null : prevOpen))
      }
    },
    [navigatePage, patchAppSettings, syncNavStackCounts],
  )

  const handleColorPresetChange = React.useCallback(
    (presetId: string) => {
      patchAppSettings({ colorPresetId: normalizeColorPresetId(presetId as any) })
    },
    [patchAppSettings],
  )

  const handleRepoCacheLimitChange = React.useCallback(
    (limit: number) => {
      patchAppSettings({ repoCacheLimit: normalizeRepoCacheLimit(limit) })
    },
    [patchAppSettings],
  )

  const handleSidebarSortModeChange = React.useCallback(
    (mode: string) => {
      patchAppSettings({ sidebarSortMode: normalizeSidebarSortMode(mode) })
    },
    [patchAppSettings],
  )

  const handleTrashEnabledChange = React.useCallback(
    (enabled: boolean) => {
      patchAppSettings({ trashEnabled: enabled === true })
    },
    [patchAppSettings],
  )

  const handleTrashAutoDeleteDaysChange = React.useCallback(
    (days: number) => {
      patchAppSettings({ trashAutoDeleteDays: normalizeTrashAutoDeleteDays(days) })
    },
    [patchAppSettings],
  )

  /** 面插件全局设置写回：按「类型标识 + 字段键」写入统一容器并持久化。 */
  const handleFacePluginSettingChange = React.useCallback(
    (kind: string, key: string, value: unknown) => {
      const faceKind = String(kind || '').trim()
      const settingKey = String(key || '').trim()
      if (!faceKind || !settingKey) return
      // 按声明归一化：非法值拒绝落库，写入路径与展示路径共用同一解析。
      const declaration = getFaceDeclaration(faceKind)
      const field = declaration?.settings.find(item => item.key === settingKey)
      const normalizedValue = field ? normalizeFaceSettingValue(field, value) : undefined
      if (!field || normalizedValue === undefined) return
      const next = {
        ...facePluginSettingsRef.current,
        [faceKind]: { ...(facePluginSettingsRef.current[faceKind] || {}), [settingKey]: normalizedValue },
      }
      facePluginSettingsRef.current = next
      patchAppSettings({ facePluginSettings: next })
    },
    [patchAppSettings],
  )

  const handleFaceKindOrderChange = React.useCallback(
    (next: string[]) => {
      patchAppSettings({ faceKindOrder: normalizeFaceKindOrder(next, getFaceKindOrder()) })
    },
    [patchAppSettings],
  )

  const handleDefaultFaceKindsChange = React.useCallback(
    (next: string[]) => {
      patchAppSettings({ defaultFaceKinds: normalizeDefaultFaceKinds(next, getCreatableFaceDeclarations().map(declaration => declaration.kind)) })
    },
    [patchAppSettings],
  )

  const toggleAllNotesLayout = React.useCallback(() => {
    const next = allNotesLayout === 'list' ? 'grid' : allNotesLayout === 'grid' ? 'icon' : 'list'
    patchAppSettings({ allNotesLayout: next })
  }, [allNotesLayout, patchAppSettings])

  const toggleTabsCollapsed = React.useCallback(() => {
    patchAppSettings({ tabsCollapsed: !tabsCollapsed })
  }, [patchAppSettings, tabsCollapsed])

  const toggleTabsMode = React.useCallback(() => {
    setTabsHoverOpen(false)
    patchAppSettings({ tabsMode: tabsMode === 'manual' ? 'hover' : 'manual' })
  }, [patchAppSettings, tabsMode])

  const handleTabsSidebarResizeEnd = React.useCallback((width: number) => {
    patchAppSettings({ tabsSidebarWidth: normalizeSidebarExpandedWidth(width) })
  }, [patchAppSettings])

  const handleFavoritesSidebarResizeEnd = React.useCallback((width: number) => {
    patchAppSettings({ favoritesSidebarWidth: normalizeSidebarExpandedWidth(width) })
  }, [patchAppSettings])

  const toggleFavoritesSidebarCollapsed = React.useCallback(() => {
    patchAppSettings({ favoritesSidebarCollapsed: !favoritesSidebarCollapsed })
  }, [favoritesSidebarCollapsed, patchAppSettings])

  const toggleFavoritesSidebarMode = React.useCallback(() => {
    setFavoritesHoverOpen(false)
    patchAppSettings({ favoritesSidebarMode: favoritesSidebarMode === 'manual' ? 'hover' : 'manual' })
  }, [favoritesSidebarMode, patchAppSettings])

  return {
    handleShortcutBindingsChange,
    handleShortcutHintsEnabledChange,
    handlePageDisplayModeChange,
    handleColorPresetChange,
    handleRepoCacheLimitChange,
    handleSidebarSortModeChange,
    handleTrashEnabledChange,
    handleTrashAutoDeleteDaysChange,
    handleFacePluginSettingChange,
    handleFaceKindOrderChange,
    handleDefaultFaceKindsChange,
    toggleAllNotesLayout,
    toggleTabsCollapsed,
    toggleTabsMode,
    handleTabsSidebarResizeEnd,
    handleFavoritesSidebarResizeEnd,
    toggleFavoritesSidebarCollapsed,
    toggleFavoritesSidebarMode,
  }
}
