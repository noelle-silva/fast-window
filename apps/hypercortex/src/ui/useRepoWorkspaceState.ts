import * as React from 'react'
import {
  type HyperCortexWorkspaceV1,
} from '../core'
import { sortNotesByUpdatedAtDesc } from '../noteCatalog'
import { carryDraftNoteRefs } from '../favorites'
import { useNoteScrollMemory } from './noteScrollMemory'
import { type SidebarItem } from './sidebarModel'
import { useTabWorkspaceSidebarState } from './useTabWorkspaceSidebar'
import { createRepoScopedGateway, type HyperCortexGateway } from '../gateway'
import { useNoteIndex } from './useNoteIndex'
import { usePageNavigation } from './usePageNavigation'
import { useAssetPoolSessions } from './useAssetPoolSessions'
import { useHyperCortexShell } from './shellContext'
import { useAppSettings } from './useAppSettings'
import { useFavoritesWorkspaceState } from './useFavoritesWorkspace'
import { useRepoStateBootstrap } from './useRepoStateBootstrap'
import { useSidebarHoldPreview } from './sidebar-preview/useSidebarHoldPreview'
import { useExternalChangeSync } from './useExternalChangeSync'
import type { HomePageStats } from './HomePage'

// 状态组合段：应用设置派生、顶部栏与详情选中状态、按住预览、标签页与侧边栏状态、
// 页面导航与滚动记忆、附件会话状态、收藏夹现场状态、仓库状态装载、笔记索引与打开会话标识。
// 动作组合见 useRepoWorkspaceActions，主文件保留组合装配；模块间只经显式入参/回调连接。
// 返回对象含 settings 与 setActiveNoteId 两项仅供动作组合段内部消费，主文件装配时按对外契约过滤。

