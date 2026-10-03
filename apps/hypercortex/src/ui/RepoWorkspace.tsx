import * as React from 'react'
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Menu, MenuItem, Typography } from '@mui/material'
import {
  kindFromMime,
  mimeFromExt,
  type HyperCortexFavoritesNavV1,
  type HyperCortexRepoStateV1,
  type HyperCortexTabGroupV1,
  type HyperCortexWorkspaceV1,
  type NoteMeta,
} from '../core'
import type { HyperCortexRepo } from '../gateway'
import { buildNotePlaceholderForCopy } from '../notePlaceholder'
import { sortNotesByUpdatedAtDesc } from '../noteCatalog'
import { isDraftNoteId } from '../drafts'
import { addRef, normalizeFavoritesDoc, removeNoteRefsByTargetId, reorderRefsInFolder, retargetNoteRefs, stripDraftNoteRefs, type FavoriteItemRef, type HyperCortexFavoritesDocV1 } from '../favorites'
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
  normalizeFavoritesNav,
  reconcileFavoritesNav,
} from './favoritesNavigator'
import { NoteDetailSession, type NoteDetailSessionHandle, type NoteDetailSnapshotV1 } from './NoteDetailSession'
import { AssetDetailSession } from './AssetDetailSession'
import { SettingsPage } from './SettingsPage'
import { AllNotesPage } from './AllNotesPage'
import { PageOverlayHost } from './PageOverlayHost'
import { isModalCapablePageId, normalizePageDisplayModes, visiblePageId, type ModalCapablePageId, type PageDisplayMode } from '../pageDisplay'
import { TrashPanel } from './TrashPanel'
import { RepoTrashPanel } from './repo-management/RepoTrashPanel'
import { menuDangerItemSx, menuPaperSx, softButtonSx } from './pluginUiStyles'
import { startPickedLocalAssetUploadTask } from '../services/localAssetUpload'
import { createTabGroupId, pickNextTabGroupColor, pickNextTabGroupTitle } from './tabGroups'
import { createWorkspaceId, normalizeActiveWorkspaceId, normalizeWorkspaces, pickNextWorkspaceTitle, updateWorkspaceById } from './workspaces'
import { applyActiveWorkspacePatch, buildRepoStateSnapshot, normalizeOpenTabKeys, normalizeScrollTops } from './workspaceModel'
import { useKeyedScrollMemory } from './scrollMemory'
import {
  applySidebarItemsToWorkspace,
  closeTabsInSidebar,
  createGroupInSidebar,
  deleteGroupFromSidebar,
  deriveSidebarFields,
  ensureSidebarItems,
  insertTabAsUngrouped,
  moveGroupToIndex,
  moveTabBetweenGroups,
  moveTabToGroupIndex,
  renameTabKeyInSidebar,
  type SidebarItem,
  updateSidebarGroup,
} from './sidebarModel'
import {
  DEFAULT_SHORTCUT_BINDINGS,
  isEditableTarget,
  mainKeyFromChord,
  normalizeMainKey,
  normalizeShortcutBindings,
  shouldTriggerShortcut,
  type HyperCortexShortcutBindingsV1,
  type HyperCortexShortcutId,
} from '../shortcuts'
import type { NoteCardInfo } from './noteCardInfo'
import { loadNoteCardInfo, startPrefetchNoteCardInfo } from './noteCardInfoLoader'
import type { AssetEntry } from '../assetTypes'
import { assetRefKey, assetTabId } from '../assetTypes'
import { assetRefKeyFromTabKey, noteIdFromTabKey, noteTabKey, parseAssetRefKey, tabKind, type TabKey } from '../tabKey'
import { createRepoScopedGateway, type HyperCortexGateway } from '../gateway'
import { normalizeFaceSettingValue } from '../facePlugins/settings'
import {
  normalizeDefaultFaceKinds,
  normalizeFaceKindOrder,
  orderKindsByGlobalOrder,
  resolveNoteFaceOrder,
} from '../facePreferences'
import {
  faceManifestFromDeclaration,
  getCreatableFaceDeclarations,
  getFaceDeclaration,
  getFaceKindOrder,
  requireFaceDeclaration,
} from '../facePlugins'
import { useNoteIndex } from './useNoteIndex'
import { useHyperCortexShell } from './shellContext'
import { RepoWorkspaceToolbar } from './RepoWorkspaceToolbar'
import type { PageId } from './workspacePages'
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
import { WorkspaceVisibilityProvider } from './workspaceVisibility'
import { SidebarHoldPreviewOverlay } from './sidebar-preview/SidebarHoldPreviewOverlay'
import { useSidebarPreviewHover, readHoveredSidebarPreviewTarget } from './sidebar-preview/useSidebarPreviewHover'
import { encodeSidebarPreviewTarget, type SidebarPreviewTarget } from './sidebar-preview/previewTarget'

type RepoStatePatch = Partial<HyperCortexRepoStateV1>

const SIDEBAR_SCROLL_SAVE_DEBOUNCE_MS = 400

function assetKeyFromResource(resource: { assetId?: string; ext?: string }): string {
  const assetId = String(resource?.assetId || '').trim()
  const ext = String(resource?.ext || '').trim().toLowerCase().replace(/^\./, '')
  return assetId ? (ext ? `${assetId}.${ext}` : assetId) : ''
}

const ASSET_UPLOAD_WAIT_INTERVAL_MS = 500

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

function stripDraftTabKeys(value: unknown): string[] {
  const list = Array.isArray(value) ? value : []
  const out: string[] = []
  for (const item of list) {
    const key = typeof item === 'string' ? item.trim() : ''
    if (!key) continue
    if (tabKind(key) === 'note' && isDraftNoteId(noteIdFromTabKey(key))) continue
    if (out.includes(key)) continue
    out.push(key)
  }
  return out
}

function stripDraftTabKeyMap(value: any): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value)) {
    const tabKey = String(k || '').trim()
    if (!tabKey) continue
    if (tabKind(tabKey) === 'note' && isDraftNoteId(noteIdFromTabKey(tabKey))) continue
    const groupId = String(v || '').trim()
    if (!groupId) continue
    out[tabKey] = groupId
  }
  return out
}

function sanitizeRepoStateForSave(state: HyperCortexRepoStateV1): HyperCortexRepoStateV1 {
  const next: HyperCortexRepoStateV1 = { ...state, version: 1 }

  delete (next as any).openNoteIds
  delete (next as any).activeNoteId
  delete (next as any).tabGroupByNoteId

  if (typeof next.activeTabKey === 'string') {
    const k = String(next.activeTabKey || '').trim()
    if (k && tabKind(k) === 'note' && isDraftNoteId(noteIdFromTabKey(k))) next.activeTabKey = ''
  }
  if (Array.isArray(next.sidebarItems)) {
    next.sidebarItems = ensureSidebarItems({
      sidebarItems: next.sidebarItems,
      openTabKeys: stripDraftTabKeys(next.openTabKeys) as any,
      tabGroups: Array.isArray(next.tabGroups) ? next.tabGroups : [],
      tabGroupByTabKey: stripDraftTabKeyMap(next.tabGroupByTabKey),
    })
  }
  if ('openTabKeys' in next) next.openTabKeys = stripDraftTabKeys(next.openTabKeys)
  if ('tabGroupByTabKey' in next) next.tabGroupByTabKey = stripDraftTabKeyMap(next.tabGroupByTabKey)
  next.currentFolderId = String(next.currentFolderId || '').trim() || 'root'
  next.favoritesNav = normalizeFavoritesNav(next.favoritesNav)

  const sidebarScrollTops = normalizeScrollTops(next.sidebarScrollTops)
  if (Object.keys(sidebarScrollTops).length) next.sidebarScrollTops = sidebarScrollTops
  else delete next.sidebarScrollTops

  const favoritesScrollTops = normalizeScrollTops(next.favoritesScrollTops)
  if (Object.keys(favoritesScrollTops).length) next.favoritesScrollTops = favoritesScrollTops
  else delete next.favoritesScrollTops

  if (Array.isArray(next.workspaces)) {
    next.workspaces = next.workspaces.map(ws => {
      const openTabKeys = stripDraftTabKeys((ws as any).openTabKeys)
      const tabGroupByTabKey = stripDraftTabKeyMap((ws as any).tabGroupByTabKey)
      const sidebarItems = ensureSidebarItems({
        sidebarItems: (ws as any).sidebarItems,
        openTabKeys: openTabKeys as any,
        tabGroups: Array.isArray((ws as any).tabGroups) ? ((ws as any).tabGroups as any) : [],
        tabGroupByTabKey,
      })
      const derived = deriveSidebarFields(sidebarItems)
      let activeTabKey = String((ws as any).activeTabKey || '').trim()
      if (activeTabKey && tabKind(activeTabKey) === 'note' && isDraftNoteId(noteIdFromTabKey(activeTabKey))) activeTabKey = ''
      const id = String((ws as any).id || '').trim() || createWorkspaceId()
      const title = String((ws as any).title || '').trim() || '工作区'
      return {
        id,
        title,
        sidebarItems,
        tabGroups: derived.tabGroups,
        openTabKeys: derived.openTabKeys,
        tabGroupByTabKey: derived.tabGroupByTabKey,
        activeTabKey,
      }
    })
  }

  return next
}

