import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Menu, MenuItem, Typography } from '@mui/material'
import {
  kindFromMime,
  mimeFromExt,
  type HyperCortexFavoritesNavV1,
  type HyperCortexTabGroupV1,
  type HyperCortexWorkspaceV1,
  type NoteMeta,
} from '../core'
import type { HyperCortexRepo } from '../gateway'
import { buildNotePlaceholderForCopy } from '../notePlaceholder'
import { sortNotesByUpdatedAtDesc } from '../noteCatalog'
import { isDraftNoteId } from '../drafts'
import { addRef, reorderRefsInFolder, type FavoriteItemRef, type HyperCortexFavoritesDocV1 } from '../favorites'
import { createFavoritesLedger } from '../favoritesLedger'
import { buildNoteInitSnapshot, filterOpenNoteIdsForClose, useDraftOrchestration } from './useDraftOrchestration'
import { AssetPoolPanel } from './AssetPoolPanel'
import { HomePage, type HomePageStats } from './HomePage'
import { IndexPage } from './IndexPage'
import { OpenTabsPanel } from './OpenTabsPanel'
import { FavoritesSidebarPanel } from './FavoritesSidebarPanel'
import { useFavoritesEntityActions, type FavoritesEntityTarget } from './useFavoritesEntityActions'
import { resolveAssetRef } from '../assetLookup'
import { buildFavoriteFolderView } from './favoritesSidebarModel'
import { SidebarRail } from './SidebarRail'
import { resolveSidebarLayout } from './sidebarLayout'
import {
  createFavoritesNav,
  goBackFavoritesNav,
  goForwardFavoritesNav,
  navigateFavoritesNav,
  reconcileFavoritesNav,
} from './favoritesNavigator'
import { NoteDetailSession, type NoteDetailSessionHandle, type NoteDetailSnapshotV1 } from './NoteDetailSession'
import { AssetDetailSession } from './AssetDetailSession'
import { SettingsPage } from './SettingsPage'
import { AllNotesPage } from './AllNotesPage'
import { PageOverlayHost } from './PageOverlayHost'
import { TrashPanel } from './TrashPanel'
import { RepoTrashPanel } from './repo-management/RepoTrashPanel'
import { menuDangerItemSx, menuPaperSx, softButtonSx } from './pluginUiStyles'
import { startPickedLocalAssetUploadTask } from '../services/localAssetUpload'
import { createTabGroupId, pickNextTabGroupColor, pickNextTabGroupTitle } from './tabGroups'
import { createWorkspaceId, pickNextWorkspaceTitle, updateWorkspaceById } from './workspaces'
import { applyActiveWorkspacePatch, buildRepoStateSnapshot, normalizeOpenTabKeys } from './workspaceModel'
import { useNoteScrollMemory } from './noteScrollMemory'
import {
  closeTabsInSidebar,
  createGroupInSidebar,
  deleteGroupFromSidebar,
  deriveSidebarFields,
  ensureSidebarItems,
  insertTabAsUngrouped,
  moveGroupToIndex,
  moveTabBetweenGroups,
  moveTabToGroupIndex,
  type SidebarItem,
  updateSidebarGroup,
} from './sidebarModel'
import type { NoteCardInfo } from './noteCardInfo'
import { loadNoteCardInfo, startPrefetchNoteCardInfo } from './noteCardInfoLoader'
import type { AssetEntry } from '../assetTypes'
import { assetTabId } from '../assetTypes'
import { assetRefKeyFromTabKey, noteIdFromTabKey, noteTabKey, parseAssetRefKey, tabKind, type TabKey } from '../tabKey'
import { createRepoScopedGateway, type HyperCortexGateway } from '../gateway'
import { orderKindsByGlobalOrder } from '../facePreferences'
import { useNoteIndex } from './useNoteIndex'
import { useAppCommandDispatch } from './useAppCommandDispatch'
import { usePageNavigation } from './usePageNavigation'
import { ASSET_UPLOAD_WAIT_INTERVAL_MS, assetKeyFromResource, sleep, useAssetPoolSessions } from './useAssetPoolSessions'
import { useGlobalShortcuts } from './useGlobalShortcuts'
import { useHyperCortexShell } from './shellContext'
import { RepoWorkspaceToolbar } from './RepoWorkspaceToolbar'
import type { PageId } from './workspacePages'
import { WorkspaceVisibilityProvider } from './workspaceVisibility'
import { SidebarHoldPreviewOverlay } from './sidebar-preview/SidebarHoldPreviewOverlay'
import { useSidebarHoldPreview } from './sidebar-preview/useSidebarHoldPreview'
import { encodeSidebarPreviewTarget } from './sidebar-preview/previewTarget'
import { useAppSettings, useAppSettingsWritebacks } from './useAppSettings'
import { useRepoStateBootstrap, WorkspaceInitGate } from './useRepoStateBootstrap'

export type RepoWorkspaceProps = {
  repoId: string
  visible: boolean
}

/**
 * 仓库现场：一个仓库一份、常驻不销毁的完整工作现场。
 * 切换仓库只改变可见性；现场内的页面位置、标签页、未保存编辑、滚动与播放大体自然留存。
 */
