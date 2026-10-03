import * as React from 'react'
import { Box, Typography } from '@mui/material'
import {
  type HyperCortexWorkspaceV1,
  type NoteMeta,
} from '../core'
import type { HyperCortexRepo } from '../gateway'
import { buildNotePlaceholderForCopy } from '../notePlaceholder'
import { sortNotesByUpdatedAtDesc } from '../noteCatalog'
import { isDraftNoteId } from '../drafts'
import { useDraftOrchestration } from './useDraftOrchestration'
import { AssetPoolPanel } from './AssetPoolPanel'
import { HomePage, type HomePageStats } from './HomePage'
import { IndexPage } from './IndexPage'
import { OpenTabsPanel } from './OpenTabsPanel'
import { FavoritesSidebarPanel } from './FavoritesSidebarPanel'
import { SidebarRail } from './SidebarRail'
import { NoteDetailSession } from './NoteDetailSession'
import { AssetDetailSession } from './AssetDetailSession'
import { SettingsPage } from './SettingsPage'
import { AllNotesPage } from './AllNotesPage'
import { PageOverlayHost } from './PageOverlayHost'
import { TrashPanel } from './TrashPanel'
import { RepoTrashPanel } from './repo-management/RepoTrashPanel'
import { useNoteScrollMemory } from './noteScrollMemory'
import { type SidebarItem } from './sidebarModel'
import { useTabWorkspaceSidebarActions, useTabWorkspaceSidebarState } from './useTabWorkspaceSidebar'
import type { AssetEntry } from '../assetTypes'
import { assetTabId } from '../assetTypes'
import { noteTabKey } from '../tabKey'
import { createRepoScopedGateway, type HyperCortexGateway } from '../gateway'
import { useNoteIndex } from './useNoteIndex'
import { useNoteSessions } from './useNoteSessions'
import { useAppCommandDispatch } from './useAppCommandDispatch'
import { usePageNavigation } from './usePageNavigation'
import { useAssetPoolSessions } from './useAssetPoolSessions'
import { useGlobalShortcuts } from './useGlobalShortcuts'
import { useHyperCortexShell } from './shellContext'
import { RepoWorkspaceToolbar } from './RepoWorkspaceToolbar'
import type { PageId } from './workspacePages'
import { WorkspaceVisibilityProvider } from './workspaceVisibility'
import { SidebarHoldPreviewOverlay } from './sidebar-preview/SidebarHoldPreviewOverlay'
import { useSidebarHoldPreview } from './sidebar-preview/useSidebarHoldPreview'
import { encodeSidebarPreviewTarget } from './sidebar-preview/previewTarget'
import { useAppSettings, useAppSettingsWritebacks } from './useAppSettings'
import { useFavoritesWorkspaceActions, useFavoritesWorkspaceState } from './useFavoritesWorkspace'
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

  // 打开的会话标识：真实笔记记真实标识，草稿记草稿标识；草稿元数据与转正后标识一律向档案查询。
  const [openNoteIds, setOpenNoteIds] = React.useState<string[]>([])
  const openNoteIdsRef = React.useRef<string[]>([])
  React.useEffect(() => {
    openNoteIdsRef.current = openNoteIds
  }, [openNoteIds])
  // ---- 工作区与侧边栏动作段：装载与持久化能力齐备后接线；工作区切换与新建改名删除、
  // 分组新建折叠改名改色删除、侧边栏条目提交与拖拽移动、工作区现场应用。
  const {
    commitActiveWorkspacePatch,
    updateSidebarItems,
    handleMoveTabToUngroupedIndex,
    handleMoveTabToGroupIndex,
    handleMoveGroupToIndex,
    handleCommitSidebarItems,
    handleSwitchWorkspace,
    handleCreateWorkspace,
    handleRenameWorkspace,
    handleDeleteWorkspace,
    handleCreateTabGroup,
    handleCollapseAllGroups,
    handleAssignTabToGroup,
    handleUnassignTabFromGroup,
    handleToggleGroupCollapsed,
    handleRenameGroup,
    handleSetGroupColor,
    handleDeleteGroupOnly,
  } = useTabWorkspaceSidebarActions({
    gateway,
    workspaces,
    setWorkspaces,
    setActiveWorkspaceId,
    setOpenTabKeys,
    setSidebarItems,
    setTabGrouping,
    setActiveTabKey,
    sidebarItemsRef,
    tabGroupingRef,
    activeWorkspaceIdRef,
    repoReadyRef,
    persistRepoStatePatch,
    flushSidebarScrollTop,
    clearSidebarScrollMemory,
    navigatePage,
    pageRef,
    setDetailSelectionSource,
    setActiveNoteId,
    setOpenNoteIds,
    setOpenAssetTabs,
    commitActiveWorkspacePatchRef,
    updateSidebarItemsRef,
    applyWorkspaceSidebarStateRef,
  })

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

  // ---- 笔记会话现场：会话句柄、打开/关闭与未保存确认、保存/删除/恢复、卡片信息与卡片菜单，收敛到独立模块。
  const {
    noteSessionHandlesRef,
    requestCloseTabRef,
    getNoteSessionRefCallback,
    handleNoteDirtyChange,
    isNoteDirtyById,
    refRelationsEpoch,
    bumpRefRelationsEpoch,
    allNotesById,
    faceSwitchRequest,
    faceSwitchLatestSeq,
    handleFaceSwitchConsumed,
    noteCardInfoById,
    refreshNoteCardInfo,
    ensureNoteCardInfoLoaded,
    noteIndexMap,
    handleOpenNote,
    handleCreateNoteInIndex,
    handleDeleteNote,
    handleTrashRestored,
    closeTabKeysDirect,
    handleCloseAssetTab,
    handleCloseTab,
    handleNoteSessionSaved,
    openNoteCardMenu,
    noteCardMenuNode,
    noteCardDeleteDialog,
    closeTabPromptDialog,
  } = useNoteSessions({
    visible,
    visiblePage,
    gateway,
    activeNoteId,
    faceKindOrder,
    defaultFaceKinds,
    trashEnabled,
    allNotes,
    openNoteTabs,
    favoritesDoc,
    handleFavoritesDocChange,
    draftIdentity,
    openTabKeysRef,
    activeTabKeyRef,
    pageRef,
    openNoteIdsRef,
    noteScrollTopByIdRef,
    repoReadyRef,
    closeTabKeysDirectRef,
    activateExistingTabKeyRef,
    setDetailSelectionSource,
    setOpenModalPage,
    setOpenNoteIds,
    setActiveNoteId,
    setActiveTabKey,
    setOpenAssetTabs,
    setNoteIndex,
    updateSidebarItems,
    commitActiveWorkspacePatch,
    recordNewNavLocation,
    navigatePage,
    persistRepoStatePatch,
  })

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

  const handleRepoRestored = React.useCallback(
    async (repo: HyperCortexRepo) => {
      await refreshRepos()
      void gateway.host.toast(`已恢复仓库：${repo.title}`)
    },
    [gateway, refreshRepos],
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

  // ---- 收藏夹动作现场：浏览位置前进后退与文档调和、当前层导航、实体操作与条目激活，收敛到独立模块。
  const {
    handleNavigateFolder,
    handleDeleteFolderEntity,
    handleUploadAssetsIntoIndex,
    handleFavoritesSidebarNavigate,
    handleFavoritesSidebarBack,
    handleFavoritesSidebarForward,
    handleFavoritesSidebarContextMenu,
    handleFavoritesSidebarReorder,
    favoritesEntityNode,
  } = useFavoritesWorkspaceActions({
    gateway,
    trashEnabled,
    favoritesDoc,
    handleFavoritesDocChange,
    currentFolderId,
    setCurrentFolderId,
    setFavoritesNav,
    favoritesNavRef,
    persistRepoStatePatch,
    repoReadyRef,
    clearFavoritesScrollMemory,
    setAssetPoolIndex,
    favoritesFolderView,
    favoritesFolderViewRef,
    resolvedNoteIndex,
    noteIndexRef,
    activateFavoritesEntryKeyRef,
    handleOpenNote,
    handleOpenAssetTab,
    handleUpdateNoteInfo,
    handleUpdateAssetInfo,
    handleDeleteNote,
    requestDeleteAssetEntity,
  })

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

          {favoritesEntityNode}

          {noteCardMenuNode}

          {noteCardDeleteDialog}

          {assetEntityDeleteDialog}

          {closeTabPromptDialog}
        </WorkspaceVisibilityProvider>
      )}
    </Box>
  )
}