function isKeyUpForChordMainKey(e: KeyboardEvent, chord: string): boolean {
  const main = mainKeyFromChord(chord)
  if (!main) return false
  return normalizeMainKey(e.key) === main
}

// 页面切换类快捷键的目标页映射：触发即走统一分流（独立页=切页，模态窗=弹层/替换/关层）。
const PAGE_SHORTCUT_TARGETS: { id: HyperCortexShortcutId; target: PageId }[] = [
  { id: 'goHomePage', target: 'home' },
  { id: 'goFavoritesPage', target: 'index' },
  { id: 'goAttachmentsPage', target: 'attachments' },
  { id: 'goAllNotesPage', target: 'all-notes' },
  { id: 'goSettingsPage', target: 'settings' },
]

/**
 * 会话初始快照的唯一构造入口（普通新建与索引页创建共用）：
 * 面清单/面顺序/激活面/笔记级字段一次性装配，保证两条创建流程表现一致。
 */
function buildNoteInitSnapshot(input: {
  faceManifests: NoteDetailSnapshotV1['faceManifests']
  faceOrder?: readonly string[]
  globalKindOrder: readonly string[]
  title: string
  description?: string
  tags?: string[]
  resources?: NoteDetailSnapshotV1['baseFields']['resources']
  noteTimes: NoteDetailSnapshotV1['noteTimes']
}): NoteDetailSnapshotV1 {
  const faces = resolveNoteFaceOrder({
    faceOrder: input.faceOrder,
    faces: input.faceManifests,
    globalKindOrder: input.globalKindOrder,
  })
  const title = String(input.title || '').trim() || '未命名'
  const description = String(input.description || '').trim()
  const tags = (input.tags || []).slice()
  const resources = (input.resources || []).slice()
  return {
    baseFields: { title, description, tags: tags.slice(), resources: resources.slice() },
    faceManifests: input.faceManifests,
    faceContents: {},
    savedFaceContents: {},
    editing: true,
    faceViewState: {},
    face: faces[0] || '',
    faces,
    editTitle: title,
    editDescription: description,
    editTags: tags,
    editResources: resources,
    tagInput: '',
    noteTimes: input.noteTimes,
    infoSidebarVisible: false,
  }
}