export function RepoWorkspace(props: RepoWorkspaceProps) {
  const { repoId, visible } = props
  const shell = useHyperCortexShell()
  const gateway = React.useMemo<HyperCortexGateway>(() => createRepoScopedGateway(repoId), [repoId])
  // 收藏夹账本管理员：收藏夹文档的唯一读写入口（装载 + 落盘）。
  const favoritesLedger = React.useMemo(() => createFavoritesLedger(gateway, 'library'), [gateway])

  const appSettings = shell.appSettings
  const patchAppSettings = shell.patchAppSettings
  const refreshRepos = shell.refreshRepos
  const refreshDataDirStatus = shell.refreshDataDirStatus
  const appCommandQueue = shell.appCommands.queue
  const enqueueAppCommand = shell.appCommands.enqueue
  const consumeAppCommand = shell.appCommands.consume

  // ---- 应用设置（全局唯一，只读派生；修改统一回写外壳）
  const settings = useAppSettings(appSettings)
  const {
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
    handleShortcutRecordingChange,
  } = settings

  // ---- 顶部栏：快速搜索与快捷键提示
  const [quickSearchOpen, setQuickSearchOpen] = React.useState(false)
  const [shortcutHintsOpen, setShortcutHintsOpen] = React.useState(false)

  const [favoritesDoc, setFavoritesDoc] = React.useState<HyperCortexFavoritesDocV1 | null>(null)
  const [currentFolderId, setCurrentFolderId] = React.useState<string>('root')
  // 收藏夹导航栏（右侧栏）的独立浏览位置：与主界面收藏夹页互不干扰，随仓库持久化。
  const [favoritesNav, setFavoritesNav] = React.useState<HyperCortexFavoritesNavV1>(() => createFavoritesNav())
  // 快捷键切换列表时的「最新值」引用：键盘回调常驻挂载，必须从 ref 读取当前数据。
  const favoritesDocRef = React.useRef(favoritesDoc)
  React.useEffect(() => {
    favoritesDocRef.current = favoritesDoc
  }, [favoritesDoc])
  const [noteCardMenu, setNoteCardMenu] = React.useState<{ anchorEl: HTMLElement; note: NoteMeta } | null>(null)
  const openNoteCardMenu = React.useCallback((e: React.MouseEvent, note: NoteMeta) => {
    e.stopPropagation()
    setNoteCardMenu({ anchorEl: e.currentTarget as HTMLElement, note })
  }, [])
  const closeNoteCardMenu = React.useCallback(() => setNoteCardMenu(null), [])

  const [noteCardDeleteTarget, setNoteCardDeleteTarget] = React.useState<NoteMeta | null>(null)

  // ---- 详情页（tab 常驻 Session）
  const [activeNoteId, setActiveNoteId] = React.useState<string>('')
  const activeNoteIdRef = React.useRef<string>('')
  React.useEffect(() => {
    activeNoteIdRef.current = activeNoteId
  }, [activeNoteId])

  const [openTabKeys, setOpenTabKeys] = React.useState<TabKey[]>([])
  const openTabKeysRef = React.useRef<TabKey[]>([])
  React.useEffect(() => {
    openTabKeysRef.current = openTabKeys
  }, [openTabKeys])

  const [activeTabKey, setActiveTabKey] = React.useState<TabKey>('')
  const activeTabKeyRef = React.useRef<TabKey>('')
  React.useEffect(() => {
    activeTabKeyRef.current = activeTabKey
  }, [activeTabKey])
  // 详情选中来源：全局同一时刻只有一个选中态，决定高亮落在左侧标签栏还是右侧收藏夹栏。
  const [detailSelectionSource, setDetailSelectionSource] = React.useState<'tabs' | 'favorites'>('tabs')
  const [activeTabScrollSignal, setActiveTabScrollSignal] = React.useState(0)
  // 右侧收藏夹栏的激活条目滚动信号：键盘切换后把当前条目滚入视野。
  const [favoritesActiveScrollSignal, setFavoritesActiveScrollSignal] = React.useState(0)

  // 导航记录应用的落点：工作区补丁函数定义晚于导航模块，经 ref 连接。
  const commitActiveWorkspacePatchRef = React.useRef<(patch: { activeTabKey: string }) => void>(() => {})

  // ---- 页面切页与前进后退历史
  const {
    page,
    pageRef,
    visiblePage,
    openModalPage,
    openModalPageRef,
    setOpenModalPage,
    navStackSizes,
    navHistoryRef,
    fwdNavHistoryRef,
    syncNavStackCounts,
    navigatePage,
    recordNewNavLocation,
    goBackPage,
    goForwardPage,
    handleShortcutOpenPage,
    closeModalOverlay,
    handleOpenTrashPage,
    handleOpenRepoTrashPage,
  } = usePageNavigation({
    gateway,
    pageDisplayModesRef,
    activeTabKeyRef,
    openTabKeysRef,
    setDetailSelectionSource,
    setActiveTabKey,
    setActiveNoteId,
    commitActiveWorkspacePatchRef,
  })

  const { mainScrollElRef, noteScrollTopByIdRef } = useNoteScrollMemory({ visible, page, activeNoteId, pageRef, activeNoteIdRef })

  const noteSessionHandlesRef = React.useRef<Record<string, NoteDetailSessionHandle | null>>({})
  const [closeTabPrompt, setCloseTabPrompt] = React.useState<{ noteId: string } | null>(null)
  const requestCloseTabRef = React.useRef<(noteId: string) => void>(() => {})
  const closeTabKeysDirectRef = React.useRef<(tabKeys: string[]) => void>(() => {})
  const activateExistingTabKeyRef = React.useRef<(tabKey: string, opts?: { recordHistory?: boolean }) => boolean>(() => false)
  // 装载流程应用工作区现场的入口：应用函数定义晚于装载钩子，经 ref 连接。
  const applyWorkspaceSidebarStateRef = React.useRef<(workspace: HyperCortexWorkspaceV1) => void>(() => {})
  // 右侧收藏夹栏条目的激活入口（与左侧标签栏并列）：键盘切换据此落到右侧列表。
  const activateFavoritesEntryKeyRef = React.useRef<(tabKey: string) => boolean>(() => false)

  // 侧边栏条目更新函数定义晚于附件会话模块，经 ref 连接。
  const updateSidebarItemsRef = React.useRef<
    (
      updater: (prev: SidebarItem[]) => SidebarItem[],
      patch?: Partial<Pick<HyperCortexWorkspaceV1, 'activeTabKey' | 'title'>>,
    ) => void
  >(() => {})

  // ---- 附件索引、附件会话与附件实体操作：状态与操作收敛到独立模块，导航与工作区能力经显式入参连接。
  const {
    assetPoolIndex,
    setAssetPoolIndex,
    openAssetTabs,
    setOpenAssetTabs,
    playingTabKeys,
    setTabPlaying,
    handleUpdateAssetInfo,
    handleOpenAssetTab,
    handleAssetTabUpdated,
    requestDeleteAssetEntity,
    handleTrashAssetRestored,
    assetEntityDeleteDialog,
  } = useAssetPoolSessions({
    visible,
    gateway,
    openTabKeys,
    activeTabKeyRef,
    pageRef,
    setDetailSelectionSource,
    setActiveTabKey,
    setActiveNoteId,
    recordNewNavLocation,
    navigatePage,
    commitActiveWorkspacePatchRef,
    updateSidebarItemsRef,
    closeTabKeysDirectRef,
  })

  // 右侧收藏夹栏当前页的唯一视图：渲染与键盘切换共用同一份组装，避免配方重复。
  const favoritesFolderView = React.useMemo(
    () => buildFavoriteFolderView({ doc: favoritesDoc, folderId: favoritesNav.currentFolderId, assetIndex: assetPoolIndex?.assets }),
    [favoritesDoc, favoritesNav.currentFolderId, assetPoolIndex?.assets],
  )
  const favoritesFolderViewRef = React.useRef(favoritesFolderView)
  React.useEffect(() => {
    favoritesFolderViewRef.current = favoritesFolderView
  }, [favoritesFolderView])

  // 选中归属的最终事实：来源为右且当前目标确实在右侧当前页里，才算右；否则回落左。
  // 高亮与快捷键切换共用这一个派生值，保证任何时刻有且仅有一处选中。
  const favoritesEntryTabKeys = React.useMemo(
    () => new Set(favoritesFolderView.entries.map(entry => entry.tabKey)),
    [favoritesFolderView],
  )
  const resolvedSelectionSource: 'tabs' | 'favorites' =
    detailSelectionSource === 'favorites' && !!activeTabKey && favoritesEntryTabKeys.has(activeTabKey) ? 'favorites' : 'tabs'
  const resolvedSelectionSourceRef = React.useRef(resolvedSelectionSource)
  React.useEffect(() => {
    resolvedSelectionSourceRef.current = resolvedSelectionSource
  }, [resolvedSelectionSource])

  // ---- 侧边栏 / 工作区 / 分组
  const [tabsHoverOpen, setTabsHoverOpen] = React.useState(false)
  const sidebarHoverRef = React.useRef(false)
  const sidebarShortcutHoldRef = React.useRef(false)

  // ---- 按住预览：快捷键按住期间，悬停任一边栏条目即在主区域覆盖展示其预览。
  const {
    previewTarget,
    previewHoldRef,
    previewOverlayScrollRef,
    cancelPreviewClear,
    applyPreviewTarget,
    handleSidebarPreviewHover,
    leftPreviewHover,
    rightPreviewHover,
    stopPreview,
  } = useSidebarHoldPreview({ visible })
  const [workspaces, setWorkspaces] = React.useState<HyperCortexWorkspaceV1[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = React.useState<string>('')

  // ---- 仓库状态装载与持久化：状态引用与就绪标记、规范化落盘、滚动位置记忆与初始化流程。
  const {
    repoReady,
    repoReadyRef,
    tabsInitReady,
    workspaceInitError,
    workspaceInitRetrying,
    runRepoInitialization,
    persistRepoStatePatch,
    sidebarScrollTopsRef,
    favoritesScrollTopsRef,
    handleSidebarScrollTopChange,
    handleFavoritesScrollTopChange,
    flushSidebarScrollTop,
    clearSidebarScrollMemory,
    clearFavoritesScrollMemory,
    sidebarScrollRestoreSignal,
    favoritesScrollRestoreSignal,
    activeWorkspaceIdRef,
    favoritesNavRef,
  } = useRepoStateBootstrap({
    repoId,
    visible,
    gateway,
    favoritesLedger,
    activeWorkspaceId,
    favoritesNav,
    trashAutoDeleteDaysRef,
    trashAutoDeleteDays,
    applyWorkspaceSidebarStateRef,
    activateExistingTabKeyRef,
    setWorkspaces,
    setActiveWorkspaceId,
    setCurrentFolderId,
    setFavoritesNav,
    setFavoritesDoc,
    setAssetPoolIndex,
  })

  // ---- 全部笔记列表
  const { index: noteIndex, setIndex: setNoteIndex, loading: noteIndexLoading, error: noteIndexLoadError } = useNoteIndex(gateway, repoId, repoReady)
  const allNotes = React.useMemo(() => sortNotesByUpdatedAtDesc(Object.values(noteIndex?.notes || {})), [noteIndex])

  // 打开的会话标识：真实笔记记真实标识，草稿记草稿标识；草稿元数据与转正后标识一律向档案查询。
  const [openNoteIds, setOpenNoteIds] = React.useState<string[]>([])
  const openNoteIdsRef = React.useRef<string[]>([])
  React.useEffect(() => {
    openNoteIdsRef.current = openNoteIds
  }, [openNoteIds])
  const [sidebarItems, setSidebarItems] = React.useState<SidebarItem[]>([])
  const sidebarItemsRef = React.useRef<SidebarItem[]>([])
  React.useEffect(() => {
    sidebarItemsRef.current = sidebarItems
  }, [sidebarItems])
  const [tabGrouping, setTabGrouping] = React.useState<{ groups: HyperCortexTabGroupV1[]; byTabKey: Record<string, string> }>({
    groups: [],
    byTabKey: {},
  })
  const tabGroupingRef = React.useRef(tabGrouping)
  React.useEffect(() => {
    tabGroupingRef.current = tabGrouping
  }, [tabGrouping])

  const workspaceSwitchSeqRef = React.useRef(0)

  const [noteDirtyById, setNoteDirtyById] = React.useState<Record<string, boolean>>({})
  const handleNoteDirtyChange = React.useCallback((payload: { noteId: string; dirty: boolean }) => {
    const nid = String(payload?.noteId || '').trim()
    if (!nid) return
    const nextDirty = payload?.dirty === true
    setNoteDirtyById(prev => {
      const had = Object.prototype.hasOwnProperty.call(prev, nid)
      const prevValue = had ? prev[nid] === true : false
      if (had && prevValue === nextDirty) return prev
      return { ...prev, [nid]: nextDirty }
    })
  }, [])

  const noteSessionRefCallbacksRef = React.useRef<Record<string, (handle: NoteDetailSessionHandle | null) => void>>({})
  const setNoteSessionHandle = React.useCallback((noteId: string, handle: NoteDetailSessionHandle | null) => {
    const nid = String(noteId || '').trim()
    if (!nid) return
    if (!handle) {
      delete noteSessionHandlesRef.current[nid]
      setNoteDirtyById(prev => {
        if (!Object.prototype.hasOwnProperty.call(prev, nid)) return prev
        const next = { ...prev }
        delete next[nid]
        return next
      })
      return
    }
    noteSessionHandlesRef.current[nid] = handle
  }, [])

  const getNoteSessionRefCallback = React.useCallback((noteId: string) => {
    const nid = String(noteId || '').trim()
    if (!nid) return undefined
    if (!noteSessionRefCallbacksRef.current[nid]) {
      noteSessionRefCallbacksRef.current[nid] = (handle: NoteDetailSessionHandle | null) => {
        setNoteSessionHandle(nid, handle)
      }
    }
    return noteSessionRefCallbacksRef.current[nid]
  }, [setNoteSessionHandle])

  const isNoteDirtyById = React.useCallback((noteId: string): boolean => {
    const nid = String(noteId || '').trim()
    if (!nid) return false
    if (Object.prototype.hasOwnProperty.call(noteDirtyById, nid)) return noteDirtyById[nid] === true
    return noteSessionHandlesRef.current[nid]?.isDirty?.() === true
  }, [noteDirtyById])

  const isNoteSavingById = React.useCallback((noteId: string): boolean => {
    const nid = String(noteId || '').trim()
    if (!nid) return false
    return noteSessionHandlesRef.current[nid]?.isSaving?.() === true
  }, [])

  // ---- 引用关系版本号：任何笔记保存/删除/恢复后自增，打开的会话据此重取反向引用。
  const [refRelationsEpoch, setRefRelationsEpoch] = React.useState(0)
  const bumpRefRelationsEpoch = React.useCallback(() => {
    setRefRelationsEpoch(prev => prev + 1)
  }, [])
  const allNotesById = React.useMemo(() => {
    const map: Record<string, NoteMeta> = {}
    for (const n of allNotes) map[n.id] = n
    return map
  }, [allNotes])

  const notesForQuickSearch = allNotes

  const homeRecentNotes = React.useMemo(() => notesForQuickSearch.slice(0, 6), [notesForQuickSearch])
  const homeStats = React.useMemo<HomePageStats>(() => ({
    noteCount: allNotes.length,
    assetCount: assetPoolIndex ? Object.keys(assetPoolIndex.assets || {}).length : 0,
    openTabCount: openTabKeys.length,
    workspaceCount: workspaces.length || 1,
  }), [allNotes.length, assetPoolIndex, openTabKeys.length, workspaces.length])
  const activeWorkspaceTitle = React.useMemo(() => {
    const wid = String(activeWorkspaceId || '').trim()
    return workspaces.find(w => w.id === wid)?.title || workspaces[0]?.title || ''
  }, [activeWorkspaceId, workspaces])

  // ---- 面切换请求（点击引用跳转指定面：复用同一标签页）
  const faceSwitchSeqRef = React.useRef(0)
  const [faceSwitchLatestSeq, setFaceSwitchLatestSeq] = React.useState(0)
  const [faceSwitchRequest, setFaceSwitchRequest] = React.useState<{ noteId: string; faceId: string; seq: number } | null>(null)

  const handleFaceSwitchConsumed = React.useCallback((seq: number) => {
    setFaceSwitchRequest(prev => (prev && prev.seq === seq ? null : prev))
  }, [])

  // ---- 全部笔记：卡片摘要（tags / faces）
  const [noteCardInfoById, setNoteCardInfoById] = React.useState<Record<string, NoteCardInfo>>({})
  const noteCardInfoByIdRef = React.useRef<Record<string, NoteCardInfo>>({})
  React.useEffect(() => {
    noteCardInfoByIdRef.current = noteCardInfoById
  }, [noteCardInfoById])

  const upsertNoteCardInfo = React.useCallback((noteId: string, nextInfo: NoteCardInfo) => {
    const nid = String(noteId || '').trim()
    if (!nid) return
    setNoteCardInfoById(prev => {
      const existed = prev[nid]
      if (
        existed &&
        existed.faceLabels.join('\n') === nextInfo.faceLabels.join('\n') &&
        existed.faceIds.join('\n') === nextInfo.faceIds.join('\n') &&
        existed.tags.join('\n') === nextInfo.tags.join('\n')
      ) return prev
      return { ...prev, [nid]: nextInfo }
    })
  }, [])

  const refreshNoteCardInfo = React.useCallback(
    async (meta: NoteMeta) => {
      const nid = String(meta?.id || '').trim()
      if (!nid) return
      const info = await loadNoteCardInfo(gateway.notes, 'library', meta, faceKindOrder).catch(() => null)
      if (!info) return
      upsertNoteCardInfo(nid, info)
    },
    [faceKindOrder, gateway, upsertNoteCardInfo],
  )

  const ensureNoteCardInfoLoaded = React.useCallback(
    async (meta: NoteMeta) => {
      const nid = String(meta?.id || '').trim()
      if (!nid) return
      if (noteCardInfoByIdRef.current[nid]) return
      await refreshNoteCardInfo(meta)
    },
    [refreshNoteCardInfo],
  )

  React.useEffect(() => {
    if (!visible) return
    if (visiblePage !== 'all-notes') return
    const ctl = startPrefetchNoteCardInfo({
      notes: allNotes,
      getInfoById: id => noteCardInfoByIdRef.current[id],
      refresh: ensureNoteCardInfoLoaded,
      maxWorkers: 6,
    })
    return () => ctl.cancel()
  }, [allNotes, ensureNoteCardInfoLoaded, visible, visiblePage])

  const noteIndexMap = React.useMemo(() => {
    const map: Record<string, { title: string; faceIds: string[] }> = {}
    for (const n of allNotes) {
      map[n.id] = { title: n.title, faceIds: noteCardInfoById[n.id]?.faceIds || [] }
    }
    return map
  }, [allNotes, noteCardInfoById])

  // ---- 工作区与侧边栏
  const commitActiveWorkspacePatch = React.useCallback(
    (patch: Partial<Pick<HyperCortexWorkspaceV1, 'title' | 'sidebarItems' | 'openTabKeys' | 'activeTabKey' | 'tabGroups' | 'tabGroupByTabKey'>>) => {
      setWorkspaces(prev => {
        const wid = activeWorkspaceIdRef.current
        if (!wid) return prev
        const idx = prev.findIndex(w => w.id === wid)
        if (idx < 0) return prev
        const current = prev[idx]
        const nextWs = applyActiveWorkspacePatch(current, patch as any)
        if (nextWs === current) return prev
        const nextList = prev.slice()
        nextList[idx] = nextWs

        if (repoReadyRef.current) {
          void persistRepoStatePatch(buildRepoStateSnapshot(nextList, wid)).catch(() => {})
        }

        return nextList
      })
    },
    [persistRepoStatePatch],
  )

  React.useEffect(() => {
    commitActiveWorkspacePatchRef.current = commitActiveWorkspacePatch
  }, [commitActiveWorkspacePatch])

  const applySidebarState = React.useCallback(
    (nextSidebarItems: SidebarItem[], patch?: Partial<Pick<HyperCortexWorkspaceV1, 'activeTabKey' | 'title'>>) => {
      const normalizedSidebarItems = ensureSidebarItems({
        sidebarItems: nextSidebarItems,
        openTabKeys: [],
        tabGroups: [],
        tabGroupByTabKey: {},
      })
      const derived = deriveSidebarFields(normalizedSidebarItems)
      setSidebarItems(normalizedSidebarItems)
      setTabGrouping({ groups: derived.tabGroups, byTabKey: derived.tabGroupByTabKey })
      setOpenTabKeys(derived.openTabKeys as any)
      commitActiveWorkspacePatch({
        sidebarItems: normalizedSidebarItems,
        openTabKeys: derived.openTabKeys,
        tabGroups: derived.tabGroups,
        tabGroupByTabKey: derived.tabGroupByTabKey,
        ...(patch || {}),
      })
      return { sidebarItems: normalizedSidebarItems, ...derived }
    },
    [commitActiveWorkspacePatch],
  )

  const updateSidebarItems = React.useCallback(
    (updater: (prev: SidebarItem[]) => SidebarItem[], patch?: Partial<Pick<HyperCortexWorkspaceV1, 'activeTabKey' | 'title'>>) => {
      const nextSidebarItems = updater(sidebarItemsRef.current)
      return applySidebarState(nextSidebarItems, patch)
    },
    [applySidebarState],
  )

  React.useEffect(() => {
    updateSidebarItemsRef.current = updateSidebarItems
  }, [updateSidebarItems])

  const handleMoveTabToUngroupedIndex = React.useCallback(
    (tabKey: string, index: number) => {
      const normalizedTabKey = String(tabKey || '').trim()
      if (!normalizedTabKey) return
      updateSidebarItems(prev => insertTabAsUngrouped(prev, normalizedTabKey, index))
    },
    [updateSidebarItems],
  )

  const handleMoveTabToGroupIndex = React.useCallback(
    (tabKey: string, groupId: string, index: number) => {
      const normalizedTabKey = String(tabKey || '').trim()
      const gid = String(groupId || '').trim()
      if (!normalizedTabKey || !gid) return
      updateSidebarItems(prev => moveTabToGroupIndex(prev, normalizedTabKey, gid, index))
    },
    [updateSidebarItems],
  )

  const handleMoveGroupToIndex = React.useCallback(
    (groupId: string, index: number) => {
      const gid = String(groupId || '').trim()
      if (!gid) return
      updateSidebarItems(prev => moveGroupToIndex(prev, gid, index))
    },
    [updateSidebarItems],
  )

  const handleCommitSidebarItems = React.useCallback(
    (nextSidebarItems: SidebarItem[]) => {
      applySidebarState(nextSidebarItems)
    },
    [applySidebarState],
  )

  const isHoverTabsMode = tabsMode === 'hover'
  const leftSidebarLayout = resolveSidebarLayout({
    mode: tabsMode,
    collapsed: tabsCollapsed,
    hoverOpen: tabsHoverOpen,
    expandedWidth: tabsSidebarWidth,
  })
  const sidebarPanelWidth = leftSidebarLayout.panelWidth

  const onSidebarMouseEnter = React.useCallback(() => {
    sidebarHoverRef.current = true
    if (isHoverTabsMode) setTabsHoverOpen(true)
  }, [isHoverTabsMode])

  const onSidebarMouseLeave = React.useCallback(() => {
    sidebarHoverRef.current = false
    handleSidebarPreviewHover(null)
    if (!isHoverTabsMode) return
    if (sidebarShortcutHoldRef.current) return
    setTabsHoverOpen(false)
  }, [handleSidebarPreviewHover, isHoverTabsMode])

  // ---- 收藏夹导航栏（右侧栏）
  const [favoritesHoverOpen, setFavoritesHoverOpen] = React.useState(false)
  const favoritesHoverRef = React.useRef(false)
  const favoritesSidebarShortcutHoldRef = React.useRef(false)
  const isHoverFavoritesMode = favoritesSidebarMode === 'hover'
  const rightSidebarLayout = resolveSidebarLayout({
    mode: favoritesSidebarMode,
    collapsed: favoritesSidebarCollapsed,
    hoverOpen: favoritesHoverOpen,
    expandedWidth: favoritesSidebarWidth,
  })

  const {
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
  } = useAppSettingsWritebacks({
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
  })

  const onFavoritesSidebarMouseEnter = React.useCallback(() => {
    favoritesHoverRef.current = true
    if (isHoverFavoritesMode) setFavoritesHoverOpen(true)
  }, [isHoverFavoritesMode])

  const onFavoritesSidebarMouseLeave = React.useCallback(() => {
    favoritesHoverRef.current = false
    handleSidebarPreviewHover(null)
    if (!isHoverFavoritesMode) return
    if (favoritesSidebarShortcutHoldRef.current) return
    setFavoritesHoverOpen(false)
  }, [handleSidebarPreviewHover, isHoverFavoritesMode])

  const persistFavoritesNav = React.useCallback(
    (next: HyperCortexFavoritesNavV1) => {
      setFavoritesNav(next)
      if (repoReadyRef.current) void persistRepoStatePatch({ favoritesNav: next }).catch(() => {})
    },
    [persistRepoStatePatch],
  )

  const handleFavoritesSidebarNavigate = React.useCallback(
    (folderId: string) => {
      const next = navigateFavoritesNav(favoritesNavRef.current, folderId)
      if (next === favoritesNavRef.current) return
      persistFavoritesNav(next)
    },
    [persistFavoritesNav],
  )

  const handleFavoritesSidebarBack = React.useCallback(() => {
    const next = goBackFavoritesNav(favoritesNavRef.current)
    if (next === favoritesNavRef.current) return
    persistFavoritesNav(next)
  }, [persistFavoritesNav])

  const handleFavoritesSidebarForward = React.useCallback(() => {
    const next = goForwardFavoritesNav(favoritesNavRef.current)
    if (next === favoritesNavRef.current) return
    persistFavoritesNav(next)
  }, [persistFavoritesNav])

  // 收藏夹文档变化（含实体删除）后调和导航位置：失效层回到根，历史剔除失效条目。
  React.useEffect(() => {
    if (!favoritesDoc) return
    const existing = new Set(Object.keys(favoritesDoc.folders || {}))
    const current = favoritesNavRef.current
    const next = reconcileFavoritesNav(current, existing)
    if (next === current) return
    persistFavoritesNav(next)
  }, [favoritesDoc, persistFavoritesNav])

  const applyWorkspaceSidebarState = React.useCallback(
    (ws: HyperCortexWorkspaceV1) => {
      const nextSidebarItems = ensureSidebarItems(ws)
      const derived = deriveSidebarFields(nextSidebarItems)
      const nextOpenTabKeys = normalizeOpenTabKeys(derived.openTabKeys)
      setSidebarItems(nextSidebarItems)
      setTabGrouping({ groups: derived.tabGroups, byTabKey: derived.tabGroupByTabKey || {} })
      setOpenTabKeys(nextOpenTabKeys as any)

      const preferredActiveKey = String(ws.activeTabKey || '').trim()
      if (preferredActiveKey && nextOpenTabKeys.includes(preferredActiveKey)) {
        setDetailSelectionSource('tabs')
        setActiveTabKey(preferredActiveKey as any)
        if (tabKind(preferredActiveKey) === 'note') setActiveNoteId(noteIdFromTabKey(preferredActiveKey))
        else setActiveNoteId('')
      } else {
        setActiveTabKey('')
        setActiveNoteId('')
      }

      const seq = (workspaceSwitchSeqRef.current += 1)
      if (!nextOpenTabKeys.length) {
        setOpenNoteIds([])
        setOpenAssetTabs([])
      } else {
        const noteKeys = nextOpenTabKeys.filter(k => tabKind(k) === 'note')
        setOpenNoteIds(noteKeys.map(k => noteIdFromTabKey(k)).filter(Boolean))
        void (async () => {
          try {
            const assetKeys = nextOpenTabKeys.filter(k => tabKind(k) === 'asset')
            const aidx = await gateway.assets.ensureAssetsIndex('library').catch(() => ({ version: 1, assets: {} } as any))
            const assetTabs = assetKeys
              .map(k => {
                const refKey = assetRefKeyFromTabKey(k)
                const parsed = parseAssetRefKey(refKey)
                if (!parsed) return null
                const entry = (aidx as any)?.assets?.[refKey]
                const relPath = String(entry?.path || '').trim()
                if (!relPath) return null
                const ext = parsed.ext || ''
                const mime = mimeFromExt(ext)
                const kind0 = String(entry?.kind || '').trim()
                const kind = kind0 || (mime ? kindFromMime(mime) : 'document')
                return {
                  relPath,
                  fileName: refKey,
                  displayName: String(entry?.displayName || '').trim() || undefined,
                  assetId: parsed.assetId,
                  ext,
                  kind: kind || 'document',
                  size: Number(entry?.size || 0) || 0,
                  modifiedMs: Number(entry?.modifiedMs || 0) || 0,
                } as AssetEntry
              })
              .filter(Boolean) as AssetEntry[]

            if (workspaceSwitchSeqRef.current !== seq) return
            setOpenAssetTabs(assetTabs)
          } catch {
            if (workspaceSwitchSeqRef.current !== seq) return
            setOpenAssetTabs([])
          }
        })()
      }

      const currentPage = pageRef.current
      if (currentPage === 'note-detail' || currentPage === 'asset-detail') {
        if (preferredActiveKey && nextOpenTabKeys.includes(preferredActiveKey)) {
          const targetPage = tabKind(preferredActiveKey) === 'asset' ? 'asset-detail' : 'note-detail'
          if (currentPage !== targetPage) navigatePage(targetPage, { recordHistory: false })
        } else {
          navigatePage(currentPage === 'note-detail' ? 'home' : 'attachments', { recordHistory: false })
        }
      }
    },
    [gateway, navigatePage],
  )

  React.useEffect(() => {
    applyWorkspaceSidebarStateRef.current = applyWorkspaceSidebarState
  }, [applyWorkspaceSidebarState])

  const handleSwitchWorkspace = React.useCallback(
    (workspaceId: string) => {
      const wid = String(workspaceId || '').trim()
      if (!wid || wid === activeWorkspaceIdRef.current) return
      const ws = workspaces.find(w => w.id === wid)
      if (!ws) return

      flushSidebarScrollTop()
      activeWorkspaceIdRef.current = wid
      setActiveWorkspaceId(wid)
      applyWorkspaceSidebarState(ws)
      if (repoReadyRef.current) {
        void persistRepoStatePatch(buildRepoStateSnapshot(workspaces, wid)).catch(() => {})
      }
    },
    [applyWorkspaceSidebarState, flushSidebarScrollTop, persistRepoStatePatch, workspaces],
  )

  const handleCreateWorkspace = React.useCallback(
    (title: string) => {
      const trimmed = String(title || '').trim()
      const nextTitle = trimmed || pickNextWorkspaceTitle(workspaces)
      const nextWs: HyperCortexWorkspaceV1 = {
        id: createWorkspaceId(),
        title: nextTitle,
        sidebarItems: [],
        tabGroups: [],
        openTabKeys: [],
        tabGroupByTabKey: {},
        activeTabKey: '',
      }
      const nextWorkspaces = [...workspaces, nextWs]

      flushSidebarScrollTop()
      activeWorkspaceIdRef.current = nextWs.id
      setWorkspaces(nextWorkspaces)
      setActiveWorkspaceId(nextWs.id)
      applyWorkspaceSidebarState(nextWs)
      if (repoReadyRef.current) {
        void persistRepoStatePatch(buildRepoStateSnapshot(nextWorkspaces, nextWs.id)).catch(() => {})
      }
      void gateway.host.toast(`已新建工作区：${nextTitle}`)
    },
    [gateway, applyWorkspaceSidebarState, flushSidebarScrollTop, persistRepoStatePatch, workspaces],
  )

  const handleRenameWorkspace = React.useCallback(
    (workspaceId: string, title: string) => {
      const wid = String(workspaceId || '').trim()
      const nextTitle = String(title || '').trim()
      if (!wid || !nextTitle) return
      const nextWorkspaces = updateWorkspaceById(workspaces, wid, ws => ({ ...ws, title: nextTitle }))
      if (nextWorkspaces === workspaces) return
      setWorkspaces(nextWorkspaces)
      if (repoReadyRef.current) {
        void persistRepoStatePatch(buildRepoStateSnapshot(nextWorkspaces, activeWorkspaceIdRef.current)).catch(() => {})
      }
    },
    [persistRepoStatePatch, workspaces],
  )

  const handleDeleteWorkspace = React.useCallback(
    (workspaceId: string) => {
      const wid = String(workspaceId || '').trim()
      if (!wid) return
      if (workspaces.length <= 1) return void gateway.host.toast('至少保留一个工作区')
      const target = workspaces.find(w => w.id === wid)
      if (!target) return

      const nextWorkspaces = workspaces.filter(w => w.id !== wid)
      const deletingActive = activeWorkspaceIdRef.current === wid
      const nextActiveId = deletingActive ? nextWorkspaces[0]?.id || '' : activeWorkspaceIdRef.current
      const nextActiveWs = nextWorkspaces.find(w => w.id === nextActiveId) || nextWorkspaces[0]
      if (!nextActiveWs) return

      // 删除工作区时丢弃其滚动记账，并随本次写盘一并落盘。
      clearSidebarScrollMemory(wid)
      flushSidebarScrollTop()

      activeWorkspaceIdRef.current = nextActiveId
      setWorkspaces(nextWorkspaces)
      setActiveWorkspaceId(nextActiveId)
      if (deletingActive) applyWorkspaceSidebarState(nextActiveWs)
      if (repoReadyRef.current) {
        void persistRepoStatePatch(buildRepoStateSnapshot(nextWorkspaces, nextActiveId)).catch(() => {})
      }
      void gateway.host.toast(`已删除工作区：${target.title}`)
    },
    [clearSidebarScrollMemory, flushSidebarScrollTop, gateway, applyWorkspaceSidebarState, persistRepoStatePatch, workspaces],
  )

  const handleCreateTabGroup = React.useCallback(() => {
    const nextGroup: HyperCortexTabGroupV1 = {
      id: createTabGroupId(),
      title: pickNextTabGroupTitle(tabGroupingRef.current.groups),
      color: pickNextTabGroupColor(tabGroupingRef.current.groups),
      collapsed: false,
    }
    updateSidebarItems(prev => createGroupInSidebar(prev, nextGroup))
  }, [updateSidebarItems])

  const handleCollapseAllGroups = React.useCallback(() => {
    updateSidebarItems(prev => prev.map(item => (item.type === 'group' && item.collapsed !== true ? { ...item, collapsed: true } : item)))
  }, [updateSidebarItems])

  const handleAssignTabToGroup = React.useCallback(
    (tabKey: string, groupId: string) => {
      const normalizedTabKey = String(tabKey || '').trim()
      const gid = String(groupId || '').trim()
      if (!normalizedTabKey || !gid) return
      updateSidebarItems(prev => moveTabBetweenGroups({ sidebarItems: prev, tabKey: normalizedTabKey, targetGroupId: gid }))
    },
    [updateSidebarItems],
  )

  const handleUnassignTabFromGroup = React.useCallback(
    (tabKey: string) => {
      const normalizedTabKey = String(tabKey || '').trim()
      if (!normalizedTabKey) return
      updateSidebarItems(prev => insertTabAsUngrouped(prev, normalizedTabKey, prev.length))
    },
    [updateSidebarItems],
  )

  const handleToggleGroupCollapsed = React.useCallback(
    (groupId: string) => {
      const gid = String(groupId || '').trim()
      if (!gid) return
      updateSidebarItems(prev => prev.map(item => (item.type === 'group' && item.id === gid ? { ...item, collapsed: !item.collapsed } : item)))
    },
    [updateSidebarItems],
  )

  const handleRenameGroup = React.useCallback(
    (groupId: string, title: string) => {
      const gid = String(groupId || '').trim()
      const nextTitle = String(title || '').trim()
      if (!gid || !nextTitle) return
      updateSidebarItems(prev => updateSidebarGroup(prev, gid, { title: nextTitle }))
    },
    [updateSidebarItems],
  )

  const handleSetGroupColor = React.useCallback(
    (groupId: string, color: string) => {
      const gid = String(groupId || '').trim()
      const nextColor = String(color || '').trim()
      if (!gid || !nextColor) return
      updateSidebarItems(prev => updateSidebarGroup(prev, gid, { color: nextColor }))
    },
    [updateSidebarItems],
  )

  const handleDeleteGroupOnly = React.useCallback(
    (groupId: string) => {
      const gid = String(groupId || '').trim()
      if (!gid) return
      updateSidebarItems(prev => deleteGroupFromSidebar(prev, gid))
    },
    [updateSidebarItems],
  )

  const handleNavigateFolder = React.useCallback(
    (folderId: string) => {
      setCurrentFolderId(folderId)
      if (repoReadyRef.current) void persistRepoStatePatch({ currentFolderId: folderId }).catch(() => {})
    },
    [persistRepoStatePatch],
  )

  const handleFavoritesDocChange = React.useCallback(
    (nextDoc: HyperCortexFavoritesDocV1) => {
      setFavoritesDoc(nextDoc)
      // 内存保留草稿引用；落盘由账本管理员统一转换（磁盘态过滤草稿引用）。
      favoritesLedger.commit(nextDoc)
    },
    [favoritesLedger],
  )

  // ---- 草稿身份编排：档案与解析派生、草稿登记与打开、左右两侧新建入口、档案变化的左右调和。
  const {
    draftIdentity,
    resolvedNoteIndex,
    openNoteTabs,
    consumeInitSnapshot,
    handleCreateDraftNote,
    handleCreateDraftNoteInFolder,
  } = useDraftOrchestration({
    noteIndex,
    openNoteIds,
    sidebarItemsRef,
    activeTabKeyRef,
    favoritesDocRef,
    tabsInitReady,
    activeWorkspaceIdRef,
    enqueueAppCommand,
    defaultFaceKinds,
    faceKindOrder,
    updateSidebarItems,
    handleFavoritesDocChange,
    navigatePage,
    setOpenNoteIds,
    setActiveNoteId,
    setActiveTabKey,
    setDetailSelectionSource,
  })

  // 常驻键盘回调读取合并后的索引（含草稿），与渲染消费同一份解析结果。
  const noteIndexRef = React.useRef<{ notes?: Record<string, NoteMeta> }>({ notes: resolvedNoteIndex })
  React.useEffect(() => {
    noteIndexRef.current = { notes: resolvedNoteIndex }
  }, [resolvedNoteIndex])

  const handleUpdateNoteInfo = React.useCallback(
    async (note: NoteMeta, patch: { title: string; description: string }) => {
      const dir = String(note.dir || '').trim()
      if (isDraftNoteId(note.id) || !dir) {
        void gateway.host.toast('草稿暂无所在目录（请先保存后再编辑信息）')
        return
      }
      try {
        // 笔记信息更新走统一通道：读 manifest + 提交笔记级元数据，内容不动。
        const loaded = await gateway.notes.loadNoteManifest('library', dir)
        const result = await gateway.notes.saveNoteFaces('library', {
          id: note.id,
          packageDir: dir,
          title: patch.title,
          description: patch.description,
          tags: loaded.tags,
          createdAtMs: loaded.createdAtMs,
          resources: loaded.resources,
          faceKinds: [],
          faces: [],
        })
        setNoteIndex(prev => {
          const current = prev || { version: 1, notes: {} }
          return { ...current, notes: { ...(current.notes || {}), [note.id]: result.meta } }
        })
        void refreshNoteCardInfo(result.meta).catch(() => {})
        void gateway.host.toast('笔记信息已更新')
      } catch (err: any) {
        void gateway.host.toast(`更新笔记信息失败：${String(err?.message || err || '未知错误')}`)
      }
    },
    [gateway, refreshNoteCardInfo],
  )

  const handleUploadAssetsIntoIndex = React.useCallback(
    async (folderId: string) => {
      const fid = String(folderId || '').trim() || 'root'
      const baseDoc = favoritesDoc
      if (!baseDoc) return

      try {
        const task = await startPickedLocalAssetUploadTask(gateway, 'library')
        if (!task) return
        void gateway.host.toast('上传任务已开始，完成后会添加到当前索引')

        let completed = task
        while (completed.status === 'queued' || completed.status === 'running' || completed.status === 'paused') {
          await sleep(ASSET_UPLOAD_WAIT_INTERVAL_MS)
          const tasks = await gateway.assets.listUploadTasks()
          completed = tasks.find(item => item.id === task.id) || completed
        }

        if (completed.status === 'failed') throw new Error(completed.error || '上传任务失败')
        if (completed.status === 'canceled') {
          void gateway.host.toast('上传任务已取消')
          return
        }

        const imported = completed.result || []
        if (!imported.length) return
        let nextDoc = baseDoc
        let addedCount = 0
        for (const resource of imported) {
          const key = assetKeyFromResource(resource)
          if (!key) continue
          const added = addRef(nextDoc, fid, 'asset', key)
          if (!added) continue
          nextDoc = added.doc
          addedCount += 1
        }

        if (nextDoc !== baseDoc) handleFavoritesDocChange(nextDoc)
        const nextAssetIndex = await gateway.assets.ensureAssetsIndex('library').catch(() => null)
        if (nextAssetIndex) setAssetPoolIndex(nextAssetIndex as any)
        void gateway.host.toast(addedCount > 0 ? `已上传并添加 ${addedCount} 个附件` : '附件已上传，但没有新增索引卡片')
      } catch (err: any) {
        void gateway.host.toast(`上传附件失败：${String(err?.message || err || '未知错误')}`)
      }
    },
    [favoritesDoc, gateway, handleFavoritesDocChange],
  )

  const handleRepoRestored = React.useCallback(
    async (repo: HyperCortexRepo) => {
      await refreshRepos()
      void gateway.host.toast(`已恢复仓库：${repo.title}`)
    },
    [gateway, refreshRepos],
  )

  const handleDeleteNote = React.useCallback(
    async (payload: { note: NoteMeta; mode: 'trash' | 'permanent' }) => {
      const note = payload.note
      const nid = String(note?.id || '').trim()
      if (!nid) return

      if (isDraftNoteId(nid) || !String(note?.dir || '').trim()) {
        closeTabKeysDirectRef.current([noteTabKey(nid)])
        setNoteIndex(prev => {
          const current = prev || { version: 1, notes: {} }
          const nextNotes = { ...(current.notes || {}) }
          delete nextNotes[nid]
          return { ...current, notes: nextNotes }
        })
        bumpRefRelationsEpoch()
        return
      }

      try {
        if (payload.mode === 'trash') await gateway.trash.moveNoteToTrash('library', note)
        else await gateway.trash.permanentlyDeleteNoteDir('library', nid, note.dir)

        closeTabKeysDirectRef.current([noteTabKey(nid)])
        setNoteIndex(prev => {
          const current = prev || { version: 1, notes: {} }
          const nextNotes = { ...(current.notes || {}) }
          delete nextNotes[nid]
          return { ...current, notes: nextNotes }
        })
        bumpRefRelationsEpoch()
      } catch (e: any) {
        // 失败向上抛出：由调用方保留确认界面并提示，避免「删除失败但对话框已关」。
        throw e
      }
    },
    [bumpRefRelationsEpoch, gateway],
  )

  const handleDeleteFolderEntity = React.useCallback(
    (folderId: string) => {
      const id = String(folderId || '').trim()
      if (!id) return
      // 删除收藏夹时丢弃其滚动记账，避免陈旧记忆残留。
      clearFavoritesScrollMemory(id)
      if (currentFolderId === id) {
        setCurrentFolderId('root')
        if (repoReadyRef.current) void persistRepoStatePatch({ currentFolderId: 'root' }).catch(() => {})
      }
    },
    [clearFavoritesScrollMemory, currentFolderId, persistRepoStatePatch],
  )

  const confirmDeleteNoteFromCard = React.useCallback(async () => {
    const target = noteCardDeleteTarget
    if (!target) return
    closeNoteCardMenu()
    const mode: 'trash' | 'permanent' = trashEnabled ? 'trash' : 'permanent'
    try {
      await handleDeleteNote({ note: target, mode })
      setNoteCardDeleteTarget(null)
    } catch (e: any) {
      void gateway.host.toast(String(e?.message || e || '删除失败'))
    }
  }, [closeNoteCardMenu, gateway.host, handleDeleteNote, noteCardDeleteTarget, trashEnabled])

  const requestCopyTitleFromCardMenu = React.useCallback(async () => {
    const note = noteCardMenu?.note
    if (!note) return
    closeNoteCardMenu()
    const title = String(note.title || '').trim() || '未命名'
    try {
      await gateway.clipboard.writeText(title)
      void gateway.host.toast('已复制标题')
    } catch (e: any) {
      void gateway.host.toast(String(e?.message || e || '复制失败'))
    }
  }, [gateway, closeNoteCardMenu, noteCardMenu])

  const requestOpenDirFromCardMenu = React.useCallback(async () => {
    const note = noteCardMenu?.note
    if (!note) return
    closeNoteCardMenu()
    if (isDraftNoteId(note.id) || !String(note.dir || '').trim()) {
      void gateway.host.toast('草稿暂无所在目录（请先保存）')
      return
    }
    try {
      await gateway.host.openVaultDir('library', note.dir)
    } catch (e: any) {
      void gateway.host.toast(String(e?.message || e || '打开目录失败'))
    }
  }, [gateway, closeNoteCardMenu, noteCardMenu])

  const handleTrashRestored = React.useCallback(
    (meta: NoteMeta, kind: 'note' | 'asset' | 'face' = 'note') => {
      if (!meta?.id) return
      setNoteIndex(prev => {
        const current = prev || { version: 1, notes: {} }
        const nextNotes = { ...(current.notes || {}) }
        nextNotes[meta.id] = meta
        return { ...current, notes: nextNotes }
      })
      void refreshNoteCardInfo(meta).catch(() => {})
      // 恢复会带回该笔记（或其面）发出的引用，反向引用需重取。
      bumpRefRelationsEpoch()
      if (kind === 'face') {
        const handle = noteSessionHandlesRef.current[meta.id]
        if (handle && !handle.isDirty() && !handle.isSaving()) {
          void handle.reload().catch(() => {})
        }
      }
      void gateway.host.toast(kind === 'face' ? '已恢复笔记面' : '已恢复笔记')
    },
    [bumpRefRelationsEpoch, gateway, refreshNoteCardInfo],
  )

  useAppCommandDispatch({
    visible,
    tabsInitReady,
    activeWorkspaceId,
    repoReady,
    visiblePage,
    appCommandQueue,
    consumeAppCommand,
    refreshDataDirStatus,
    gateway,
    handleCreateDraftNote,
    navigatePage,
    setShortcutHintsOpen,
    setQuickSearchOpen,
  })

  useGlobalShortcuts({
    visible,
    shortcutBindingsRef,
    shortcutRecordingRef,
    shortcutHintsOpen,
    setShortcutHintsOpen,
    pageRef,
    openModalPageRef,
    activeNoteIdRef,
    activeTabKeyRef,
    openTabKeysRef,
    sidebarItemsRef,
    favoritesFolderViewRef,
    resolvedSelectionSourceRef,
    activateFavoritesEntryKeyRef,
    activateExistingTabKeyRef,
    setFavoritesActiveScrollSignal,
    setActiveTabScrollSignal,
    previewHoldRef,
    cancelPreviewClear,
    applyPreviewTarget,
    stopPreview,
    tabsMode,
    setTabsHoverOpen,
    sidebarShortcutHoldRef,
    sidebarHoverRef,
    toggleTabsCollapsed,
    favoritesSidebarMode,
    setFavoritesHoverOpen,
    favoritesSidebarShortcutHoldRef,
    favoritesHoverRef,
    toggleFavoritesSidebarCollapsed,
    goBackPage,
    handleShortcutOpenPage,
    handleCreateDraftNote,
    setQuickSearchOpen,
    requestCloseTabRef,
    closeTabKeysDirectRef,
    noteSessionHandlesRef,
  })

  const handleOpenNote = React.useCallback(
    (note: NoteMeta, faceId?: string, source: 'tabs' | 'favorites' = 'tabs', opts?: { recordHistory?: boolean }) => {
      const nid = draftIdentity.resolveId(String(note?.id || '').trim())
      if (!nid) return
      setDetailSelectionSource(source)
      // 打开笔记统一收浮层：无论从模态页、侧栏、引用还是创建流程进入。
      setOpenModalPage(null)
      const nextKey = noteTabKey(nid)
      const prevActiveKey = String(activeTabKeyRef.current || '').trim()
      const recordHistory = opts?.recordHistory !== false
      if (recordHistory && (pageRef.current === 'note-detail' || pageRef.current === 'asset-detail') && prevActiveKey && prevActiveKey !== nextKey) {
        recordNewNavLocation({ page: pageRef.current, tabKey: prevActiveKey })
      }
      setOpenNoteIds(prev => {
        return prev.includes(nid) ? prev : [...prev, nid]
      })
      setActiveNoteId(nid)
      setActiveTabKey(nextKey)
      // 来源为右侧收藏夹时不改动左侧列表：右侧选中只是切换详情目标，
      // 不应把条目塞进左侧「已打开笔记」；仅持久化当前目标键（草稿键落盘时被过滤）。
      if (source === 'tabs') {
        updateSidebarItems(prev => (deriveSidebarFields(prev).openTabKeys.includes(nextKey) ? prev : insertTabAsUngrouped(prev, nextKey, prev.length)), { activeTabKey: nextKey })
      } else {
        commitActiveWorkspacePatch({ activeTabKey: nextKey })
      }
      navigatePage('note-detail', { recordHistory })
      const targetFace = String(faceId || '').trim()
      if (targetFace) {
        faceSwitchSeqRef.current += 1
        const seq = faceSwitchSeqRef.current
        setFaceSwitchLatestSeq(seq)
        setFaceSwitchRequest({ noteId: nid, faceId: targetFace, seq })
      }
    },
    [commitActiveWorkspacePatch, draftIdentity, navigatePage, recordNewNavLocation, updateSidebarItems],
  )

  const handleCreateNoteInIndex = React.useCallback(
    async (folderId: string) => {
      const fid = String(folderId || '').trim() || 'root'
      const baseDoc = favoritesDoc
      if (!baseDoc) return

      try {
        const result = await gateway.notes.createEmptyNote('library', {
          title: '未命名',
          description: '',
          tags: [],
          faceKinds: orderKindsByGlobalOrder(defaultFaceKinds, faceKindOrder),
        })
        const meta = result.meta
        const added = addRef(baseDoc, fid, 'note', meta.id)
        if (!added) {
          void gateway.host.toast('笔记已创建，但无法添加到当前索引页')
          return
        }

        handleFavoritesDocChange(added.doc)
        setNoteIndex(prev => {
          const current = prev || { version: 1, notes: {} }
          return { ...current, notes: { ...(current.notes || {}), [meta.id]: meta } }
        })
        // 会话初始状态与普通新建共用同一构造入口；面清单取自后端已创建的真实清单。
        draftIdentity.putInitSnapshot(meta.id, buildNoteInitSnapshot({
          faceManifests: result.manifest.faces,
          faceOrder: result.manifest.faceOrder,
          globalKindOrder: faceKindOrder,
          title: meta.title || '未命名',
          description: meta.description || '',
          tags: [],
          resources: [],
          noteTimes: {
            createdAtMs: Number(meta.createdAtMs) > 0 ? Number(meta.createdAtMs) : Date.now(),
            updatedAtMs: Number(meta.updatedAtMs) > 0 ? Number(meta.updatedAtMs) : Date.now(),
          },
        }))
        handleOpenNote(meta)
        void gateway.host.toast('已创建空白笔记并添加到索引页')
      } catch (e: any) {
        void gateway.host.toast(String(e?.message || e || '创建笔记失败'))
      }
    },
    [defaultFaceKinds, draftIdentity, faceKindOrder, favoritesDoc, gateway, handleFavoritesDocChange, handleOpenNote],
  )

  // 右侧收藏夹导航栏条目的实体操作：解析条目引用为统一目标，复用与索引页相同的菜单与对话框。
  // 附件查找表复用当前页视图，避免各处重复组装。
  const favoritesAssetLookup = favoritesFolderView.lookup
  const favoritesEntity = useFavoritesEntityActions({
    doc: favoritesDoc || { version: 1, rootFolderId: 'root', folders: {}, refsByFolderId: {} },
    onDocChange: handleFavoritesDocChange,
    toast: message => void gateway.host.toast(message),
    onOpenFolder: handleFavoritesSidebarNavigate,
    onOpenNote: note => void handleOpenNote(note, undefined, 'favorites'),
    onOpenAsset: asset => handleOpenAssetTab(asset, 'favorites'),
    canMoveRefs: true,
    onUpdateNoteInfo: handleUpdateNoteInfo,
    onUpdateAssetInfo: handleUpdateAssetInfo,
    onDeleteFolderEntity: handleDeleteFolderEntity,
    onDeleteNoteEntity: note => void handleDeleteNote({ note, mode: trashEnabled ? 'trash' : 'permanent' }).catch((e: any) => void gateway.host.toast(String(e?.message || e || '删除失败'))),
    onDeleteAssetEntity: requestDeleteAssetEntity,
  })

  const handleFavoritesSidebarContextMenu = React.useCallback(
    (event: React.MouseEvent, ref: FavoriteItemRef) => {
      let target: FavoritesEntityTarget
      if (ref.kind === 'folder') {
        target = { kind: 'folder', refId: ref.id, folderId: ref.targetId }
      } else if (ref.kind === 'note') {
        const note = resolvedNoteIndex[ref.targetId]
        target = note ? { kind: 'note', refId: ref.id, note } : { kind: 'stale', refId: ref.id }
      } else if (ref.kind === 'asset') {
        const asset = resolveAssetRef(favoritesAssetLookup, ref.targetId)
        target = asset ? { kind: 'asset', refId: ref.id, asset } : { kind: 'stale', refId: ref.id }
      } else {
        target = { kind: 'stale', refId: ref.id }
      }
      favoritesEntity.openMenu(event, target)
    },
    [favoritesAssetLookup, favoritesEntity, resolvedNoteIndex],
  )

  const handleFavoritesSidebarReorder = React.useCallback(
    (folderId: string, orderedRefIds: string[]) => {
      const base = favoritesDoc
      if (!base) return
      const next = reorderRefsInFolder(base, folderId, orderedRefIds)
      if (next !== base) handleFavoritesDocChange(next)
    },
    [favoritesDoc, handleFavoritesDocChange],
  )

  const activateExistingTabKey = React.useCallback(
    (tabKey: string, opts?: { recordHistory?: boolean }) => {
      const key = String(tabKey || '').trim()
      if (!key) return false
      if (!openTabKeysRef.current.includes(key)) return false

      const kind = tabKind(key)
      if (kind === 'note') {
        const nid = noteIdFromTabKey(key)
        if (!nid) return false
        setDetailSelectionSource('tabs')
        setActiveTabKey(key)
        setActiveNoteId(nid)
        commitActiveWorkspacePatch({ activeTabKey: key })
        navigatePage('note-detail', opts)
        return true
      }

      if (kind === 'asset') {
        setDetailSelectionSource('tabs')
        setActiveTabKey(key)
        setActiveNoteId('')
        commitActiveWorkspacePatch({ activeTabKey: key })
        navigatePage('asset-detail', opts)
        return true
      }

      return false
    },
    [commitActiveWorkspacePatch, navigatePage],
  )

  React.useEffect(() => {
    activateExistingTabKeyRef.current = activateExistingTabKey
  }, [activateExistingTabKey])

  // 右侧条目激活：命中当前页条目时打开详情，并把选中来源归到右侧栏。
  const activateFavoritesEntryKey = React.useCallback(
    (tabKey: string) => {
      const key = String(tabKey || '').trim()
      if (!key) return false
      const view = favoritesFolderViewRef.current
      const entry = view.entries.find(item => item.tabKey === key)
      if (!entry) return false
      if (entry.ref.kind === 'note') {
        const note = noteIndexRef.current?.notes?.[entry.ref.targetId]
        if (!note) return false
        handleOpenNote(note, undefined, 'favorites', { recordHistory: false })
        return true
      }
      if (entry.ref.kind === 'asset') {
        const asset = resolveAssetRef(view.lookup, entry.ref.targetId)
        if (!asset) return false
        handleOpenAssetTab(asset, 'favorites', { recordHistory: false })
        return true
      }
      return false
    },
    [handleOpenAssetTab, handleOpenNote],
  )

  React.useEffect(() => {
    activateFavoritesEntryKeyRef.current = activateFavoritesEntryKey
  }, [activateFavoritesEntryKey])

  const closeTabKeysDirect = React.useCallback(
    (tabKeys: string[]) => {
      const closing = new Set(tabKeys.map(s => String(s || '').trim()).filter(Boolean))
      if (!closing.size) return

      const prevKeys = openTabKeysRef.current || []
      const nextKeys = prevKeys.filter(k => !closing.has(k))
      const currentActive = String(activeTabKeyRef.current || '').trim()

      // 先按档案解析再过滤打开列表：转正草稿的原始标识经解析落到真实标识，随真实标签一并关闭。
      // 必须同步求值（函数式更新会被推迟到 discard 之后执行，届时解析已失效）。
      const nextOpenNoteIds = filterOpenNoteIdsForClose(draftIdentity, openNoteIdsRef.current, closing)

      for (const key of closing) {
        if (tabKind(key) !== 'note') continue
        const nid = noteIdFromTabKey(key)
        if (!nid) continue
        // 草稿被放弃：只在档案注销一次，收藏夹引用等消费方订阅后自动清理。
        draftIdentity.discard(nid)
        delete noteSessionHandlesRef.current[nid]
        delete noteScrollTopByIdRef.current[nid]
      }

      let nextActive = currentActive
      const didCloseActive = currentActive && closing.has(currentActive)
      if (didCloseActive) {
        const prevIdx = prevKeys.indexOf(currentActive)
        nextActive = nextKeys[prevIdx] || nextKeys[prevIdx - 1] || ''
      }

      updateSidebarItems(prev => closeTabsInSidebar(prev, Array.from(closing)), { activeTabKey: nextActive })

      setOpenNoteIds(nextOpenNoteIds)
      setOpenAssetTabs(prev => prev.filter(a => !closing.has(assetTabId(a))))

      setActiveTabKey(nextActive as any)

      if (!didCloseActive) return

      // 关闭了当前激活目标：选中态回到左侧标签栏（右侧栏引用已不在当前详情）。
      setDetailSelectionSource('tabs')

      if (!nextActive) {
        setActiveNoteId('')
        if (pageRef.current === 'note-detail') navigatePage('home', { recordHistory: false })
        if (pageRef.current === 'asset-detail') navigatePage('attachments', { recordHistory: false })
        if (repoReadyRef.current) void persistRepoStatePatch({ activeTabKey: '' }).catch(() => {})
        return
      }

      activateExistingTabKey(nextActive, { recordHistory: false })
    },
    [activateExistingTabKey, draftIdentity, navigatePage, persistRepoStatePatch, updateSidebarItems],
  )

  React.useEffect(() => {
    closeTabKeysDirectRef.current = closeTabKeysDirect
  }, [closeTabKeysDirect])

  const handleCloseAssetTab = React.useCallback(
    (tabKey: string) => {
      const closingKey = String(tabKey || '').trim()
      if (!closingKey) return
      closeTabKeysDirect([closingKey])
    },
    [closeTabKeysDirect],
  )

  const handleCloseTabs = React.useCallback(
    (noteIds: string[]) => {
      const keys = (Array.isArray(noteIds) ? noteIds : []).map(id => noteTabKey(String(id || '').trim())).filter(Boolean)
      closeTabKeysDirect(keys)
    },
    [closeTabKeysDirect],
  )

  const requestCloseTab = React.useCallback(
    (noteId: string) => {
      const nid = String(noteId || '').trim()
      if (!nid) return
      if (isNoteDirtyById(nid)) return setCloseTabPrompt({ noteId: nid })
      handleCloseTabs([nid])
    },
    [handleCloseTabs, isNoteDirtyById],
  )

  const handleCloseTab = React.useCallback((noteId: string) => requestCloseTab(noteId), [requestCloseTab])

  React.useEffect(() => {
    requestCloseTabRef.current = requestCloseTab
  }, [requestCloseTab])

  const handleDeleteGroupAndCloseTabs = React.useCallback(
    (groupId: string) => {
      const gid = String(groupId || '').trim()
      if (!gid) return
      const group = sidebarItemsRef.current.find(item => item.type === 'group' && item.id === gid)
      const keysToClose = group && group.type === 'group' ? group.tabKeys.slice() : []
      handleDeleteGroupOnly(gid)
      if (keysToClose.length) closeTabKeysDirect(keysToClose)
    },
    [closeTabKeysDirect, handleDeleteGroupOnly],
  )

  const handleNoteSessionSaved = React.useCallback((payload: {
    originalId: string
    meta: NoteMeta
    snapshotForNewId?: NoteDetailSnapshotV1
  }) => {
    const originalId = String(payload.originalId || '').trim()
    const meta = payload.meta
    if (!originalId || !meta?.id) return

    const didMigrateId = meta.id !== originalId
    if (didMigrateId) {
      // 草稿转正：只在档案内把标识改指向真实笔记（带上新会话快照）。
      // 打开的标签列表保留草稿标识，读取时经档案解析自动指向真实笔记，消费方无需搬运。
      draftIdentity.promote(originalId, meta.id, payload.snapshotForNewId)
      delete noteSessionHandlesRef.current[originalId]
      if (noteScrollTopByIdRef.current[originalId] != null) {
        noteScrollTopByIdRef.current[meta.id] = noteScrollTopByIdRef.current[originalId]
        delete noteScrollTopByIdRef.current[originalId]
      }
      setCloseTabPrompt(p => (p?.noteId === originalId ? { noteId: meta.id } : p))
    }

    setNoteIndex(prev => {
      const current = prev || { version: 1, notes: {} }
      const nextNotes = { ...(current.notes || {}) }
      if (didMigrateId) delete nextNotes[originalId]
      nextNotes[meta.id] = meta
      return { ...current, notes: nextNotes }
    })

    void refreshNoteCardInfo(meta).catch(() => {})

    // 保存（含面删除、版本恢复）会改变该笔记发出的引用，打开的会话重取反向引用。
    bumpRefRelationsEpoch()

    if (activeNoteId === originalId) setActiveNoteId(meta.id)
  }, [activeNoteId, bumpRefRelationsEpoch, draftIdentity, refreshNoteCardInfo])

  const closeTabPromptTargetSaving = !!closeTabPrompt && isNoteSavingById(closeTabPrompt.noteId)

  const closeTabPromptTitle = React.useMemo(() => {
    const nid = String(closeTabPrompt?.noteId || '').trim()
    if (!nid) return '未命名'
    const meta = openNoteTabs.find(t => t.id === nid) || allNotes.find(n => n.id === nid)
    return meta?.title || nid.slice(0, 12) + '…'
  }, [allNotes, closeTabPrompt?.noteId, openNoteTabs])

  const handleCloseTabPromptCancel = React.useCallback(() => setCloseTabPrompt(null), [])

  const handleCloseTabPromptGoSave = React.useCallback(() => {
    const nid = String(closeTabPrompt?.noteId || '').trim()
    if (!nid) return
    setCloseTabPrompt(null)
    setDetailSelectionSource('tabs')
    setActiveNoteId(nid)
    setActiveTabKey(noteTabKey(nid))
    commitActiveWorkspacePatch({ activeTabKey: noteTabKey(nid) })
    navigatePage('note-detail')
    noteSessionHandlesRef.current[nid]?.enterEditMode?.()
  }, [closeTabPrompt?.noteId, commitActiveWorkspacePatch, navigatePage])

  const handleCloseTabPromptDiscardAndClose = React.useCallback(() => {
    const nid = String(closeTabPrompt?.noteId || '').trim()
    if (!nid) return
    setCloseTabPrompt(null)
    noteSessionHandlesRef.current[nid]?.discardChanges?.()
    handleCloseTabs([nid])
  }, [closeTabPrompt?.noteId, handleCloseTabs])

  // 模态窗里复用与独立页面完全相同的身体；在浮层内打开详情类目标时先收起浮层。
  const renderModalBodyNode = (): React.ReactNode => {
    switch (openModalPage) {
      case 'home':
        return (
          <HomePage
            stats={homeStats}
            recentNotes={homeRecentNotes}
            activeWorkspaceTitle={activeWorkspaceTitle}
            onCreateNote={handleCreateDraftNote}
            onOpenIndex={() => navigatePage('index')}
            onOpenAttachments={() => navigatePage('attachments')}
            onOpenAllNotes={() => navigatePage('all-notes')}
            onOpenSearch={() => setQuickSearchOpen(true)}
            onOpenNote={note => void handleOpenNote(note)}
          />
        )
      case 'index': {
        if (!favoritesDoc) return null
        return (
          <IndexPage
            gateway={gateway}
            activeRepoId={repoId}
            doc={favoritesDoc}
            currentFolderId={currentFolderId}
            noteIndex={resolvedNoteIndex}
            assetIndex={assetPoolIndex?.assets}
            onNavigateFolder={handleNavigateFolder}
            onOpenNote={handleOpenNote}
            onOpenAsset={asset => {
              setOpenModalPage(null)
              void handleOpenAssetTab(asset)
            }}
            onDocChange={handleFavoritesDocChange}
            onCreateNoteInIndex={handleCreateNoteInIndex}
            onUploadAssetsInIndex={handleUploadAssetsIntoIndex}
            onDeleteFolderEntity={handleDeleteFolderEntity}
            onDeleteNoteEntity={note => void handleDeleteNote({ note, mode: trashEnabled ? 'trash' : 'permanent' }).catch((e: any) => void gateway.host.toast(String(e?.message || e || '删除失败')))}
            onDeleteAssetEntity={requestDeleteAssetEntity}
            onUpdateNoteInfo={handleUpdateNoteInfo}
            onUpdateAssetInfo={handleUpdateAssetInfo}
          />
        )
      }
      case 'attachments':
        return (
          <AssetPoolPanel
            gateway={gateway}
            scope="library"
            activeRepoId={repoId}
            onOpenAsset={asset => {
              setOpenModalPage(null)
              void handleOpenAssetTab(asset)
            }}
          />
        )
      case 'all-notes':
        return (
          <AllNotesPage
            notes={allNotes}
            loading={noteIndexLoading}
            errorText={noteIndexLoadError}
            layout={allNotesLayout}
            noteCardInfoById={noteCardInfoById}
            onLayoutToggle={toggleAllNotesLayout}
            onOpenNote={handleOpenNote}
            onCopyRef={note => {
              void gateway.clipboard.writeText(buildNotePlaceholderForCopy(note.id, note.title))
              void gateway.host.toast('已复制引用占位符')
            }}
            onMore={openNoteCardMenu}
          />
        )
      case 'settings':
        return renderSettingsPage()
      default:
        return null
    }
  }

  const renderSettingsPage = () => (
    <SettingsPage
      dataDirStatus={shell.dataDirStatus}
      onRefreshDataDirStatus={shell.refreshDataDirStatus}
      onPickDataDir={shell.pickDataDir}
      onImportLegacyData={shell.importLegacyData}
      shortcutHintsEnabled={shortcutHintsEnabled}
      onShortcutHintsEnabledChange={handleShortcutHintsEnabledChange}
      shortcutBindings={shortcutBindings}
      onShortcutBindingsChange={handleShortcutBindingsChange}
      onShortcutRecordingChange={handleShortcutRecordingChange}
      sidebarSortMode={sidebarSortMode}
      onSidebarSortModeChange={handleSidebarSortModeChange}
      trashEnabled={trashEnabled}
      trashAutoDeleteDays={trashAutoDeleteDays}
      onTrashEnabledChange={handleTrashEnabledChange}
      onTrashAutoDeleteDaysChange={handleTrashAutoDeleteDaysChange}
      onOpenTrash={handleOpenTrashPage}
      facePluginSettings={facePluginSettings}
      onFacePluginSettingChange={handleFacePluginSettingChange}
      colorPresetId={colorPresetId}
      onColorPresetChange={handleColorPresetChange}
      pageDisplayModes={pageDisplayModes}
      onPageDisplayModeChange={handlePageDisplayModeChange}
      faceKindOrder={faceKindOrder}
      onFaceKindOrderChange={handleFaceKindOrderChange}
      defaultFaceKinds={defaultFaceKinds}
      onDefaultFaceKindsChange={handleDefaultFaceKindsChange}
      repoCacheLimit={repoCacheLimit}
      onRepoCacheLimitChange={handleRepoCacheLimitChange}
      repos={shell.repos}
      activeRepoId={shell.activeRepoId}
      onRenameRepo={shell.onRenameRepo}
      onDeleteRepo={shell.onDeleteRepo}
      onOpenRepoTrash={handleOpenRepoTrashPage}
      access={shell.reposGateway.access}
      onCopyAccessKey={text => {
        void gateway.clipboard.writeText(text)
        void gateway.host.toast('已复制访问密钥')
      }}
    />
  )

  const toolbarNavigation = React.useMemo(() => ({
    backCount: navStackSizes.back,
    forwardCount: navStackSizes.forward,
    modalOpen: !!openModalPage,
    page,
    onBack: () => void goBackPage(),
    onForward: () => void goForwardPage(),
    onGoTo: (target: PageId) => navigatePage(target),
  }), [goBackPage, goForwardPage, navigatePage, navStackSizes.back, navStackSizes.forward, openModalPage, page])

  const toolbarQuickSearch = React.useMemo(() => ({
    gateway,
    scope: 'library' as const,
    open: quickSearchOpen,
    allNotesLayout,
    favoritesDoc,
    onToggle: () => setQuickSearchOpen(v => !v),
    onToggleAllNotesLayout: toggleAllNotesLayout,
    onClose: () => setQuickSearchOpen(false),
    onOpenNote: (note: NoteMeta, faceId?: string) => {
      setQuickSearchOpen(false)
      handleOpenNote(note, faceId)
    },
    onOpenAsset: (asset: AssetEntry) => {
      setQuickSearchOpen(false)
      handleOpenAssetTab(asset)
    },
  }), [allNotesLayout, favoritesDoc, gateway, handleOpenAssetTab, handleOpenNote, quickSearchOpen, toggleAllNotesLayout])

  const toolbarShortcutHints = React.useMemo(() => ({
    enabled: shortcutHintsEnabled,
    open: shortcutHintsOpen,
    bindings: shortcutBindings,
    onToggle: () => {
      setQuickSearchOpen(false)
      setShortcutHintsOpen(prev => !prev)
    },
    onClose: () => setShortcutHintsOpen(false),
  }), [shortcutBindings, shortcutHintsEnabled, shortcutHintsOpen])

  return (
    <Box
      aria-hidden={!visible}
      sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        minHeight: 0,
        display: 'flex',
        alignItems: 'stretch',
        // 现场边界：每个仓库现场的溢出只在本现场内消化，常驻的隐藏现场不得撑开全局布局。
        overflow: 'hidden',
        visibility: visible ? 'visible' : 'hidden',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      {!repoReady ? (
        <WorkspaceInitGate
          error={workspaceInitError}
          retrying={workspaceInitRetrying}
          onRetry={() => void runRepoInitialization()}
        />
      ) : (
        <WorkspaceVisibilityProvider visible={visible}>
          {visible ? (
            <RepoWorkspaceToolbar
              slots={shell.toolbarSlots}
              navigation={toolbarNavigation}
              quickSearch={toolbarQuickSearch}
              shortcutHints={toolbarShortcutHints}
            />
          ) : null}

          <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', alignItems: 'stretch', position: 'relative' }}>
            <SidebarRail
              side="left"
              layout={leftSidebarLayout}
              onResizeEnd={handleTabsSidebarResizeEnd}
              onMouseEnter={onSidebarMouseEnter}
              onMouseLeave={onSidebarMouseLeave}
              onMouseOver={leftPreviewHover.onMouseOver}
            >
              <OpenTabsPanel
                panelWidth={sidebarPanelWidth}
                tabsMode={tabsMode}
                sidebarSortMode={sidebarSortMode}
                tabsCollapsed={tabsCollapsed}
                sidebarItems={sidebarItems}
                openTabKeys={openTabKeys}
                activeTabKey={activeTabKey}
                tabSelectionVisible={
                  resolvedSelectionSource === 'tabs' &&
                  (visiblePage === 'note-detail' || visiblePage === 'asset-detail')
                }
                activeTabScrollSignal={activeTabScrollSignal}
                sidebarScrollTop={sidebarScrollTopsRef.current[activeWorkspaceId] ?? 0}
                sidebarScrollRestoreSignal={sidebarScrollRestoreSignal}
                onSidebarScrollTopChange={handleSidebarScrollTopChange}
                openNoteTabs={openNoteTabs}
                openAssetTabs={openAssetTabs}
                playingTabKeys={playingTabKeys}
                isNoteDirty={isNoteDirtyById}
                workspaces={workspaces.map(w => ({ id: w.id, title: w.title }))}
                activeWorkspaceId={activeWorkspaceId}
                tabGroups={tabGrouping.groups}
                tabGroupByTabKey={tabGrouping.byTabKey}
                onToggleTabsCollapsed={toggleTabsCollapsed}
                onToggleTabsMode={toggleTabsMode}
                onCreateDraftNote={handleCreateDraftNote}
                onCollapseAllGroups={handleCollapseAllGroups}
                onSwitchWorkspace={handleSwitchWorkspace}
                onCreateWorkspace={handleCreateWorkspace}
                onRenameWorkspace={handleRenameWorkspace}
                onDeleteWorkspace={handleDeleteWorkspace}
                onCreateGroup={handleCreateTabGroup}
                onOpenTab={tab => void handleOpenNote(tab)}
                onCloseTab={handleCloseTab}
                onOpenAssetTab={handleOpenAssetTab}
                onCloseAssetTab={handleCloseAssetTab}
                onAssignTabToGroup={handleAssignTabToGroup}
                onUnassignTabFromGroup={handleUnassignTabFromGroup}
                onToggleGroupCollapsed={handleToggleGroupCollapsed}
                onRenameGroup={handleRenameGroup}
                onSetGroupColor={handleSetGroupColor}
                onDeleteGroupOnly={handleDeleteGroupOnly}
                onDeleteGroupAndCloseTabs={handleDeleteGroupAndCloseTabs}
                onCommitSidebarItems={handleCommitSidebarItems}
                onMoveTabToUngroupedIndex={handleMoveTabToUngroupedIndex}
                onMoveTabToGroupIndex={handleMoveTabToGroupIndex}
                onMoveGroupToIndex={handleMoveGroupToIndex}
              />
            </SidebarRail>

            <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  overflow: page === 'note-detail' || page === 'asset-detail' ? 'hidden' : 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
              <Box
                sx={{
                  minHeight: page === 'note-detail' || page === 'asset-detail' ? 0 : '100%',
                  height: page === 'note-detail' || page === 'asset-detail' ? '100%' : 'auto',
                  p: page === 'note-detail' || page === 'asset-detail' ? 0 : 2,
                  boxSizing: 'border-box',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {page === 'home' ? (
                  <HomePage
                    stats={homeStats}
                    recentNotes={homeRecentNotes}
                    activeWorkspaceTitle={activeWorkspaceTitle}
                    onCreateNote={handleCreateDraftNote}
                    onOpenIndex={() => navigatePage('index')}
                    onOpenAttachments={() => navigatePage('attachments')}
                    onOpenAllNotes={() => navigatePage('all-notes')}
                    onOpenSearch={() => setQuickSearchOpen(true)}
                    onOpenNote={note => void handleOpenNote(note)}
                  />
                ) : null}
                {page === 'attachments' ? <AssetPoolPanel gateway={gateway} scope="library" activeRepoId={repoId} onOpenAsset={handleOpenAssetTab} /> : null}
                {page === 'all-notes' ? (
                  <AllNotesPage
                    notes={allNotes}
                    loading={noteIndexLoading}
                    errorText={noteIndexLoadError}
                    layout={allNotesLayout}
                    noteCardInfoById={noteCardInfoById}
                    onLayoutToggle={toggleAllNotesLayout}
                    onOpenNote={note => void handleOpenNote(note)}
                    onCopyRef={note => {
                      void gateway.clipboard.writeText(buildNotePlaceholderForCopy(note.id, note.title))
                      void gateway.host.toast('已复制引用占位符')
                    }}
                    onMore={openNoteCardMenu}
                  />
                ) : null}
                <Box sx={{ display: page === 'note-detail' ? 'flex' : 'none', flex: 1, minHeight: 0, width: '100%', flexDirection: 'column' }}>
                  {!openNoteTabs.length ? (
                    <Box sx={{ p: 2 }}>
                      <Typography color="text.secondary">没有打开的笔记。</Typography>
                    </Box>
                  ) : (
                    openNoteTabs.map(tab => (
                      <NoteDetailSession
                        key={tab.id}
                        ref={getNoteSessionRefCallback(tab.id)}
                        gateway={gateway}
                        scope="library"
                        note={tab}
                        visible={page === 'note-detail' && tab.id === activeNoteId}
                        bodyScrollRef={page === 'note-detail' && tab.id === activeNoteId ? mainScrollElRef : undefined}
                        noteIndexMap={noteIndexMap}
                        allNotesById={allNotesById}
                        refRelationsEpoch={refRelationsEpoch}
                        faceSwitchRequest={faceSwitchRequest}
                        faceSwitchLatestSeq={faceSwitchLatestSeq}
                        onFaceSwitchConsumed={handleFaceSwitchConsumed}
                        consumeInitSnapshot={consumeInitSnapshot}
                        onOpenNote={handleOpenNote}
                        onEnsureNoteCardInfoLoaded={ensureNoteCardInfoLoaded}
                        onDirtyChange={handleNoteDirtyChange}
                        onSaved={handleNoteSessionSaved}
                        trashEnabled={trashEnabled}
                        onRequestDeleteNote={handleDeleteNote}
                        favoritesDoc={favoritesDoc}
                        onFavoriteSaved={handleFavoritesDocChange}
                        onPlayingChange={playing => setTabPlaying(noteTabKey(tab.id), playing)}
                        facePluginGlobalSettings={facePluginSettings}
                        globalFaceKindOrder={faceKindOrder}
                      />
                    ))
                  )}
                </Box>
                <Box sx={{ display: page === 'asset-detail' ? 'flex' : 'none', flex: 1, minHeight: 0, width: '100%', flexDirection: 'column' }}>
                  {!openAssetTabs.length ? (
                    <Box sx={{ p: 2 }}>
                      <Typography color="text.secondary">没有打开的附件。</Typography>
                    </Box>
                  ) : (
                    openAssetTabs.map(asset => (
                      <AssetDetailSession
                        key={assetTabId(asset)}
                        gateway={gateway}
                        scope="library"
                        asset={asset}
                        visible={page === 'asset-detail' && assetTabId(asset) === activeTabKey}
                        onAssetUpdated={handleAssetTabUpdated}
                        onPlayingChange={playing => setTabPlaying(assetTabId(asset), playing)}
                      />
                    ))
                  )}
                </Box>
                {page === 'index' && favoritesDoc ? (
                  <IndexPage
                    gateway={gateway}
                    activeRepoId={repoId}
                    doc={favoritesDoc}
                    currentFolderId={currentFolderId}
                    noteIndex={resolvedNoteIndex}
                    assetIndex={assetPoolIndex?.assets}
                    onNavigateFolder={handleNavigateFolder}
                    onOpenNote={handleOpenNote}
                    onOpenAsset={handleOpenAssetTab}
                    onDocChange={handleFavoritesDocChange}
                    onCreateNoteInIndex={handleCreateNoteInIndex}
                    onUploadAssetsInIndex={handleUploadAssetsIntoIndex}
                    onDeleteFolderEntity={handleDeleteFolderEntity}
                    onDeleteNoteEntity={note => void handleDeleteNote({ note, mode: trashEnabled ? 'trash' : 'permanent' }).catch((e: any) => void gateway.host.toast(String(e?.message || e || '删除失败')))}
                    onDeleteAssetEntity={requestDeleteAssetEntity}
                    onUpdateNoteInfo={handleUpdateNoteInfo}
                    onUpdateAssetInfo={handleUpdateAssetInfo}
                  />
                ) : null}
                {page === 'trash' ? (
                  <TrashPanel
                    gateway={gateway}
                    scope="library"
                    onRestored={handleTrashRestored}
                    onAssetRestored={asset => void handleTrashAssetRestored(asset)}
                    onPermanentlyDeleted={item => {
                      if (item.kind === 'asset') {
                        const key = item.ext ? `${item.assetId}.${item.ext}` : item.assetId || item.id
                        setAssetPoolIndex(prev => {
                          if (!prev || typeof prev !== 'object') return prev
                          const assets = { ...((prev as any).assets || {}) }
                          delete assets[key]
                          return { ...(prev as any), assets }
                        })
                        closeTabKeysDirectRef.current([`asset:${key}`])
                        return
                      }
                      if (item.kind === 'face') return
                      const nid = String(item.id || '').trim()
                      if (!nid) return
                      closeTabKeysDirectRef.current([noteTabKey(nid)])
                      setNoteIndex(prev => {
                        const current = prev || { version: 1, notes: {} }
                        const nextNotes = { ...(current.notes || {}) }
                        delete nextNotes[nid]
                        return { ...current, notes: nextNotes }
                      })
                      bumpRefRelationsEpoch()
                    }}
                  />
                ) : null}
                {page === 'repo-trash' ? (
                  <RepoTrashPanel gateway={shell.reposGateway} onRestored={repo => void handleRepoRestored(repo)} />
                ) : null}
                {page === 'settings' ? renderSettingsPage() : null}
              </Box>
              </Box>

              {previewTarget ? (
                <SidebarHoldPreviewOverlay
                  key={encodeSidebarPreviewTarget(previewTarget)}
                  gateway={gateway}
                  scope="library"
                  target={previewTarget}
                  noteIndex={resolvedNoteIndex}
                  assetLookup={favoritesFolderView.lookup}
                  favoritesDoc={favoritesDoc}
                  noteIndexMap={noteIndexMap}
                  allNotesById={allNotesById}
                  facePluginGlobalSettings={facePluginSettings}
                  globalFaceKindOrder={faceKindOrder}
                  scrollRef={previewOverlayScrollRef}
                />
              ) : null}
            </Box>

            <SidebarRail
              side="right"
              layout={rightSidebarLayout}
              onResizeEnd={handleFavoritesSidebarResizeEnd}
              onMouseEnter={onFavoritesSidebarMouseEnter}
              onMouseLeave={onFavoritesSidebarMouseLeave}
              onMouseOver={rightPreviewHover.onMouseOver}
            >
              <FavoritesSidebarPanel
                panelWidth={rightSidebarLayout.panelWidth}
                mode={favoritesSidebarMode}
                collapsed={favoritesSidebarCollapsed}
                doc={favoritesDoc}
                nav={favoritesNav}
                folderView={favoritesFolderView}
                noteIndex={resolvedNoteIndex}
                activeTabKey={activeTabKey}
                tabSelectionVisible={
                  resolvedSelectionSource === 'favorites' &&
                  (visiblePage === 'note-detail' || visiblePage === 'asset-detail')
                }
                activeEntryScrollSignal={favoritesActiveScrollSignal}
                scrollTop={favoritesScrollTopsRef.current[favoritesNav.currentFolderId] ?? 0}
                scrollRestoreSignal={favoritesScrollRestoreSignal}
                onScrollTopChange={handleFavoritesScrollTopChange}
                onNavigate={handleFavoritesSidebarNavigate}
                onBack={handleFavoritesSidebarBack}
                onForward={handleFavoritesSidebarForward}
                onToggleCollapsed={toggleFavoritesSidebarCollapsed}
                onToggleMode={toggleFavoritesSidebarMode}
                onOpenNote={(note, openInTabs) => void handleOpenNote(note, undefined, openInTabs ? 'tabs' : 'favorites')}
                onOpenAsset={(asset, openInTabs) => handleOpenAssetTab(asset, openInTabs ? 'tabs' : 'favorites')}
                onCreateNote={() => handleCreateDraftNoteInFolder(favoritesNav.currentFolderId)}
                onCloseDraftNote={handleCloseTab}
                onEntryContextMenu={handleFavoritesSidebarContextMenu}
                onReorderRefs={handleFavoritesSidebarReorder}
              />
            </SidebarRail>
          </Box>

          {visible && openModalPage ? (
            <PageOverlayHost open onClose={closeModalOverlay}>
              {renderModalBodyNode()}
            </PageOverlayHost>
          ) : null}

          {favoritesEntity.node}

          <Menu
            open={visible && !!noteCardMenu}
            onClose={closeNoteCardMenu}
            anchorEl={noteCardMenu?.anchorEl}
            PaperProps={{ sx: menuPaperSx }}
          >
            <MenuItem onClick={() => void requestCopyTitleFromCardMenu()}>
              复制标题
            </MenuItem>
            <MenuItem
              onClick={() => void requestOpenDirFromCardMenu()}
              disabled={!noteCardMenu?.note || isDraftNoteId(noteCardMenu.note.id) || !String(noteCardMenu.note.dir || '').trim()}
            >
              打开所在目录
            </MenuItem>
            <MenuItem
              onClick={() => {
                const target = noteCardMenu?.note
                if (!target) return
                setNoteCardDeleteTarget(target)
                closeNoteCardMenu()
              }}
              sx={menuDangerItemSx}
            >
              删除此笔记…
            </MenuItem>
          </Menu>

          <Dialog open={visible && !!noteCardDeleteTarget} onClose={() => setNoteCardDeleteTarget(null)} maxWidth="xs" fullWidth>
            <DialogTitle>
              {noteCardDeleteTarget && isDraftNoteId(noteCardDeleteTarget.id)
                ? '删除草稿'
                : trashEnabled
                  ? '移入回收站'
                  : '永久删除'}
            </DialogTitle>
            <DialogContent>
              <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.72)' }}>
                {noteCardDeleteTarget && isDraftNoteId(noteCardDeleteTarget.id)
                  ? `确定删除草稿「${noteCardDeleteTarget.title || '未命名'}」吗？这会丢弃当前内容。`
                  : trashEnabled
                    ? `确定将笔记「${noteCardDeleteTarget?.title || '未命名'}」移入回收站吗？`
                    : `回收站当前未启用。确定永久删除笔记「${noteCardDeleteTarget?.title || '未命名'}」吗？此操作不可撤销。`}
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setNoteCardDeleteTarget(null)}>取消</Button>
              <Button variant="contained" color="error" onClick={() => void confirmDeleteNoteFromCard()}>
                {noteCardDeleteTarget && isDraftNoteId(noteCardDeleteTarget.id)
                  ? '删除'
                  : trashEnabled
                    ? '移入回收站'
                    : '永久删除'}
              </Button>
            </DialogActions>
          </Dialog>

          {assetEntityDeleteDialog}

          <Dialog open={visible && !!closeTabPrompt} onClose={handleCloseTabPromptCancel} maxWidth="xs" fullWidth>
            <DialogTitle>未保存改动</DialogTitle>
            <DialogContent>
              <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.72)' }}>
                笔记「{closeTabPromptTitle}」还有未保存的改动。关闭标签页会丢失这些改动，请先保存或放弃改动。
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={handleCloseTabPromptCancel}>取消</Button>
              <Button variant="text" onClick={handleCloseTabPromptGoSave} sx={softButtonSx}>去保存</Button>
              <Button variant="contained" color="error" onClick={handleCloseTabPromptDiscardAndClose} disabled={closeTabPromptTargetSaving}>放弃改动并关闭</Button>
            </DialogActions>
          </Dialog>
        </WorkspaceVisibilityProvider>
      )}
    </Box>
  )
}