export function useRepoWorkspaceState(props: { repoId: string; visible: boolean }) {
  const { repoId, visible } = props
  const shell = useHyperCortexShell()
  const gateway = React.useMemo<HyperCortexGateway>(() => createRepoScopedGateway(repoId), [repoId])

  const appSettings = shell.appSettings

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

  // ---- 详情页（tab 常驻 Session）
  const [activeNoteId, setActiveNoteId] = React.useState<string>('')
  const activeNoteIdRef = React.useRef<string>('')
  React.useEffect(() => {
    activeNoteIdRef.current = activeNoteId
  }, [activeNoteId])

  // 详情选中来源：全局同一时刻只有一个选中态，决定高亮落在左侧标签栏还是右侧收藏夹栏。
  const [detailSelectionSource, setDetailSelectionSource] = React.useState<'tabs' | 'favorites'>('tabs')
  const [activeTabScrollSignal, setActiveTabScrollSignal] = React.useState(0)
  // 右侧收藏夹栏的激活条目滚动信号：键盘切换后把当前条目滚入视野。
  const [favoritesActiveScrollSignal, setFavoritesActiveScrollSignal] = React.useState(0)
  // 右侧收藏夹栏的激活条目闪烁信号：从笔记详情「收藏于」跳转后闪烁数次，指明目标条目。
  const [favoritesActiveFlashSignal, setFavoritesActiveFlashSignal] = React.useState(0)

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

  // ---- 标签页集合、工作区与侧边栏分组：状态段供导航、附件会话、收藏夹与装载流程消费；
  // 工作区与分组的行为段在装载与持久化能力齐备后接线。
  const {
    openTabKeys,
    setOpenTabKeys,
    openTabKeysRef,
    activeTabKey,
    setActiveTabKey,
    activeTabKeyRef,
    workspaces,
    setWorkspaces,
    activeWorkspaceId,
    setActiveWorkspaceId,
    sidebarItems,
    setSidebarItems,
    sidebarItemsRef,
    tabGrouping,
    setTabGrouping,
    tabGroupingRef,
    setTabsHoverOpen,
    sidebarHoverRef,
    sidebarShortcutHoldRef,
    leftSidebarLayout,
    sidebarPanelWidth,
    onSidebarMouseEnter,
    onSidebarMouseLeave,
  } = useTabWorkspaceSidebarState({
    tabsMode,
    tabsCollapsed,
    tabsSidebarWidth,
    handleSidebarPreviewHover,
  })

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

  // 关闭标签与激活已开标签的实现入口：实现（笔记会话模块）晚于附件会话与装载消费方，经 ref 连接。
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
    handleUpdateAssetIcon,
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

  // ---- 收藏夹现场：文档、当前层与右侧栏浏览位置、当前页视图与悬停布局，状态收敛到独立模块。
  const {
    favoritesLedger,
    favoritesDoc,
    setFavoritesDoc,
    favoritesDocRef,
    handleFavoritesDocChange,
    handleFavoritesDocAdopt,
    currentFolderId,
    setCurrentFolderId,
    favoritesNav,
    setFavoritesNav,
    favoritesFolderView,
    favoritesFolderViewRef,
    resolvedSelectionSource,
    resolvedSelectionSourceRef,
    setFavoritesHoverOpen,
    favoritesHoverRef,
    favoritesSidebarShortcutHoldRef,
    rightSidebarLayout,
    onFavoritesSidebarMouseEnter,
    onFavoritesSidebarMouseLeave,
  } = useFavoritesWorkspaceState({
    gateway,
    assetIndex: assetPoolIndex?.assets,
    activeTabKey,
    detailSelectionSource,
    favoritesSidebarMode,
    favoritesSidebarCollapsed,
    favoritesSidebarWidth,
    handleSidebarPreviewHover,
  })

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

  // ---- 外部改动同步：展示数据一通知就就地重载（索引 / 收藏夹 / 附件索引 / 回收站），
  // 只重载数据块，不动界面位置；编辑中的笔记由笔记会话按干净/脏分别处理。
  const [externalNotesSignal, setExternalNotesSignal] = React.useState(0)
  const [externalTrashSignal, setExternalTrashSignal] = React.useState(0)
  const handleExternalChange = React.useCallback(
    (kinds: string[]) => {
      const changed = new Set(kinds)
      if (changed.has('notes')) {
        void gateway.notes
          .loadNoteIndex('library')
          .then(next => {
            if (next) setNoteIndex(next)
          })
          .catch(() => {})
        setExternalNotesSignal(signal => signal + 1)
      }
      if (changed.has('favorites')) {
        void favoritesLedger
          .load()
          .then(doc => {
            // 草稿引用只活在内存：重载磁盘文档时带回，避免外部改动把本地草稿条目弄丢。
            const current = favoritesDocRef.current
            setFavoritesDoc(current ? carryDraftNoteRefs(current, doc) : doc)
          })
          .catch(() => {})
      }
      if (changed.has('assets')) {
        void gateway.assets
          .ensureAssetsIndex('library')
          .then(next => setAssetPoolIndex(next as any))
          .catch(() => {})
      }
      if (changed.has('trash')) {
        setExternalTrashSignal(signal => signal + 1)
      }
    },
    [favoritesLedger, gateway, setAssetPoolIndex, setFavoritesDoc, setNoteIndex],
  )
  useExternalChangeSync({ gateway, repoId, enabled: repoReady, onChange: handleExternalChange })

  // 打开的会话标识：真实笔记记真实标识，草稿记草稿标识；草稿元数据与转正后标识一律向档案查询。
  const [openNoteIds, setOpenNoteIds] = React.useState<string[]>([])
  const openNoteIdsRef = React.useRef<string[]>([])
  React.useEffect(() => {
    openNoteIdsRef.current = openNoteIds
  }, [openNoteIds])

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

  return {
    repoId,
    visible,
    shell,
    gateway,

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

    quickSearchOpen,
    setQuickSearchOpen,
    shortcutHintsOpen,
    setShortcutHintsOpen,

    activeNoteId,
    activeNoteIdRef,
    setActiveNoteId,
    detailSelectionSource,
    setDetailSelectionSource,
    activeTabScrollSignal,
    setActiveTabScrollSignal,
    favoritesActiveScrollSignal,
    setFavoritesActiveScrollSignal,
    favoritesActiveFlashSignal,
    setFavoritesActiveFlashSignal,

    previewTarget,
    previewHoldRef,
    previewOverlayScrollRef,
    cancelPreviewClear,
    applyPreviewTarget,
    handleSidebarPreviewHover,
    leftPreviewHover,
    rightPreviewHover,
    stopPreview,

    openTabKeys,
    setOpenTabKeys,
    openTabKeysRef,
    activeTabKey,
    setActiveTabKey,
    activeTabKeyRef,
    workspaces,
    setWorkspaces,
    activeWorkspaceId,
    setActiveWorkspaceId,
    sidebarItems,
    setSidebarItems,
    sidebarItemsRef,
    tabGrouping,
    setTabGrouping,
    tabGroupingRef,
    setTabsHoverOpen,
    sidebarHoverRef,
    sidebarShortcutHoldRef,
    leftSidebarLayout,
    sidebarPanelWidth,
    onSidebarMouseEnter,
    onSidebarMouseLeave,

    commitActiveWorkspacePatchRef,

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

    mainScrollElRef,
    noteScrollTopByIdRef,

    closeTabKeysDirectRef,
    activateExistingTabKeyRef,
    applyWorkspaceSidebarStateRef,
    activateFavoritesEntryKeyRef,
    updateSidebarItemsRef,

    assetPoolIndex,
    setAssetPoolIndex,
    openAssetTabs,
    setOpenAssetTabs,
    playingTabKeys,
    setTabPlaying,
    handleUpdateAssetInfo,
    handleUpdateAssetIcon,
    handleOpenAssetTab,
    handleAssetTabUpdated,
    requestDeleteAssetEntity,
    handleTrashAssetRestored,
    assetEntityDeleteDialog,

    favoritesLedger,
    favoritesDoc,
    setFavoritesDoc,
    favoritesDocRef,
    handleFavoritesDocChange,
    handleFavoritesDocAdopt,
    currentFolderId,
    setCurrentFolderId,
    favoritesNav,
    setFavoritesNav,
    favoritesFolderView,
    favoritesFolderViewRef,
    resolvedSelectionSource,
    resolvedSelectionSourceRef,
    setFavoritesHoverOpen,
    favoritesHoverRef,
    favoritesSidebarShortcutHoldRef,
    rightSidebarLayout,
    onFavoritesSidebarMouseEnter,
    onFavoritesSidebarMouseLeave,

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

    noteIndex,
    setNoteIndex,
    noteIndexLoading,
    noteIndexLoadError,
    allNotes,

    externalNotesSignal,
    externalTrashSignal,

    openNoteIds,
    setOpenNoteIds,
    openNoteIdsRef,

    homeRecentNotes,
    homeStats,
    activeWorkspaceTitle,

    settings,
  }
}

export type RepoWorkspaceState = ReturnType<typeof useRepoWorkspaceState>