// 全局页面历史中的一个精确位置：普通页面只需要 page；详情页必须同时保留当时的 tabKey。
type NavHistoryEntry = {
  page: PageId
  tabKey?: string
}

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

  // ---- 核心 UI 状态
  const [page, setPageState] = React.useState<PageId>('home')
  const pageRef = React.useRef<PageId>('home')
  React.useEffect(() => {
    pageRef.current = page
  }, [page])

  const navHistoryRef = React.useRef<NavHistoryEntry[]>([])
  const fwdNavHistoryRef = React.useRef<NavHistoryEntry[]>([])

  const [openModalPage, setOpenModalPage] = React.useState<PageId | null>(null)
  const visiblePage = visiblePageId(page, openModalPage)
  const openModalPageRef = React.useRef<PageId | null>(null)
  React.useEffect(() => {
    openModalPageRef.current = openModalPage
  }, [openModalPage])

  const resolvePageDisplayMode = React.useCallback((id: PageId): PageDisplayMode => {
    if (!isModalCapablePageId(id)) return 'page'
    return pageDisplayModesRef.current[id] ?? 'page'
  }, [])
  const [navStackSizes, setNavStackSizes] = React.useState({ back: 0, forward: 0 })

  const syncNavStackCounts = React.useCallback(() => {
    setNavStackSizes({ back: navHistoryRef.current.length, forward: fwdNavHistoryRef.current.length })
  }, [])

  // 所有新导航（切页/开标签）的唯一入口：截断“未来”，记录“来处”。
  const recordNewNavLocation = React.useCallback(
    (entry: NavHistoryEntry) => {
      fwdNavHistoryRef.current = []
      const stack = navHistoryRef.current
      const last = stack.length ? stack[stack.length - 1] : null
      const duplicate = !!last && last.page === entry.page && last.tabKey === entry.tabKey
      if (!duplicate) {
        stack.push(entry)
        if (stack.length > 128) stack.splice(0, stack.length - 128)
      }
      syncNavStackCounts()
    },
    [syncNavStackCounts],
  )

  // ---- 顶部栏：快速搜索与快捷键提示
  const [quickSearchOpen, setQuickSearchOpen] = React.useState(false)
  const [shortcutHintsOpen, setShortcutHintsOpen] = React.useState(false)

  const navigatePage = React.useCallback(
    (next: PageId, opts?: { recordHistory?: boolean }) => {
      // 模态窗页面的“到达”是浮层：不进页面家族，前进/后退与亮灯天然与它无关。
      if (resolvePageDisplayMode(next) === 'modal') {
        setOpenModalPage(next)
        return
      }
      if (next !== pageRef.current && opts?.recordHistory !== false) {
        const currentPage = pageRef.current
        const currentTabKey =
          currentPage === 'note-detail' || currentPage === 'asset-detail' ? String(activeTabKeyRef.current || '').trim() : ''
        recordNewNavLocation(currentTabKey ? { page: currentPage, tabKey: currentTabKey } : { page: currentPage })
      }
      setPageState(next)
    },
    [recordNewNavLocation, resolvePageDisplayMode],
  )

  // ---- 现场装载（每个仓库只装载一次；切换回来直接复用内存现场）
  const repoStateRef = React.useRef<HyperCortexRepoStateV1 | null>(null)
  // 侧边栏滚动浏览位置（标识 → 像素）：内存实时记账，随仓库状态写盘持久化。左右两栏共用同一记账机制。
  const sidebarScrollTopsRef = React.useRef<Record<string, number>>({})
  const favoritesScrollTopsRef = React.useRef<Record<string, number>>({})
  const [repoReady, setRepoReady] = React.useState(false)
  const repoReadyRef = React.useRef(false)
  const [tabsInitReady, setTabsInitReady] = React.useState(false)
  const tabsInitReadyRef = React.useRef(false)
  const [workspaceInitError, setWorkspaceInitError] = React.useState<string | null>(null)
  const [workspaceInitRetrying, setWorkspaceInitRetrying] = React.useState(false)
  const mountedRef = React.useRef(true)
  const restoreActiveTabKeyRef = React.useRef<string>('')
  const autoCleanupRanForDaysRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    repoReadyRef.current = repoReady
  }, [repoReady])
  React.useEffect(() => {
    tabsInitReadyRef.current = tabsInitReady
  }, [tabsInitReady])
  React.useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  // ---- 全部笔记列表
  const { index: noteIndex, setIndex: setNoteIndex, loading: noteIndexLoading, error: noteIndexLoadError } = useNoteIndex(gateway, repoId, repoReady)
  const [favoritesDoc, setFavoritesDoc] = React.useState<HyperCortexFavoritesDocV1 | null>(null)
  const [currentFolderId, setCurrentFolderId] = React.useState<string>('root')
  const [assetPoolIndex, setAssetPoolIndex] = React.useState<Record<string, any> | null>(null)
  // 收藏夹导航栏（右侧栏）的独立浏览位置：与主界面收藏夹页互不干扰，随仓库持久化。
  const [favoritesNav, setFavoritesNav] = React.useState<HyperCortexFavoritesNavV1>(() => createFavoritesNav())
  const favoritesNavRef = React.useRef<HyperCortexFavoritesNavV1>(favoritesNav)
  React.useEffect(() => {
    favoritesNavRef.current = favoritesNav
  }, [favoritesNav])
  // 右侧收藏夹栏当前页的唯一视图：渲染与键盘切换共用同一份组装，避免配方重复。
  const favoritesFolderView = React.useMemo(
    () => buildFavoriteFolderView({ doc: favoritesDoc, folderId: favoritesNav.currentFolderId, assetIndex: assetPoolIndex?.assets }),
    [favoritesDoc, favoritesNav.currentFolderId, assetPoolIndex?.assets],
  )
  const favoritesFolderViewRef = React.useRef(favoritesFolderView)
  React.useEffect(() => {
    favoritesFolderViewRef.current = favoritesFolderView
  }, [favoritesFolderView])
  // 快捷键切换列表时的「最新值」引用：键盘回调常驻挂载，必须从 ref 读取当前数据。
  const favoritesDocRef = React.useRef(favoritesDoc)
  React.useEffect(() => {
    favoritesDocRef.current = favoritesDoc
  }, [favoritesDoc])
  const allNotes = React.useMemo(() => sortNotesByUpdatedAtDesc(Object.values(noteIndex?.notes || {})), [noteIndex])

  const [noteCardMenu, setNoteCardMenu] = React.useState<{ anchorEl: HTMLElement; note: NoteMeta } | null>(null)
  const openNoteCardMenu = React.useCallback((e: React.MouseEvent, note: NoteMeta) => {
    e.stopPropagation()
    setNoteCardMenu({ anchorEl: e.currentTarget as HTMLElement, note })
  }, [])
  const closeNoteCardMenu = React.useCallback(() => setNoteCardMenu(null), [])

  const [noteCardDeleteTarget, setNoteCardDeleteTarget] = React.useState<NoteMeta | null>(null)
  const [assetEntityDeleteTarget, setAssetEntityDeleteTarget] = React.useState<AssetEntry | null>(null)
  const [assetEntityDeleting, setAssetEntityDeleting] = React.useState(false)

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

  const [openAssetTabs, setOpenAssetTabs] = React.useState<AssetEntry[]>([])
  const [playingTabKeys, setPlayingTabKeys] = React.useState<ReadonlySet<string>>(() => new Set())

  const setTabPlaying = React.useCallback((tabKey: string, playing: boolean) => {
    const key = String(tabKey || '').trim()
    if (!key) return
    setPlayingTabKeys(prev => {
      if (prev.has(key) === playing) return prev
      const next = new Set(prev)
      if (playing) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  React.useEffect(() => {
    const openKeys = new Set(openTabKeys)
    setPlayingTabKeys(prev => {
      let changed = false
      const next = new Set<string>()
      for (const key of prev) {
        if (!openKeys.has(key)) {
          changed = true
          continue
        }
        next.add(key)
      }
      return changed ? next : prev
    })
  }, [openTabKeys])

  const mainScrollElRef = React.useRef<HTMLDivElement | null>(null)
  const noteScrollTopByIdRef = React.useRef<Record<string, number>>({})
  const scrollSaveRafRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    const el = mainScrollElRef.current
    if (!el) return

    const onScroll = () => {
      if (scrollSaveRafRef.current != null) return
      scrollSaveRafRef.current = requestAnimationFrame(() => {
        scrollSaveRafRef.current = null
        if (!visible) return
        if (pageRef.current !== 'note-detail') return
        const nid = String(activeNoteIdRef.current || '').trim()
        if (!nid) return
        noteScrollTopByIdRef.current[nid] = el.scrollTop
      })
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (scrollSaveRafRef.current != null) cancelAnimationFrame(scrollSaveRafRef.current)
      scrollSaveRafRef.current = null
    }
  }, [activeNoteId, page, visible])

  React.useLayoutEffect(() => {
    const el = mainScrollElRef.current
    if (!el) return
    if (!visible) return
    if (page !== 'note-detail') return
    const nid = String(activeNoteId || '').trim()
    if (!nid) return
    const saved = noteScrollTopByIdRef.current[nid]
    const next = typeof saved === 'number' && Number.isFinite(saved) && saved > 0 ? saved : 0
    el.scrollTop = next
  }, [activeNoteId, page, visible])

  const noteSessionHandlesRef = React.useRef<Record<string, NoteDetailSessionHandle | null>>({})
  const noteInitSnapshotsRef = React.useRef<Record<string, NoteDetailSnapshotV1>>({})
  const draftNoteMetaRef = React.useRef<Record<string, NoteMeta>>({})
  const [closeTabPrompt, setCloseTabPrompt] = React.useState<{ noteId: string } | null>(null)
  const requestCloseTabRef = React.useRef<(noteId: string) => void>(() => {})
  const closeTabKeysDirectRef = React.useRef<(tabKeys: string[]) => void>(() => {})
  const activateExistingTabKeyRef = React.useRef<(tabKey: string, opts?: { recordHistory?: boolean }) => boolean>(() => false)
  // 右侧收藏夹栏条目的激活入口（与左侧标签栏并列）：键盘切换据此落到右侧列表。
  const activateFavoritesEntryKeyRef = React.useRef<(tabKey: string) => boolean>(() => false)

  // ---- 侧边栏 / 工作区 / 分组
  const [tabsHoverOpen, setTabsHoverOpen] = React.useState(false)
  const sidebarHoverRef = React.useRef(false)
  const sidebarShortcutHoldRef = React.useRef(false)

  // ---- 按住预览：快捷键按住期间，悬停任一边栏条目即在主区域覆盖展示其预览。
  const [previewTarget, setPreviewTarget] = React.useState<SidebarPreviewTarget | null>(null)
  const previewHoldRef = React.useRef(false)
  const previewTargetKeyRef = React.useRef('')
  const previewOverlayScrollRef = React.useRef<HTMLDivElement | null>(null)
  // 条目间存在缝隙，指针扫过缝隙时不应立即还原，否则会在条目间来回闪烁。
  // 离开条目后短暂延迟再还原；期间进入下一条目即取消，实现无缝切换。
  const previewClearTimerRef = React.useRef<number | null>(null)

  const cancelPreviewClear = React.useCallback(() => {
    if (previewClearTimerRef.current === null) return
    window.clearTimeout(previewClearTimerRef.current)
    previewClearTimerRef.current = null
  }, [])

  // 预览目标写入的唯一入口：按目标键去重，避免同一目标在鼠标移动中反复触发重渲染。
  const applyPreviewTarget = React.useCallback((target: SidebarPreviewTarget | null) => {
    const key = target ? encodeSidebarPreviewTarget(target) : ''
    if (key === previewTargetKeyRef.current) return
    previewTargetKeyRef.current = key
    setPreviewTarget(target)
  }, [])

  // 边栏条目悬停上报：按住快捷键时，鼠标进入条目即切换预览，离开条目延迟还原。
  const handleSidebarPreviewHover = React.useCallback(
    (target: SidebarPreviewTarget | null) => {
      if (!previewHoldRef.current) return
      if (target) {
        cancelPreviewClear()
        applyPreviewTarget(target)
        return
      }
      if (previewClearTimerRef.current !== null) return
      previewClearTimerRef.current = window.setTimeout(() => {
        previewClearTimerRef.current = null
        if (previewHoldRef.current) applyPreviewTarget(null)
      }, 100)
    },
    [applyPreviewTarget, cancelPreviewClear],
  )
  const leftPreviewHover = useSidebarPreviewHover({ onHover: handleSidebarPreviewHover })
  const rightPreviewHover = useSidebarPreviewHover({ onHover: handleSidebarPreviewHover })

  const stopPreview = React.useCallback(() => {
    previewHoldRef.current = false
    cancelPreviewClear()
    applyPreviewTarget(null)
  }, [applyPreviewTarget, cancelPreviewClear])

  // 现场切走时还原预览：常驻现场不销毁，遗留的预览态不得跨现场泄漏。
  React.useEffect(() => {
    if (!visible) stopPreview()
  }, [stopPreview, visible])

  // 卸载时清掉待还原定时器，避免定时器在组件销毁后触发状态写入。
  React.useEffect(() => cancelPreviewClear, [cancelPreviewClear])
  const [workspaces, setWorkspaces] = React.useState<HyperCortexWorkspaceV1[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = React.useState<string>('')
  const [openNoteTabs, setOpenNoteTabs] = React.useState<NoteMeta[]>([])
  // 解析索引：正式笔记 + 内存草稿。草稿只活在 openNoteTabs，与正式笔记合并后，
  // 右侧收藏夹栏、索引页、右键菜单等消费者无需感知草稿，按同一套 noteIndex 解析。
  const resolvedNoteIndex = React.useMemo(() => {
    const base = noteIndex?.notes || {}
    const drafts: Record<string, NoteMeta> = {}
    for (const tab of openNoteTabs) {
      if (isDraftNoteId(tab.id)) drafts[tab.id] = tab
    }
    return Object.keys(drafts).length ? { ...base, ...drafts } : base
  }, [noteIndex, openNoteTabs])
  // 常驻键盘回调读取合并后的索引（含草稿），与渲染消费同一份解析结果。
  const noteIndexRef = React.useRef<{ notes?: Record<string, NoteMeta> }>({ notes: resolvedNoteIndex })
  React.useEffect(() => {
    noteIndexRef.current = { notes: resolvedNoteIndex }
  }, [resolvedNoteIndex])
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

  const activeWorkspaceIdRef = React.useRef('')
  const workspaceSwitchSeqRef = React.useRef(0)
  React.useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId
  }, [activeWorkspaceId])

  const consumeInitSnapshot = React.useCallback((noteId: string): NoteDetailSnapshotV1 | null => {
    const nid = String(noteId || '').trim()
    if (!nid) return null
    const snap = noteInitSnapshotsRef.current[nid]
    if (!snap) return null
    delete noteInitSnapshotsRef.current[nid]
    return snap
  }, [])

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

  // 仓库状态写回：统一携带侧边栏滚动位置的最新记账，任何一次写盘都持久化最新浏览位置。
  const persistRepoStatePatch = React.useCallback(
    async (patch: RepoStatePatch) => {
      const current = repoStateRef.current || { version: 1 }
      const next: HyperCortexRepoStateV1 = {
        ...current,
        ...patch,
        sidebarScrollTops: { ...sidebarScrollTopsRef.current },
        favoritesScrollTops: { ...favoritesScrollTopsRef.current },
        version: 1,
      }
      const sanitized = sanitizeRepoStateForSave(next)
      repoStateRef.current = sanitized
      await gateway.repoState.saveRepoState('library', sanitized)
    },
    [gateway],
  )

  // 左右两侧边栏共用同一套滚动记忆机制：按标识记账、防抖落盘、切走/卸载冲刷、可见化还原。
  const persistScrollMemory = React.useCallback(() => {
    if (!repoReadyRef.current) return
    void persistRepoStatePatch({}).catch(() => {})
  }, [persistRepoStatePatch])
  const sidebarScrollMemory = useKeyedScrollMemory({ topsRef: sidebarScrollTopsRef, visible, debounceMs: SIDEBAR_SCROLL_SAVE_DEBOUNCE_MS, onPersist: persistScrollMemory })
  const favoritesScrollMemory = useKeyedScrollMemory({ topsRef: favoritesScrollTopsRef, visible, debounceMs: SIDEBAR_SCROLL_SAVE_DEBOUNCE_MS, onPersist: persistScrollMemory })
  const { flush: flushSidebarScrollTop, reset: resetSidebarScrollMemory, clear: clearSidebarScrollMemory, report: reportSidebarScrollTop } = sidebarScrollMemory
  const { reset: resetFavoritesScrollMemory, clear: clearFavoritesScrollMemory, report: reportFavoritesScrollTop } = favoritesScrollMemory
  const sidebarScrollRestoreSignal = sidebarScrollMemory.restoreSignal
  const favoritesScrollRestoreSignal = favoritesScrollMemory.restoreSignal

  const handleSidebarScrollTopChange = React.useCallback(
    (scrollTop: number) => reportSidebarScrollTop(String(activeWorkspaceIdRef.current || '').trim(), scrollTop),
    [reportSidebarScrollTop],
  )
  const handleFavoritesScrollTopChange = React.useCallback(
    (scrollTop: number) => reportFavoritesScrollTop(String(favoritesNavRef.current?.currentFolderId || '').trim(), scrollTop),
    [reportFavoritesScrollTop],
  )

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

  // 快捷键打开页面的统一动作：模态窗=同名关层/异名替换，独立页=切页（先收浮层）。
  const handleShortcutOpenPage = React.useCallback(
    (targetId: PageId) => {
      if (resolvePageDisplayMode(targetId) === 'modal') {
        setOpenModalPage(prevOpen => (prevOpen === targetId ? null : targetId))
        return
      }
      setOpenModalPage(null)
      navigatePage(targetId)
    },
    [navigatePage, resolvePageDisplayMode],
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

  const handleTabsSidebarResizeEnd = React.useCallback((width: number) => {
    patchAppSettings({ tabsSidebarWidth: normalizeSidebarExpandedWidth(width) })
  }, [patchAppSettings])

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

  const handleFavoritesSidebarResizeEnd = React.useCallback((width: number) => {
    patchAppSettings({ favoritesSidebarWidth: normalizeSidebarExpandedWidth(width) })
  }, [patchAppSettings])

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

  const toggleFavoritesSidebarCollapsed = React.useCallback(() => {
    patchAppSettings({ favoritesSidebarCollapsed: !favoritesSidebarCollapsed })
  }, [favoritesSidebarCollapsed, patchAppSettings])

  const toggleFavoritesSidebarMode = React.useCallback(() => {
    setFavoritesHoverOpen(false)
    patchAppSettings({ favoritesSidebarMode: favoritesSidebarMode === 'manual' ? 'hover' : 'manual' })
  }, [favoritesSidebarMode, patchAppSettings])

  // 收藏夹文档变化（含实体删除）后调和导航位置：失效层回到根，历史剔除失效条目。
  React.useEffect(() => {
    if (!favoritesDoc) return
    const existing = new Set(Object.keys(favoritesDoc.folders || {}))
    const current = favoritesNavRef.current
    const next = reconcileFavoritesNav(current, existing)
    if (next === current) return
    persistFavoritesNav(next)
  }, [favoritesDoc, persistFavoritesNav])

  // 把当前位置转换成一条可回溯的导航记录。
  const captureCurrentNavEntry = React.useCallback((): NavHistoryEntry => {
    const page = pageRef.current
    const cur = String(activeTabKeyRef.current || '').trim()
    if ((page === 'note-detail' || page === 'asset-detail') && cur) return { page, tabKey: cur }
    return { page }
  }, [])

  // 校验并应用一条导航记录；失败返回 false 且不产生任何状态副作用。
  const tryApplyNavEntry = React.useCallback(
    (entry: NavHistoryEntry): boolean => {
      if (entry.tabKey) {
        const key = String(entry.tabKey || '').trim()
        if (!key || !openTabKeysRef.current.includes(key)) return false
        const currentKey = String(activeTabKeyRef.current || '').trim()
        if (key === currentKey && entry.page === pageRef.current) return false
        const kind = tabKind(key)
        if (kind !== 'note' && kind !== 'asset') return false
        const targetPage = kind === 'note' ? 'note-detail' : 'asset-detail'
        if (entry.page !== targetPage) return false
        setDetailSelectionSource('tabs')
        setActiveTabKey(key as any)
        commitActiveWorkspacePatch({ activeTabKey: key })
        if (kind === 'note') {
          const noteId = noteIdFromTabKey(key)
          if (!noteId) return false
          setActiveNoteId(noteId)
          navigatePage(targetPage, { recordHistory: false })
        } else {
          setActiveNoteId('')
          navigatePage(targetPage, { recordHistory: false })
        }
        return true
      }

      const target = entry.page
      if (!target || target === pageRef.current) return false
      if (target === 'note-detail' || target === 'asset-detail') {
        // 详情页没有精确标签就不能安全恢复，禁止从当前打开集合中猜一条笔记。
        return false
      }

      navigatePage(target, { recordHistory: false })
      return true
    },
    [commitActiveWorkspacePatch, navigatePage],
  )

  const goBackPage = React.useCallback(async () => {
    const capture = captureCurrentNavEntry()
    while (navHistoryRef.current.length) {
      const entry = navHistoryRef.current.pop()!
      if (!tryApplyNavEntry(entry)) continue
      fwdNavHistoryRef.current.push(capture)
      if (fwdNavHistoryRef.current.length > 128) fwdNavHistoryRef.current.splice(0, fwdNavHistoryRef.current.length - 128)
      syncNavStackCounts()
      return
    }
    await gateway.host.toast('没有上一页了')
  }, [captureCurrentNavEntry, tryApplyNavEntry, syncNavStackCounts, gateway])

  const goForwardPage = React.useCallback(async () => {
    const capture = captureCurrentNavEntry()
    while (fwdNavHistoryRef.current.length) {
      const entry = fwdNavHistoryRef.current.pop()!
      if (!tryApplyNavEntry(entry)) continue
      navHistoryRef.current.push(capture)
      if (navHistoryRef.current.length > 128) navHistoryRef.current.splice(0, navHistoryRef.current.length - 128)
      syncNavStackCounts()
      return
    }
    await gateway.host.toast('没有下一页了')
  }, [captureCurrentNavEntry, tryApplyNavEntry, syncNavStackCounts, gateway])

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
        setOpenNoteTabs([])
        setOpenAssetTabs([])
      } else {
        void (async () => {
          try {
            const noteKeys = nextOpenTabKeys.filter(k => tabKind(k) === 'note')
            const assetKeys = nextOpenTabKeys.filter(k => tabKind(k) === 'asset')

            const idx = await gateway.notes.loadNoteIndex('library')
            const noteTabs = noteKeys
              .map(k => {
                const noteId = noteIdFromTabKey(k)
                if (!noteId) return null
                return (idx.notes?.[noteId] as NoteMeta | undefined) || draftNoteMetaRef.current[noteId] || null
              })
              .filter(Boolean) as NoteMeta[]

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
            setOpenNoteTabs(noteTabs)
            setOpenAssetTabs(assetTabs)
          } catch {
            if (workspaceSwitchSeqRef.current !== seq) return
            setOpenNoteTabs([])
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

  // applyRepoStateToUi 把仓库工作状态装载为界面现场；返回归一化结果供持久化判断。
  const applyRepoStateToUi = React.useCallback(
    (normalizedRepoState: HyperCortexRepoStateV1) => {
      repoStateRef.current = normalizedRepoState
      resetSidebarScrollMemory(normalizedRepoState.sidebarScrollTops)
      resetFavoritesScrollMemory(normalizedRepoState.favoritesScrollTops)
      setCurrentFolderId(String(normalizedRepoState.currentFolderId || '').trim() || 'root')
      setFavoritesNav(normalizeFavoritesNav(normalizedRepoState.favoritesNav))
      const activeKey = typeof normalizedRepoState.activeTabKey === 'string' ? normalizedRepoState.activeTabKey.trim() : ''
      restoreActiveTabKeyRef.current = activeKey

      const legacyTabsDetected =
        Array.isArray((normalizedRepoState as any).openNoteIds) ||
        typeof (normalizedRepoState as any).activeNoteId === 'string' ||
        ((normalizedRepoState as any).tabGroupByNoteId && typeof (normalizedRepoState as any).tabGroupByNoteId === 'object')
      const v2TabsDetected =
        Array.isArray((normalizedRepoState as any).openTabKeys) ||
        typeof (normalizedRepoState as any).activeTabKey === 'string' ||
        ((normalizedRepoState as any).tabGroupByTabKey && typeof (normalizedRepoState as any).tabGroupByTabKey === 'object') ||
        Array.isArray(normalizedRepoState.workspaces)
      if (legacyTabsDetected && !v2TabsDetected) {
        void gateway.host.toast('检测到旧版标签页数据：当前开发版本已移除迁移逻辑，请重置 HyperCortex 数据后再试')
      }

      let nextWorkspaces = normalizeWorkspaces(normalizedRepoState.workspaces, {
        sidebarItems: normalizedRepoState.sidebarItems,
        openTabKeys: normalizedRepoState.openTabKeys,
        activeTabKey: normalizedRepoState.activeTabKey,
        tabGroups: normalizedRepoState.tabGroups,
        tabGroupByTabKey: normalizedRepoState.tabGroupByTabKey,
      })
      const nextActiveWorkspaceId = normalizeActiveWorkspaceId(normalizedRepoState.activeWorkspaceId, nextWorkspaces)
      let activeWs = nextWorkspaces.find(w => w.id === nextActiveWorkspaceId) || nextWorkspaces[0]

      let didMutateActiveWorkspace = false
      if (activeWs && activeKey) {
        const openKeys = activeWs.openTabKeys
        if (!openKeys.includes(activeKey)) {
          const nextSidebarItems = insertTabAsUngrouped(ensureSidebarItems(activeWs), activeKey, ensureSidebarItems(activeWs).length)
          const nextWs = applySidebarItemsToWorkspace({ ...activeWs, activeTabKey: activeKey }, nextSidebarItems)
          nextWorkspaces = updateWorkspaceById(nextWorkspaces, nextActiveWorkspaceId, () => nextWs)
          activeWs = nextWs
          didMutateActiveWorkspace = true
        }
      }

      activeWorkspaceIdRef.current = nextActiveWorkspaceId
      setWorkspaces(nextWorkspaces)
      setActiveWorkspaceId(nextActiveWorkspaceId)
      if (activeWs) applyWorkspaceSidebarState(activeWs)
      return { nextWorkspaces, nextActiveWorkspaceId, didMutateActiveWorkspace }
    },
    [applyWorkspaceSidebarState, gateway, resetFavoritesScrollMemory, resetSidebarScrollMemory],
  )

  // 现场装载：激活仓库（骨架与派生索引调和）→ 仓库状态 + 收藏夹 + 附件索引。
  const loadRepoData = React.useCallback(async () => {
    const [normalizedRepoState, nextFavoritesDoc, nextAssetPoolIndex] = await Promise.all([
      gateway.repoState.ensureRepoState('library'),
      gateway.favorites.ensureFavorites('library'),
      gateway.assets.ensureAssetsIndex('library'),
    ])
    const applied = applyRepoStateToUi(normalizedRepoState)
    setFavoritesDoc(nextFavoritesDoc)
    setAssetPoolIndex(nextAssetPoolIndex as any)
    return { normalizedRepoState, ...applied }
  }, [applyRepoStateToUi, gateway])

  // 仓库状态在装载时被归一化（补工作区、补当前标签）时写回，避免每次装载重复归一化。
  const persistRepoStateNormalization = React.useCallback(
    (
      normalizedRepoState: HyperCortexRepoStateV1,
      applied: { nextWorkspaces: HyperCortexWorkspaceV1[]; nextActiveWorkspaceId: string; didMutateActiveWorkspace: boolean },
    ) => {
      const shouldPersist =
        !Array.isArray(normalizedRepoState.workspaces) ||
        normalizedRepoState.activeWorkspaceId !== applied.nextActiveWorkspaceId ||
        applied.didMutateActiveWorkspace
      if (shouldPersist) {
        void persistRepoStatePatch(buildRepoStateSnapshot(applied.nextWorkspaces, applied.nextActiveWorkspaceId)).catch(() => {})
      }
    },
    [persistRepoStatePatch],
  )

  const runRepoInitialization = React.useCallback(async () => {
    setWorkspaceInitError(null)
    setWorkspaceInitRetrying(true)
    repoReadyRef.current = false
    tabsInitReadyRef.current = false
    setRepoReady(false)
    setTabsInitReady(false)
    try {
      await gateway.repos.activateRepo(repoId)
      const { normalizedRepoState, ...applied } = await loadRepoData()
      persistRepoStateNormalization(normalizedRepoState, applied)
      if (!mountedRef.current) return
      tabsInitReadyRef.current = true
      repoReadyRef.current = true
      setTabsInitReady(true)
      setRepoReady(true)
    } catch (e: any) {
      if (!mountedRef.current) return
      const message = String(e?.message || e || '仓库加载失败')
      setWorkspaceInitError(message)
      void gateway.host.toast(message)
    } finally {
      if (mountedRef.current) setWorkspaceInitRetrying(false)
    }
  }, [gateway, loadRepoData, persistRepoStateNormalization, repoId])

  React.useEffect(() => {
    void runRepoInitialization()
  }, [runRepoInitialization])

  React.useEffect(() => {
    if (!repoReady) return
    const days = trashAutoDeleteDaysRef.current
    if (!(days > 0)) return
    if (autoCleanupRanForDaysRef.current === days) return
    autoCleanupRanForDaysRef.current = days
    void (async () => {
      const result = await gateway.trash.maybeAutoCleanupTrash('library', days).catch(() => null)
      if (!result || !(result.deletedCount > 0)) return
      void gateway.host.toast(`回收站已自动清理 ${result.deletedCount} 项`)
    })()
  }, [gateway, repoReady, trashAutoDeleteDays])

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
      const normalizedDoc = normalizeFavoritesDoc(nextDoc).doc
      setFavoritesDoc(normalizedDoc)
      // 内存保留草稿引用；发给磁盘前剔除，避免磁盘残留指向草稿的引用。
      const persisted = stripDraftNoteRefs(normalizedDoc)
      void gateway.favorites.saveFavorites('library', persisted).catch(() => {})
    },
    [gateway],
  )

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
        setOpenNoteTabs(prev => prev.map(tab => (tab.id === note.id ? { ...tab, title: result.meta.title, description: result.meta.description } : tab)))
        void refreshNoteCardInfo(result.meta).catch(() => {})
        void gateway.host.toast('笔记信息已更新')
      } catch (err: any) {
        void gateway.host.toast(`更新笔记信息失败：${String(err?.message || err || '未知错误')}`)
      }
    },
    [gateway, refreshNoteCardInfo],
  )

  const handleUpdateAssetInfo = React.useCallback(
    async (asset: AssetEntry, patch: { displayName: string; remark: string }) => {
      try {
        await gateway.assets.updateAssetMetadata('library', asset.assetId, asset.ext, {
          displayName: patch.displayName,
          remark: patch.remark,
          tags: asset.tags || [],
        })
        setAssetPoolIndex(prev => {
          if (!prev || typeof prev !== 'object') return prev
          const key = asset.ext ? `${asset.assetId}.${asset.ext}` : asset.assetId
          return {
            ...(prev as any),
            assets: {
              ...((prev as any).assets || {}),
              [key]: { ...((prev as any).assets?.[key] || {}), displayName: patch.displayName, remark: patch.remark },
            },
          }
        })
        void gateway.host.toast('附件信息已更新')
      } catch (err: any) {
        void gateway.host.toast(`更新附件信息失败：${String(err?.message || err || '未知错误')}`)
      }
    },
    [gateway],
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

  const handleOpenTrashPage = React.useCallback(() => navigatePage('trash'), [navigatePage])
  const handleOpenRepoTrashPage = React.useCallback(() => navigatePage('repo-trash'), [navigatePage])

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

  const handleDeleteAssetEntity = React.useCallback(
    async (asset: AssetEntry) => {
      const assetId = String(asset?.assetId || '').trim()
      if (!assetId) return
      try {
        await gateway.trash.moveAssetToTrash('library', assetId, asset.ext)
        const tabKey = assetTabId(asset)
        closeTabKeysDirectRef.current([tabKey])
        setAssetPoolIndex(prev => {
          if (!prev || typeof prev !== 'object') return prev
          const assets = { ...((prev as any).assets || {}) }
          delete assets[asset.ext ? `${assetId}.${asset.ext}` : assetId]
          return { ...(prev as any), assets }
        })
        void gateway.host.toast('附件已移入回收站')
      } catch (e: any) {
        void gateway.host.toast(String(e?.message || e || '删除附件失败'))
      }
    },
    [gateway],
  )

  const requestDeleteAssetEntity = React.useCallback((asset: AssetEntry) => {
    setAssetEntityDeleteTarget(asset)
  }, [])

  const closeAssetEntityDeleteDialog = React.useCallback(() => {
    if (assetEntityDeleting) return
    setAssetEntityDeleteTarget(null)
  }, [assetEntityDeleting])

  const confirmDeleteAssetEntity = React.useCallback(async () => {
    const target = assetEntityDeleteTarget
    if (!target || assetEntityDeleting) return
    setAssetEntityDeleting(true)
    try {
      await handleDeleteAssetEntity(target)
      setAssetEntityDeleteTarget(null)
    } finally {
      setAssetEntityDeleting(false)
    }
  }, [assetEntityDeleteTarget, assetEntityDeleting, handleDeleteAssetEntity])

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

  const handleTrashAssetRestored = React.useCallback(
    async (asset: AssetEntry) => {
      const nextAssetIndex = await gateway.assets.ensureAssetsIndex('library').catch(() => null)
      if (nextAssetIndex) setAssetPoolIndex(nextAssetIndex as any)
      void gateway.host.toast(`已恢复附件：${assetRefKey(asset)}`)
    },
    [gateway],
  )

  // 草稿笔记的构造：注册草稿元数据与会话初始快照，返回可打开的 NoteMeta。
  // 左侧栏新建与右侧收藏夹新建共用同一构造，保证草稿语义单一。
  const createDraftNoteMeta = React.useCallback((): NoteMeta => {
    const now = Date.now()
    const draftId = `draft_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const meta: NoteMeta = {
      id: draftId,
      title: '未命名',
      description: '',
      dir: '',
      createdAtMs: now,
      updatedAtMs: now,
    }
    draftNoteMetaRef.current[draftId] = meta

    // 新笔记默认创建的面：按全局顺序排列，名单来自后端声明。
    const defaultFaceManifests = orderKindsByGlobalOrder(defaultFaceKinds, faceKindOrder).map(kind => faceManifestFromDeclaration(requireFaceDeclaration(kind)))
    noteInitSnapshotsRef.current[draftId] = buildNoteInitSnapshot({
      faceManifests: Object.fromEntries(defaultFaceManifests.map(face => [face.id, face])),
      globalKindOrder: faceKindOrder,
      title: '未命名',
      noteTimes: { createdAtMs: now, updatedAtMs: now },
    })
    return meta
  }, [defaultFaceKinds, faceKindOrder])

  // 打开草稿并激活：来源决定草稿归属哪一侧——左侧栏新建只进左侧列表并选中左侧；
  // 右侧收藏夹新建只进右侧引用并选中右侧。会话列表（openNoteTabs）两侧共用，与归属无关。
  const openDraftNoteTab = React.useCallback(
    (meta: NoteMeta, source: 'tabs' | 'favorites') => {
      const draftKey = noteTabKey(meta.id)
      setOpenNoteTabs(prev => (prev.some(t => t.id === meta.id) ? prev : [...prev, meta]))
      setActiveNoteId(meta.id)
      setActiveTabKey(draftKey)
      setDetailSelectionSource(source)
      if (source === 'tabs') {
        updateSidebarItems(prev => insertTabAsUngrouped(prev, draftKey, prev.length), { activeTabKey: draftKey })
      }
      navigatePage('note-detail')
    },
    [navigatePage, updateSidebarItems],
  )

  const handleCreateDraftNote = React.useCallback(() => {
    if (!tabsInitReady || !activeWorkspaceIdRef.current) {
      enqueueAppCommand('new-note')
      return
    }
    openDraftNoteTab(createDraftNoteMeta(), 'tabs')
  }, [createDraftNoteMeta, enqueueAppCommand, openDraftNoteTab, tabsInitReady])

  // 在指定收藏夹创建草稿笔记并加入该收藏夹引用，同时打开草稿（归属右侧）。
  // 草稿引用只进内存收藏夹文档，落盘时被过滤；保存转正时由 handleNoteSessionSaved 迁移引用。
  const handleCreateDraftNoteInFolder = React.useCallback(
    (folderId: string) => {
      if (!tabsInitReady || !activeWorkspaceIdRef.current) {
        enqueueAppCommand('new-note')
        return
      }
      const baseDoc = favoritesDocRef.current
      if (!baseDoc) return
      const fid = String(folderId || '').trim() || 'root'
      const meta = createDraftNoteMeta()
      const added = addRef(baseDoc, fid, 'note', meta.id)
      if (added) handleFavoritesDocChange(added.doc)
      openDraftNoteTab(meta, 'favorites')
    },
    [createDraftNoteMeta, enqueueAppCommand, handleFavoritesDocChange, openDraftNoteTab, tabsInitReady],
  )

  const handleAppCommand = React.useCallback(
    (command: string | null | undefined) => {
      const id = String(command || '').trim()
      if (!id || id === 'open-hypercortex') return
      if (id === 'new-note') {
        handleCreateDraftNote()
        return
      }
      if (id === 'quick-search') {
        setShortcutHintsOpen(false)
        setQuickSearchOpen(true)
        return
      }
      if (id === 'open-assets') {
        navigatePage('attachments')
        return
      }
      void gateway.host.toast(`未知命令：${id}`)
    },
    [gateway, handleCreateDraftNote, navigatePage],
  )

  React.useEffect(() => {
    if (!visible) return
    if (!tabsInitReady || !activeWorkspaceId) return
    const command = String(appCommandQueue[0] || '').trim()
    if (!command) return
    consumeAppCommand()
    handleAppCommand(command)
  }, [activeWorkspaceId, appCommandQueue, consumeAppCommand, handleAppCommand, tabsInitReady, visible])

  React.useEffect(() => {
    if (!visible) return
    if (!repoReady) return
    if (visiblePage !== 'settings') return
    void refreshDataDirStatus().catch(() => {})
  }, [refreshDataDirStatus, repoReady, visible, visiblePage])

  React.useEffect(() => {
    // 快捷键只属于活动现场：非活动现场的监听不挂载，避免多现场同时响应。
    if (!visible) return

    const clearTabSwitchHold = () => {
      const win = window as any
      if (win.__hcTabSwitchHoldTimer) clearTimeout(win.__hcTabSwitchHoldTimer)
      if (win.__hcTabSwitchHoldInterval) clearInterval(win.__hcTabSwitchHoldInterval)
      win.__hcTabSwitchHoldTimer = null
      win.__hcTabSwitchHoldInterval = null
      win.__hcTabSwitchHoldDir = null
    }

    const getVisibleSidebarTabKeys = (): string[] => {
      const openKeys = new Set((openTabKeysRef.current || []).map(s => String(s || '').trim()).filter(Boolean))
      const out: string[] = []
      const seen = new Set<string>()

      const pushTabKey = (rawTabKey: unknown) => {
        const tabKey = String(rawTabKey || '').trim()
        if (!tabKey || !openKeys.has(tabKey) || seen.has(tabKey)) return
        seen.add(tabKey)
        out.push(tabKey)
      }

      // 快捷键切换必须跟侧边栏渲染使用同一份线性模型，否则根标签会被误排到所有分组前面。
      for (const item of sidebarItemsRef.current || []) {
        if (item.type === 'tab') {
          pushTabKey(item.tabKey)
          continue
        }
        if (item.collapsed === true) continue
        for (const tabKey of item.tabKeys) pushTabKey(tabKey)
      }

      return out
    }

    // 右侧收藏夹栏当前页的可切换条目序列：与渲染同源（同一份视图），按引用顺序解析。
    const getVisibleFavoriteTabKeys = (): string[] => favoritesFolderViewRef.current.entries.map(entry => entry.tabKey)

    const getVisibleSwitchKeys = (): string[] =>
      resolvedSelectionSourceRef.current === 'favorites' ? getVisibleFavoriteTabKeys() : getVisibleSidebarTabKeys()

    const triggerSwitchTab = (direction: -1 | 1): boolean => {
      if (pageRef.current !== 'note-detail' && pageRef.current !== 'asset-detail') {
        clearTabSwitchHold()
        return false
      }
      const fromFavorites = resolvedSelectionSourceRef.current === 'favorites'
      const keys = getVisibleSwitchKeys()
      if (keys.length <= 1) {
        clearTabSwitchHold()
        return false
      }
      const cur = String(activeTabKeyRef.current || '').trim()
      const idx = cur ? keys.indexOf(cur) : -1
      if (idx < 0) {
        // 归属右侧时当前目标必在右侧列表内；能到这里说明左侧详情页没有 active tab，属异常，直接停止。
        clearTabSwitchHold()
        return false
      }
      const nextIndex = idx + direction
      if (nextIndex < 0 || nextIndex >= keys.length) {
        // 到边界就停，不循环。
        clearTabSwitchHold()
        return false
      }
      const nextKey = String(keys[nextIndex] || '').trim()
      if (!nextKey || nextKey === cur) return false
      const activated = fromFavorites
        ? activateFavoritesEntryKeyRef.current(nextKey)
        : activateExistingTabKeyRef.current(nextKey, { recordHistory: false })
      if (activated) {
        if (fromFavorites) setFavoritesActiveScrollSignal(signal => signal + 1)
        else setActiveTabScrollSignal(signal => signal + 1)
      }
      return activated
    }

    const startTabSwitchHoldToRepeat = (direction: -1 | 1) => {
      // 按住重复：首发一次，然后 260ms 后进入 55ms 连发。
      const win = window as any
      clearTabSwitchHold()
      win.__hcTabSwitchHoldDir = direction

      const didSwitch = triggerSwitchTab(direction)
      if (!didSwitch) return

      // 不满足“在标签页内且有至少 2 个标签页”时，不启动连发。
      if (pageRef.current !== 'note-detail' && pageRef.current !== 'asset-detail') return
      if (getVisibleSwitchKeys().length <= 1) return

      win.__hcTabSwitchHoldTimer = setTimeout(() => {
        win.__hcTabSwitchHoldInterval = setInterval(() => {
          triggerSwitchTab(win.__hcTabSwitchHoldDir === -1 ? -1 : 1)
        }, 55)
      }, 260)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (shortcutRecordingRef.current) return

      if (e.key === 'Escape' && shortcutHintsOpen) {
        e.preventDefault()
        e.stopPropagation()
        setShortcutHintsOpen(false)
        return
      }

      const bindings = shortcutBindingsRef.current
      if (!bindings) return

      // 禁用 Tab 的默认“焦点切换/选中游走”，但不影响编辑器/输入框内的 Tab（例如缩进）。
      // 若 Tab 已被绑定为某个快捷键（如按住预览），则放行给下方快捷键分发处理。
      if (e.key === 'Tab' && !isEditableTarget(e.target)) {
        const tabBoundToShortcut = Object.entries(bindings).some(([key, chord]) => key !== 'version' && shouldTriggerShortcut(e, String(chord || '')))
        if (!tabBoundToShortcut) {
          e.preventDefault()
          e.stopPropagation()
          return
        }
      }

      // 注意力焦点：浮层开着时，快捷键应作用于浮层页面；被遮住的底层页面不再响应。
      const overlayPage = openModalPageRef.current
      const focusPage = visiblePageId(pageRef.current, overlayPage)

      // 按住预览：按住即进入预览态并立刻拾取当前悬停条目；松开时还原。
      if (shouldTriggerShortcut(e, bindings.holdPreview)) {
        e.preventDefault()
        e.stopPropagation()
        previewHoldRef.current = true
        setPreviewTarget(readHoveredSidebarPreviewTarget())
        return
      }

      // 长按行为只在对应 mainKey 抬起时停止。
      if (!overlayPage && shouldTriggerShortcut(e, bindings.selectPrevTab)) {
        e.preventDefault()
        e.stopPropagation()
        startTabSwitchHoldToRepeat(-1)
        return
      }

      if (!overlayPage && shouldTriggerShortcut(e, bindings.selectNextTab)) {
        e.preventDefault()
        e.stopPropagation()
        startTabSwitchHoldToRepeat(1)
        return
      }

      if (!overlayPage && shouldTriggerShortcut(e, bindings.toggleSidebar)) {
        e.preventDefault()
        e.stopPropagation()
        if (tabsMode === 'hover') {
          sidebarShortcutHoldRef.current = true
          setTabsHoverOpen(true)
        } else {
          toggleTabsCollapsed()
        }
        return
      }

      if (!overlayPage && shouldTriggerShortcut(e, bindings.toggleFavoritesSidebar)) {
        e.preventDefault()
        e.stopPropagation()
        if (favoritesSidebarMode === 'hover') {
          favoritesSidebarShortcutHoldRef.current = true
          setFavoritesHoverOpen(true)
        } else {
          toggleFavoritesSidebarCollapsed()
        }
        return
      }

      if (!overlayPage && shouldTriggerShortcut(e, bindings.goBackPage)) {
        e.preventDefault()
        e.stopPropagation()
        void goBackPage()
        return
      }

      for (const item of PAGE_SHORTCUT_TARGETS) {
        if (shouldTriggerShortcut(e, bindings[item.id])) {
          e.preventDefault()
          e.stopPropagation()
          handleShortcutOpenPage(item.target)
          return
        }
      }

      if (!overlayPage && shouldTriggerShortcut(e, bindings.newNote)) {
        e.preventDefault()
        e.stopPropagation()
        handleCreateDraftNote()
        return
      }

      if (!overlayPage && shouldTriggerShortcut(e, bindings.toggleQuickSearch)) {
        e.preventDefault()
        e.stopPropagation()
        setShortcutHintsOpen(false)
        setQuickSearchOpen(prev => !prev)
        return
      }

      if (!overlayPage && shouldTriggerShortcut(e, bindings.closeActiveTab)) {
        if (focusPage !== 'note-detail' && focusPage !== 'asset-detail') return
        const key = String(activeTabKeyRef.current || '').trim()
        if (!key) return
        e.preventDefault()
        e.stopPropagation()
        if (tabKind(key) === 'note') {
          const nid = noteIdFromTabKey(key)
          if (!nid) return
          requestCloseTabRef.current(nid)
        } else {
          closeTabKeysDirectRef.current([key])
        }
        return
      }

      if (focusPage !== 'note-detail') return
      const nid = String(activeNoteIdRef.current || '').trim()
      if (!nid) return
      const handle = noteSessionHandlesRef.current[nid]
      if (!handle) return

      if (shouldTriggerShortcut(e, bindings.saveNote)) {
        e.preventDefault()
        e.stopPropagation()
        void handle.save()
        return
      }

      if (shouldTriggerShortcut(e, bindings.toggleMode)) {
        e.preventDefault()
        e.stopPropagation()
        handle.toggleMode()
        return
      }

      if (shouldTriggerShortcut(e, bindings.cycleFace)) {
        e.preventDefault()
        e.stopPropagation()
        handle.cycleFace()
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (shortcutRecordingRef.current) return

      // stop hold-to-repeat tab switching
      const bindings = shortcutBindingsRef.current
      if (bindings) {
        const win = window as any
        const holding = !!(win && (win.__hcTabSwitchHoldTimer || win.__hcTabSwitchHoldInterval))
        if (holding) {
          const upPrev = bindings.selectPrevTab && isKeyUpForChordMainKey(e, bindings.selectPrevTab)
          const upNext = bindings.selectNextTab && isKeyUpForChordMainKey(e, bindings.selectNextTab)
          if (upPrev || upNext) clearTabSwitchHold()
        }
      }

      // 按住预览：松开快捷键（或窗口失焦）立即无缝还原原主区域内容。
      if (bindings && bindings.holdPreview && isKeyUpForChordMainKey(e, bindings.holdPreview)) {
        stopPreview()
      }

      // 收藏夹侧边栏按住展开：松开时若鼠标不在其上则收起。
      if (favoritesSidebarShortcutHoldRef.current && bindings && bindings.toggleFavoritesSidebar && isKeyUpForChordMainKey(e, bindings.toggleFavoritesSidebar)) {
        favoritesSidebarShortcutHoldRef.current = false
        if (!favoritesHoverRef.current) setFavoritesHoverOpen(false)
      }

      if (tabsMode !== 'hover') return
      if (!sidebarShortcutHoldRef.current) return
      if (!bindings) return
      if (!bindings.toggleSidebar) return
      if (!isKeyUpForChordMainKey(e, bindings.toggleSidebar)) return

      sidebarShortcutHoldRef.current = false
      if (!sidebarHoverRef.current) setTabsHoverOpen(false)
    }

    const onWindowBlur = () => {
      clearTabSwitchHold()
      stopPreview()
      favoritesSidebarShortcutHoldRef.current = false
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onWindowBlur, true)
    return () => {
      clearTabSwitchHold()
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onWindowBlur, true)
    }
  }, [favoritesSidebarMode, goBackPage, handleCreateDraftNote, handleShortcutOpenPage, navigatePage, shortcutHintsOpen, stopPreview, tabsMode, toggleFavoritesSidebarCollapsed, toggleTabsCollapsed, visible])

  // 预览期间在原位滚轮：把边栏上的滚轮事件转发给覆盖层滚动容器，滚动主区域预览内容。
  React.useEffect(() => {
    if (!visible) return
    const onWheelCapture = (e: WheelEvent) => {
      const overlay = previewOverlayScrollRef.current
      if (!overlay) return
      const target = e.target instanceof Element ? e.target : null
      if (!target) return
      if (target.closest('[data-hc-hold-preview-overlay="1"]')) return
      if (!target.closest('[data-hc-preview-entry]')) return
      overlay.scrollTop += e.deltaY
      e.preventDefault()
    }
    window.addEventListener('wheel', onWheelCapture, { capture: true, passive: false })
    return () => window.removeEventListener('wheel', onWheelCapture, true)
  }, [visible])

  const handleOpenNote = React.useCallback(
    (note: NoteMeta, faceId?: string, source: 'tabs' | 'favorites' = 'tabs', opts?: { recordHistory?: boolean }) => {
      const nid = String(note?.id || '').trim()
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
      setOpenNoteTabs(prev => {
        return prev.some(t => t.id === nid) ? prev : [...prev, note]
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
    [commitActiveWorkspacePatch, navigatePage, recordNewNavLocation, updateSidebarItems],
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
        noteInitSnapshotsRef.current[meta.id] = buildNoteInitSnapshot({
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
        })
        handleOpenNote(meta)
        void gateway.host.toast('已创建空白笔记并添加到索引页')
      } catch (e: any) {
        void gateway.host.toast(String(e?.message || e || '创建笔记失败'))
      }
    },
    [defaultFaceKinds, faceKindOrder, favoritesDoc, gateway, handleFavoritesDocChange, handleOpenNote],
  )

  const handleOpenAssetTab = React.useCallback(
    (asset: AssetEntry, source: 'tabs' | 'favorites' = 'tabs', opts?: { recordHistory?: boolean }) => {
      setDetailSelectionSource(source)
      const sanitized: AssetEntry = { ...asset, thumbnailUrl: undefined }
      const tabKey = assetTabId(sanitized) as TabKey
      const prevActiveKey = String(activeTabKeyRef.current || '').trim()
      const recordHistory = opts?.recordHistory !== false
      if (recordHistory && (pageRef.current === 'note-detail' || pageRef.current === 'asset-detail') && prevActiveKey && prevActiveKey !== tabKey) {
        recordNewNavLocation({ page: pageRef.current, tabKey: prevActiveKey })
      }
      setOpenAssetTabs(prev => {
        const idx = prev.findIndex(a => assetTabId(a) === tabKey)
        if (idx >= 0) {
          const next = prev.slice()
          next[idx] = sanitized
          return next
        }
        return [...prev, sanitized]
      })
      setActiveTabKey(tabKey)
      setActiveNoteId('')
      // 来源为右侧收藏夹时不改动左侧列表：仅切换详情目标并持久化目标键。
      if (source === 'tabs') {
        updateSidebarItems(prev => (deriveSidebarFields(prev).openTabKeys.includes(tabKey) ? prev : insertTabAsUngrouped(prev, tabKey, prev.length)), { activeTabKey: tabKey })
      } else {
        commitActiveWorkspacePatch({ activeTabKey: tabKey })
      }
      navigatePage('asset-detail', { recordHistory })
    },
    [commitActiveWorkspacePatch, navigatePage, recordNewNavLocation, updateSidebarItems],
  )

  const handleAssetTabUpdated = React.useCallback((asset: AssetEntry) => {
    const tabKey = assetTabId(asset)
    setOpenAssetTabs(prev => prev.map(item => (assetTabId(item) === tabKey ? { ...asset, thumbnailUrl: item.thumbnailUrl } : item)))
    setAssetPoolIndex(prev => {
      if (!prev || typeof prev !== 'object') return prev
      const key = asset.ext ? `${asset.assetId}.${asset.ext}` : asset.assetId
      return { ...(prev as any), assets: { ...((prev as any).assets || {}), [key]: { ...asset, path: asset.relPath } } }
    })
  }, [])

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

      for (const key of closing) {
        if (tabKind(key) !== 'note') continue
        const nid = noteIdFromTabKey(key)
        if (!nid) continue
        if (isDraftNoteId(nid)) {
          delete draftNoteMetaRef.current[nid]
          delete noteInitSnapshotsRef.current[nid]
          // 草稿被放弃：清理它在收藏夹里留下的引用（草稿引用只活在内存）。
          const currentDoc = favoritesDocRef.current
          if (currentDoc) {
            const cleaned = removeNoteRefsByTargetId(currentDoc, nid)
            if (cleaned !== currentDoc) handleFavoritesDocChange(cleaned)
          }
        }
        delete noteSessionHandlesRef.current[nid]
        delete noteInitSnapshotsRef.current[nid]
        delete noteScrollTopByIdRef.current[nid]
      }

      let nextActive = currentActive
      const didCloseActive = currentActive && closing.has(currentActive)
      if (didCloseActive) {
        const prevIdx = prevKeys.indexOf(currentActive)
        nextActive = nextKeys[prevIdx] || nextKeys[prevIdx - 1] || ''
      }

      updateSidebarItems(prev => closeTabsInSidebar(prev, Array.from(closing)), { activeTabKey: nextActive })

      setOpenNoteTabs(prev => prev.filter(n => !closing.has(noteTabKey(n.id))))
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
    [activateExistingTabKey, handleFavoritesDocChange, navigatePage, persistRepoStatePatch, updateSidebarItems],
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

  React.useEffect(() => {
    if (!repoReady || !tabsInitReady) return
    const targetKey = restoreActiveTabKeyRef.current
    if (!targetKey) return
    restoreActiveTabKeyRef.current = ''
    void activateExistingTabKey(targetKey, { recordHistory: false })
  }, [activateExistingTabKey, repoReady, tabsInitReady])

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
    if (didMigrateId && payload.snapshotForNewId) {
      const oldKey = noteTabKey(originalId)
      const newKey = noteTabKey(meta.id)
      noteInitSnapshotsRef.current[meta.id] = payload.snapshotForNewId
      delete draftNoteMetaRef.current[originalId]
      delete noteSessionHandlesRef.current[originalId]
      delete noteInitSnapshotsRef.current[originalId]
      if (noteScrollTopByIdRef.current[originalId] != null) {
        noteScrollTopByIdRef.current[meta.id] = noteScrollTopByIdRef.current[originalId]
        delete noteScrollTopByIdRef.current[originalId]
      }
      updateSidebarItems(prev => renameTabKeyInSidebar(prev, oldKey, newKey))
      setCloseTabPrompt(p => (p?.noteId === originalId ? { noteId: meta.id } : p))

      const nextActive = String(activeTabKeyRef.current || '').trim() === oldKey ? newKey : String(activeTabKeyRef.current || '').trim()
      updateSidebarItems(prev => renameTabKeyInSidebar(prev, oldKey, newKey), { activeTabKey: nextActive })
      if (String(activeTabKeyRef.current || '').trim() === oldKey) setActiveTabKey(newKey)

      // 草稿转正：把收藏夹里指向草稿的引用迁移到真实 id，避免留下失效引用。
      const currentDoc = favoritesDocRef.current
      if (currentDoc) {
        const retargeted = retargetNoteRefs(currentDoc, originalId, meta.id)
        if (retargeted !== currentDoc) handleFavoritesDocChange(retargeted)
      }
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

    setOpenNoteTabs(prev => {
      const replaced = prev.map(t => (t.id === originalId ? meta : t))
      const seen = new Set<string>()
      const next: NoteMeta[] = []
      for (const t of replaced) {
        if (!t?.id) continue
        if (seen.has(t.id)) continue
        seen.add(t.id)
        next.push(t)
      }
      return next
    })

    if (activeNoteId === originalId) setActiveNoteId(meta.id)
  }, [activeNoteId, bumpRefRelationsEpoch, refreshNoteCardInfo, updateSidebarItems])

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

  const closeModalOverlay = React.useCallback(() => setOpenModalPage(null), [])

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
  }), [allNotesLayout, gateway, handleOpenAssetTab, handleOpenNote, quickSearchOpen, toggleAllNotesLayout])

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

          <Dialog open={visible && !!assetEntityDeleteTarget} onClose={closeAssetEntityDeleteDialog} maxWidth="xs" fullWidth>
            <DialogTitle>移入回收站</DialogTitle>
            <DialogContent>
              <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.72)' }}>
                确定将附件「{assetEntityDeleteTarget ? assetRefKey(assetEntityDeleteTarget) : '未命名附件'}」移入回收站吗？现有页面中的相关卡片会变成失效引用卡片。
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={closeAssetEntityDeleteDialog} disabled={assetEntityDeleting}>取消</Button>
              <Button variant="contained" color="error" onClick={() => void confirmDeleteAssetEntity()} disabled={assetEntityDeleting}>
                {assetEntityDeleting ? '处理中...' : '移入回收站'}
              </Button>
            </DialogActions>
          </Dialog>

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

function WorkspaceInitGate(props: { error: string | null; retrying: boolean; onRetry: () => void }) {
  const { error, retrying, onRetry } = props
  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5, p: 3 }}>
      {error ? (
        <>
          <Typography sx={{ fontSize: 15, fontWeight: 900, color: 'var(--hc-text)' }}>仓库加载失败</Typography>
          <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'var(--hc-text-muted)', textAlign: 'center', maxWidth: 480 }}>
            {error}
          </Typography>
          <Button variant="contained" onClick={onRetry} disabled={retrying} sx={{ borderRadius: 2, textTransform: 'none' }}>
            {retrying ? '重试中…' : '重试'}
          </Button>
        </>
      ) : (
        <>
          <CircularProgress size={22} />
          <Typography sx={{ fontSize: 13, color: 'var(--hc-text-muted)' }}>正在加载仓库…</Typography>
        </>
      )}
    </Box>
  )
}
