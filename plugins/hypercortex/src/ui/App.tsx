import * as React from 'react'
import { AppBar, Box, Button, ClickAwayListener, CssBaseline, Dialog, DialogActions, DialogContent, DialogTitle, Divider, GlobalStyles, IconButton, InputBase, Menu, MenuItem, Paper, Popper, Switch, ThemeProvider, Toolbar, Tooltip, Typography, createTheme } from '@mui/material'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import HomeRoundedIcon from '@mui/icons-material/HomeRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded'
import NotesRoundedIcon from '@mui/icons-material/NotesRounded'
import AccountTreeRoundedIcon from '@mui/icons-material/AccountTreeRounded'
import ViewListRoundedIcon from '@mui/icons-material/ViewListRounded'
import ViewModuleRoundedIcon from '@mui/icons-material/ViewModuleRounded'
import AppsRoundedIcon from '@mui/icons-material/AppsRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import HelpOutlineRoundedIcon from '@mui/icons-material/HelpOutlineRounded'
import {
  ensureMetadata,
  getApi,
  kindFromMime,
  mimeFromExt,
  saveMetadata,
  tryLoadMetadata,
  type HyperCortexHtmlFaceDisplayModeV1,
  type HyperCortexIndexV1,
  type HyperCortexMetadataV1,
  type HyperCortexTabGroupV1,
  type HyperCortexWorkspaceV1,
  type NoteMeta,
} from '../core'
import { loadNoteIndex } from '../notePackage'
import { loadRefIndex, type NoteRefIndex } from '../noteRefs'
import { createMarkdownRenderEngine } from '../render/engine'
import { buildNotePlaceholderForCopy } from '../notePlaceholder'
import { ensureAssetsIndex } from '../assetStore'
import { isDraftNoteId } from '../drafts'
import { ensureFavorites, saveFavorites, type HyperCortexFavoritesDocV1 } from '../favorites'
import { AssetPoolPanel } from './AssetPoolPanel'
import { IndexPage } from './IndexPage'
import { OpenTabsPanel } from './OpenTabsPanel'
import { NoteDetailSession, type NoteDetailSessionHandle, type NoteDetailSnapshotV1 } from './NoteDetailSession'
import { AssetDetailSession } from './AssetDetailSession'
import { ErrorBoundary } from './ErrorBoundary'
import { ShortcutSettingsPanel } from './ShortcutSettingsPanel'
import { TrashSettingsPanel } from './TrashSettingsPanel'
import { HtmlFaceDisplaySettingsPanel } from './HtmlFaceDisplaySettingsPanel'
import { TrashPanel } from './TrashPanel'
import { QuickSearchPopover } from './QuickSearchPopover'
import { createTabGroupId, pickNextTabGroupColor, pickNextTabGroupTitle } from './tabGroups'
import { createWorkspaceId, normalizeActiveWorkspaceId, normalizeWorkspaces, pickNextWorkspaceTitle, updateWorkspaceById } from './workspaces'
import { applyActiveWorkspacePatch, buildWorkspacesMetadataSnapshot, normalizeOpenTabKeys } from './workspaceModel'
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
import { DEFAULT_SHORTCUT_BINDINGS, formatChordForDisplay, isEditableTarget, mainKeyFromChord, normalizeMainKey, normalizeShortcutBindings, shouldTriggerShortcut, type HyperCortexShortcutBindingsV1, type HyperCortexShortcutId } from '../shortcuts'
import { AllNotesGridNoteCard, AllNotesIconNoteCard, AllNotesListNoteRow } from './AllNotesNoteCard'
import type { NoteCardInfo } from './noteCardInfo'
import { loadNoteCardInfo, startPrefetchNoteCardInfo } from './noteCardInfoLoader'
import type { AssetEntry } from '../assetTypes'
import { assetTabId } from '../assetTypes'
import { assetRefKeyFromTabKey, noteIdFromTabKey, noteTabKey, parseAssetRefKey, tabKind, type TabKey } from '../tabKey'
import { maybeAutoCleanupTrash, moveNoteToTrash, permanentlyDeleteNoteDir } from '../trash'

type PageId = 'home' | 'attachments' | 'all-notes' | 'note-detail' | 'asset-detail' | 'index' | 'settings' | 'trash'

type AllNotesLayout = 'list' | 'grid' | 'icon'
type TabsMode = 'manual' | 'hover'

function normalizeAllNotesLayout(value: unknown): AllNotesLayout {
  return value === 'grid' || value === 'icon' ? value : 'list'
}

function normalizeBoolean(value: unknown): boolean {
  return value === true
}

function normalizeIndexEditMode(value: unknown): boolean {
  return value === true
}

function normalizeTabsMode(value: unknown): TabsMode {
  return value === 'hover' ? 'hover' : 'manual'
}

function normalizeTrashEnabled(value: unknown): boolean {
  return value === false ? false : true
}

function normalizeShortcutHintsEnabled(value: unknown): boolean {
  return value === true
}

function normalizeHtmlFaceDisplayMode(value: unknown): HyperCortexHtmlFaceDisplayModeV1 {
  if (value === 'fit-window' || value === 'fixed-fit') return value
  return 'natural'
}

function normalizeTrashAutoDeleteDays(value: unknown): number {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n)) return 30
  if (n < 0) return 0
  if (n > 3650) return 3650
  return n
}

export const HTML_FACE_FIXED_SCALE_DEFAULT = 0.95
const HTML_FACE_FIXED_SCALE_MIN = 0.25
const HTML_FACE_FIXED_SCALE_MAX = 2

function normalizeHtmlFaceFixedScaleDefault(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return HTML_FACE_FIXED_SCALE_DEFAULT
  if (n < HTML_FACE_FIXED_SCALE_MIN) return HTML_FACE_FIXED_SCALE_MIN
  if (n > HTML_FACE_FIXED_SCALE_MAX) return HTML_FACE_FIXED_SCALE_MAX
  return n
}

function sortNotesByUpdatedAtDesc(list: NoteMeta[]): NoteMeta[] {
  return (Array.isArray(list) ? list : []).slice().sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0))
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

function sanitizeMetadataForSave(meta: HyperCortexMetadataV1): HyperCortexMetadataV1 {
  type NextMeta = HyperCortexMetadataV1 & { indexEditMode?: boolean; currentFolderId?: string }
  const next: NextMeta = { ...meta, version: 1 }

  delete (next as any).openNoteIds
  delete (next as any).activeNoteId
  delete (next as any).tabGroupByNoteId

  if (typeof (next as any).activeTabKey === 'string') {
    const k = String((next as any).activeTabKey || '').trim()
    if (k && tabKind(k) === 'note' && isDraftNoteId(noteIdFromTabKey(k))) (next as any).activeTabKey = ''
  }
  if (Array.isArray((next as any).sidebarItems)) {
    ;(next as any).sidebarItems = ensureSidebarItems({
      sidebarItems: (next as any).sidebarItems,
      openTabKeys: stripDraftTabKeys((next as any).openTabKeys),
      tabGroups: Array.isArray((next as any).tabGroups) ? (next as any).tabGroups : [],
      tabGroupByTabKey: stripDraftTabKeyMap((next as any).tabGroupByTabKey),
    })
  }
  if ('openTabKeys' in next) (next as any).openTabKeys = stripDraftTabKeys((next as any).openTabKeys)
  if ('tabGroupByTabKey' in next) (next as any).tabGroupByTabKey = stripDraftTabKeyMap((next as any).tabGroupByTabKey)
  if ('shortcuts' in next) (next as any).shortcuts = normalizeShortcutBindings((next as any).shortcuts)
  next.shortcutHintsEnabled = normalizeShortcutHintsEnabled((next as any).shortcutHintsEnabled)
  next.trashEnabled = normalizeTrashEnabled(next.trashEnabled)
  next.trashAutoDeleteDays = normalizeTrashAutoDeleteDays(next.trashAutoDeleteDays)
  next.indexEditMode = normalizeIndexEditMode((next as any).indexEditMode)
  next.currentFolderId = String((next as any).currentFolderId || '').trim() || 'root'

  if (Array.isArray(next.workspaces)) {
    next.workspaces = next.workspaces.map(ws => {
      const openTabKeys = stripDraftTabKeys((ws as any).openTabKeys)
      const tabGroupByTabKey = stripDraftTabKeyMap((ws as any).tabGroupByTabKey)
      const sidebarItems = ensureSidebarItems({
        sidebarItems: (ws as any).sidebarItems,
        openTabKeys,
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

const theme = createTheme({
  palette: {
    mode: 'light',
    background: { default: '#ffffff', paper: '#ffffff' },
  },
  typography: {
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
  },
})

function isInteractiveTarget(target: EventTarget | null): boolean {
  const t = target as any
  if (!t || typeof t.closest !== 'function') return false
  return !!t.closest('button, a, input, textarea, select, [role="button"]')
}

  function isKeyUpForChordMainKey(e: KeyboardEvent, chord: string): boolean {
    const main = mainKeyFromChord(chord)
    if (!main) return false
    return normalizeMainKey(e.key) === main
  }

function NavIconButton(props: {
  title: string
  ariaLabel: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
  tooltipPlacement?: 'bottom' | 'bottom-start' | 'bottom-end' | 'left' | 'right' | 'top'
}) {
  const { title, ariaLabel, active, onClick, children, tooltipPlacement = 'bottom' } = props
  return (
    <Tooltip title={title} placement={tooltipPlacement}>
      <IconButton
        size="small"
        aria-label={ariaLabel}
        onClick={onClick}
        data-tauri-drag-region="false"
        sx={{
          WebkitAppRegion: 'no-drag',
          borderRadius: 2,
          bgcolor: active ? 'rgba(25,118,210,.10)' : 'transparent',
          '&:hover': { bgcolor: active ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
        }}
      >
        {children}
      </IconButton>
    </Tooltip>
  )
}

const SHORTCUT_HINT_ITEMS: { id: HyperCortexShortcutId; title: string }[] = [
  { id: 'goBackPage', title: '返回上一个页面' },
  { id: 'closeActiveTab', title: '关闭当前标签页' },
  { id: 'selectPrevTab', title: '切换到上一个标签页（向上）' },
  { id: 'selectNextTab', title: '切换到下一个标签页（向下）' },
  { id: 'newNote', title: '新建笔记' },
  { id: 'saveNote', title: '保存笔记' },
  { id: 'toggleQuickSearch', title: '快速搜索（显示/隐藏）' },
  { id: 'toggleMode', title: '切换阅读/编辑' },
  { id: 'cycleFace', title: '切换笔记面（文本/HTML）' },
  { id: 'toggleSidebar', title: '侧边栏展开/收起' },
]

function getShortcutChord(bindings: HyperCortexShortcutBindingsV1, id: HyperCortexShortcutId): string {
  const next = bindings || DEFAULT_SHORTCUT_BINDINGS
  switch (id) {
    case 'goBackPage':
      return next.goBackPage
    case 'closeActiveTab':
      return next.closeActiveTab
    case 'selectPrevTab':
      return next.selectPrevTab
    case 'selectNextTab':
      return next.selectNextTab
    case 'newNote':
      return next.newNote
    case 'saveNote':
      return next.saveNote
    case 'toggleQuickSearch':
      return next.toggleQuickSearch
    case 'toggleMode':
      return next.toggleMode
    case 'cycleFace':
      return next.cycleFace
    case 'toggleSidebar':
      return next.toggleSidebar
    default:
      return ''
  }
}

export function HyperCortexApp() {
  const api = React.useMemo(() => getApi(), [])
  type MetadataPatch = Partial<HyperCortexMetadataV1> & { indexEditMode?: boolean; currentFolderId?: string }

  // ---- 核心 UI 状态
  const [page, setPageState] = React.useState<PageId>('home')
  const pageRef = React.useRef<PageId>('home')
  React.useEffect(() => {
    pageRef.current = page
  }, [page])
  type NavHistoryEntry = { kind: 'page'; page: PageId } | { kind: 'tab'; tabKey: string }
  const navHistoryRef = React.useRef<NavHistoryEntry[]>([])

  // ---- 顶部栏：快速搜索
  const [quickSearchOpen, setQuickSearchOpen] = React.useState(false)
  const quickSearchAnchorRef = React.useRef<HTMLButtonElement | null>(null)

  const pushNavHistory = React.useCallback((entry: NavHistoryEntry) => {
    const stack = navHistoryRef.current
    const last = stack.length ? stack[stack.length - 1] : null
    if (last?.kind === entry.kind) {
      if (entry.kind === 'page' && last.kind === 'page' && last.page === entry.page) return
      if (entry.kind === 'tab' && last.kind === 'tab' && last.tabKey === entry.tabKey) return
    }
    stack.push(entry)
    if (stack.length > 128) stack.splice(0, stack.length - 128)
  }, [])

  const navigatePage = React.useCallback((next: PageId, opts?: { recordHistory?: boolean }) => {
    setPageState(prev => {
      if (prev !== next && opts?.recordHistory !== false) pushNavHistory({ kind: 'page', page: prev })
      return next
    })
  }, [pushNavHistory])

  // ---- 元数据（持久化）
  const metaRef = React.useRef<HyperCortexMetadataV1 | null>(null)
  const [metaReady, setMetaReady] = React.useState(false)
  const restoreActiveTabKeyRef = React.useRef<string>('')

  // ---- 快捷键（持久化在 metadata）
  const [shortcutBindings, setShortcutBindings] = React.useState<HyperCortexShortcutBindingsV1>(DEFAULT_SHORTCUT_BINDINGS)
  const shortcutBindingsRef = React.useRef<HyperCortexShortcutBindingsV1>(DEFAULT_SHORTCUT_BINDINGS)
  const shortcutRecordingRef = React.useRef(false)
  const handleShortcutRecordingChange = React.useCallback((active: boolean) => {
    shortcutRecordingRef.current = active
  }, [])
  React.useEffect(() => {
    shortcutBindingsRef.current = shortcutBindings
  }, [shortcutBindings])

  // ---- 回收站设置（持久化在 metadata）
  const [trashEnabled, setTrashEnabled] = React.useState(true)
  const [trashAutoDeleteDays, setTrashAutoDeleteDays] = React.useState(30)
  const [htmlFaceDisplayMode, setHtmlFaceDisplayMode] = React.useState<HyperCortexHtmlFaceDisplayModeV1>('natural')
  const [htmlFaceFixedScaleDefault, setHtmlFaceFixedScaleDefault] = React.useState(HTML_FACE_FIXED_SCALE_DEFAULT)
  const trashAutoDeleteDaysRef = React.useRef(30)
  React.useEffect(() => {
    trashAutoDeleteDaysRef.current = trashAutoDeleteDays
  }, [trashAutoDeleteDays])

  const [shortcutHintsEnabled, setShortcutHintsEnabled] = React.useState(false)
  const [shortcutHintsOpen, setShortcutHintsOpen] = React.useState(false)
  const shortcutHintsAnchorRef = React.useRef<HTMLButtonElement | null>(null)

  // ---- 全部笔记列表
  const [noteIndex, setNoteIndex] = React.useState<HyperCortexIndexV1 | null>(null)
  const [favoritesDoc, setFavoritesDoc] = React.useState<HyperCortexFavoritesDocV1 | null>(null)
  const [currentFolderId, setCurrentFolderId] = React.useState<string>('root')
  const [indexEditMode, setIndexEditMode] = React.useState(false)
  const [assetPoolIndex, setAssetPoolIndex] = React.useState<Record<string, any> | null>(null)
  const [allNotesLayout, setAllNotesLayout] = React.useState<AllNotesLayout>('list')
  const [allNotes, setAllNotes] = React.useState<NoteMeta[]>([])
  const [allNotesLoading, setAllNotesLoading] = React.useState(false)
  const [allNotesLoadError, setAllNotesLoadError] = React.useState<string | null>(null)

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

  const [openAssetTabs, setOpenAssetTabs] = React.useState<AssetEntry[]>([])

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
  }, [activeNoteId, page])

  React.useLayoutEffect(() => {
    const el = mainScrollElRef.current
    if (!el) return
    if (page !== 'note-detail') return
    const nid = String(activeNoteId || '').trim()
    if (!nid) return
    const saved = noteScrollTopByIdRef.current[nid]
    const next = typeof saved === 'number' && Number.isFinite(saved) && saved > 0 ? saved : 0
    el.scrollTop = next
  }, [activeNoteId, page])

  const noteSessionHandlesRef = React.useRef<Record<string, NoteDetailSessionHandle | null>>({})
  const noteInitSnapshotsRef = React.useRef<Record<string, NoteDetailSnapshotV1>>({})
  const draftNoteMetaRef = React.useRef<Record<string, NoteMeta>>({})
  const [closeTabPrompt, setCloseTabPrompt] = React.useState<{ noteId: string } | null>(null)
  const requestCloseTabRef = React.useRef<(noteId: string) => void>(() => {})
  const closeTabKeysDirectRef = React.useRef<(tabKeys: string[]) => void>(() => {})
  const activateExistingTabKeyRef = React.useRef<(tabKey: string, opts?: { recordHistory?: boolean }) => boolean>(() => false)

  // ---- 侧边栏 / 工作区 / 分组
  const [tabsCollapsed, setTabsCollapsed] = React.useState(false)
  const [workspaces, setWorkspaces] = React.useState<HyperCortexWorkspaceV1[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = React.useState<string>('')
  const [openNoteTabs, setOpenNoteTabs] = React.useState<NoteMeta[]>([])
  const [tabsInitReady, setTabsInitReady] = React.useState(false)
  const [tabsMode, setTabsMode] = React.useState<TabsMode>('manual')
  const [tabsHoverOpen, setTabsHoverOpen] = React.useState(false)
  const sidebarHoverRef = React.useRef(false)
  const sidebarShortcutHoldRef = React.useRef(false)
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

  const metaReadyRef = React.useRef(false)
  const activeWorkspaceIdRef = React.useRef('')
  const workspaceSwitchSeqRef = React.useRef(0)
  React.useEffect(() => {
    metaReadyRef.current = metaReady
  }, [metaReady])
  React.useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId
  }, [activeWorkspaceId])

  const renderEngineRef = React.useRef(createMarkdownRenderEngine({ api, scope: 'library' }))
  ;(window as any).__hcRenderEngine = renderEngineRef.current

  const noteIndexMap = React.useMemo(() => {
    const map: Record<string, { title: string }> = {}
    const list = noteIndex ? Object.values(noteIndex.notes || {}) : allNotes
    for (const n of list) map[n.id] = { title: n.title }
    return map
  }, [allNotes, noteIndex])

  React.useEffect(() => {
    renderEngineRef.current.noteIndex = noteIndexMap
  }, [noteIndexMap])

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
      delete noteSessionRefCallbacksRef.current[nid]
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

  // ---- 引用索引（反向链接）
  const [refIndex, setRefIndex] = React.useState<NoteRefIndex>({})
  const allNotesById = React.useMemo(() => {
    const map: Record<string, NoteMeta> = {}
    const list = noteIndex ? Object.values(noteIndex.notes || {}) : allNotes
    for (const n of list) map[n.id] = n
    return map
  }, [allNotes, noteIndex])

  const notesForQuickSearch = React.useMemo(() => {
    const list = noteIndex ? Object.values(noteIndex.notes || {}) : allNotes
    return sortNotesByUpdatedAtDesc(list)
  }, [allNotes, noteIndex])

  const noteIndexRef = React.useRef<HyperCortexIndexV1 | null>(null)
  React.useEffect(() => {
    noteIndexRef.current = noteIndex
  }, [noteIndex])

  const noteIndexLoadPromiseRef = React.useRef<Promise<HyperCortexIndexV1> | null>(null)
  const ensureNoteIndexLoaded = React.useCallback(async () => {
    if (noteIndexRef.current) return noteIndexRef.current
    if (!noteIndexLoadPromiseRef.current) noteIndexLoadPromiseRef.current = loadNoteIndex(api, 'library')
    const idx = await noteIndexLoadPromiseRef.current
    setNoteIndex(idx)
    return idx
  }, [api])

  const refIndexRef = React.useRef<NoteRefIndex>({})
  React.useEffect(() => {
    refIndexRef.current = refIndex
  }, [refIndex])

  const refIndexLoadPromiseRef = React.useRef<Promise<NoteRefIndex> | null>(null)
  const ensureRefIndexLoaded = React.useCallback(async () => {
    if (refIndexRef.current && Object.keys(refIndexRef.current).length) return refIndexRef.current
    if (!refIndexLoadPromiseRef.current) refIndexLoadPromiseRef.current = loadRefIndex(api, 'library')
    const idx = await refIndexLoadPromiseRef.current
    setRefIndex(idx)
    return idx
  }, [api])

  React.useEffect(() => {
    void ensureNoteIndexLoaded().catch(() => {})
    void ensureRefIndexLoaded().catch(() => {})
  }, [ensureNoteIndexLoaded, ensureRefIndexLoaded])

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
        existed.hasTextFace === nextInfo.hasTextFace &&
        existed.hasHtmlFace === nextInfo.hasHtmlFace &&
        existed.tags.join('\n') === nextInfo.tags.join('\n')
      ) return prev
      return { ...prev, [nid]: nextInfo }
    })
  }, [])

  const refreshNoteCardInfo = React.useCallback(
    async (meta: NoteMeta) => {
      const nid = String(meta?.id || '').trim()
      if (!nid) return
      const info = await loadNoteCardInfo(api, 'library', meta).catch(() => null)
      if (!info) return
      upsertNoteCardInfo(nid, info)
    },
    [api, upsertNoteCardInfo],
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
    if (page !== 'all-notes') return
    const ctl = startPrefetchNoteCardInfo({
      notes: allNotes,
      getInfoById: id => noteCardInfoByIdRef.current[id],
      refresh: ensureNoteCardInfoLoaded,
      maxWorkers: 6,
    })
    return () => ctl.cancel()
  }, [allNotes, ensureNoteCardInfoLoaded, page])

  const persistMetadataPatch = React.useCallback(
    async (patch: MetadataPatch) => {
      const current = metaRef.current || { version: 1 }
      const next: HyperCortexMetadataV1 = { ...current, ...patch, version: 1 }
      const sanitized = sanitizeMetadataForSave(next)
      metaRef.current = sanitized
      await saveMetadata(api, sanitized)
    },
    [api],
  )

  const handleShortcutBindingsChange = React.useCallback(
    (next: HyperCortexShortcutBindingsV1) => {
      const normalized = normalizeShortcutBindings(next)
      setShortcutBindings(normalized)
      if (!metaReadyRef.current) return
      void persistMetadataPatch({ shortcuts: normalized }).catch(() => {})
    },
    [persistMetadataPatch],
  )

  const handleShortcutHintsEnabledChange = React.useCallback(
    (enabled: boolean) => {
      const next = enabled === true
      setShortcutHintsEnabled(next)
      if (!next) setShortcutHintsOpen(false)
      if (!metaReadyRef.current) return
      void persistMetadataPatch({ shortcutHintsEnabled: next }).catch(() => {})
    },
    [persistMetadataPatch],
  )

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

        if (metaReadyRef.current) {
          void persistMetadataPatch(buildWorkspacesMetadataSnapshot(nextList, wid)).catch(() => {})
        }

        return nextList
      })
    },
    [persistMetadataPatch],
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

  const updateTabGrouping = React.useCallback(
    (updater: (prev: { groups: HyperCortexTabGroupV1[]; byTabKey: Record<string, string> }) => { groups: HyperCortexTabGroupV1[]; byTabKey: Record<string, string> }) => {
      setTabGrouping(prev => {
        const next = updater(prev)
        commitActiveWorkspacePatch({ tabGroups: next.groups, tabGroupByTabKey: next.byTabKey })
        return next
      })
    },
    [commitActiveWorkspacePatch],
  )

  const isHoverTabsMode = tabsMode === 'hover'
  const sidebarRailWidth = isHoverTabsMode ? 52 : tabsCollapsed ? 52 : 220
  const sidebarPanelExpanded = isHoverTabsMode ? tabsHoverOpen : !tabsCollapsed
  const sidebarPanelWidth = isHoverTabsMode ? (tabsHoverOpen ? 220 : 52) : sidebarRailWidth

  const onSidebarMouseEnter = React.useCallback(() => {
    sidebarHoverRef.current = true
    if (isHoverTabsMode) setTabsHoverOpen(true)
  }, [isHoverTabsMode])

  const onSidebarMouseLeave = React.useCallback(() => {
    sidebarHoverRef.current = false
    if (!isHoverTabsMode) return
    if (sidebarShortcutHoldRef.current) return
    setTabsHoverOpen(false)
  }, [isHoverTabsMode])

  const backToHost = React.useCallback(() => {
    try {
      if (typeof api.ui?.back === 'function') return void api.ui.back()
      if (typeof api.host?.back === 'function') return void api.host.back()
      return void api.ui?.showToast?.('无法返回')
    } catch (e: any) {
      api.ui?.showToast?.(String(e?.message || e))
    }
  }, [api])

  const goBackPage = React.useCallback(async () => {
    const stack = navHistoryRef.current
    while (stack.length) {
      const entry = stack.pop()
      if (!entry) continue

      if (entry.kind === 'tab') {
        const key = String(entry.tabKey || '').trim()
        if (!key) continue
        if (!openTabKeysRef.current.includes(key)) continue
        const currentKey = String(activeTabKeyRef.current || '').trim()
        if (key === currentKey && (pageRef.current === 'note-detail' || pageRef.current === 'asset-detail')) continue

        setActiveTabKey(key as any)
        commitActiveWorkspacePatch({ activeTabKey: key })

        const kind = tabKind(key)
        if (kind === 'note') {
          const noteId = noteIdFromTabKey(key)
          if (!noteId) continue
          setActiveNoteId(noteId)
          navigatePage('note-detail', { recordHistory: false })
          return
        }
        if (kind === 'asset') {
          setActiveNoteId('')
          navigatePage('asset-detail', { recordHistory: false })
          return
        }
        continue
      }

      const target = entry.page
      if (!target || target === pageRef.current) continue
      if (target === 'note-detail') {
        const keys = openTabKeysRef.current || []
        const noteKeys = keys.filter(k => tabKind(k) === 'note')
        if (!noteKeys.length) continue
        const currentActive = String(activeTabKeyRef.current || '').trim()
        const activeValid = !!currentActive && tabKind(currentActive) === 'note' && noteKeys.includes(currentActive)
        const nextKey = activeValid ? currentActive : noteKeys[0]
        const noteId = noteIdFromTabKey(nextKey)
        if (!noteId) continue
        setActiveTabKey(nextKey as any)
        setActiveNoteId(noteId)
        commitActiveWorkspacePatch({ activeTabKey: nextKey })
        navigatePage('note-detail', { recordHistory: false })
        return
      }

      if (target === 'asset-detail') {
        const keys = openTabKeysRef.current || []
        const assetKeys = keys.filter(k => tabKind(k) === 'asset')
        if (!assetKeys.length) continue
        const currentActive = String(activeTabKeyRef.current || '').trim()
        const activeValid = !!currentActive && tabKind(currentActive) === 'asset' && assetKeys.includes(currentActive)
        const nextKey = activeValid ? currentActive : assetKeys[0]
        setActiveTabKey(nextKey as any)
        setActiveNoteId('')
        commitActiveWorkspacePatch({ activeTabKey: nextKey })
        navigatePage('asset-detail', { recordHistory: false })
        return
      }

      navigatePage(target, { recordHistory: false })
      return
    }
    await api.ui.showToast('没有上一页了')
  }, [api, commitActiveWorkspacePatch, navigatePage])

  const onTopbarPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      if (isInteractiveTarget(e.target)) return
      api.ui?.startDragging?.()
    },
    [api],
  )

  const toggleAllNotesLayout = React.useCallback(() => {
    setAllNotesLayout(prev => {
      const next = prev === 'list' ? 'grid' : prev === 'grid' ? 'icon' : 'list'
      if (metaReady) void persistMetadataPatch({ allNotesLayout: next }).catch(() => {})
      return next
    })
  }, [metaReady, persistMetadataPatch])

  const toggleTabsCollapsed = React.useCallback(() => {
    setTabsCollapsed(prev => {
      const next = !prev
      if (metaReady) void persistMetadataPatch({ tabsCollapsed: next }).catch(() => {})
      return next
    })
  }, [metaReady, persistMetadataPatch])

  const toggleTabsMode = React.useCallback(() => {
    setTabsMode(prev => {
      const next: TabsMode = prev === 'manual' ? 'hover' : 'manual'
      setTabsHoverOpen(false)
      if (metaReady) void persistMetadataPatch({ tabsMode: next }).catch(() => {})
      return next
    })
  }, [metaReady, persistMetadataPatch])

  const persistWorkspacesSnapshot = React.useCallback(
    (nextWorkspaces: HyperCortexWorkspaceV1[], nextActiveWorkspaceId: string) => {
      if (!metaReadyRef.current) return
      void persistMetadataPatch(buildWorkspacesMetadataSnapshot(nextWorkspaces, nextActiveWorkspaceId)).catch(() => {})
    },
    [persistMetadataPatch],
  )

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

            const idx = await loadNoteIndex(api, 'library')
            const noteTabs = noteKeys
              .map(k => {
                const noteId = noteIdFromTabKey(k)
                if (!noteId) return null
                return (idx.notes?.[noteId] as NoteMeta | undefined) || draftNoteMetaRef.current[noteId] || null
              })
              .filter(Boolean) as NoteMeta[]

            const aidx = await ensureAssetsIndex(api, 'library').catch(() => ({ version: 1, assets: {} } as any))
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

      if (page === 'note-detail' || page === 'asset-detail') {
        if (preferredActiveKey && nextOpenTabKeys.includes(preferredActiveKey)) {
          const targetPage = tabKind(preferredActiveKey) === 'asset' ? 'asset-detail' : 'note-detail'
          if (page !== targetPage) navigatePage(targetPage, { recordHistory: false })
        } else {
          navigatePage(page === 'note-detail' ? 'home' : 'attachments', { recordHistory: false })
        }
      }
    },
    [api, navigatePage, page],
  )

  const handleSwitchWorkspace = React.useCallback(
    (workspaceId: string) => {
      const wid = String(workspaceId || '').trim()
      if (!wid || wid === activeWorkspaceIdRef.current) return
      const ws = workspaces.find(w => w.id === wid)
      if (!ws) return

      activeWorkspaceIdRef.current = wid
      setActiveWorkspaceId(wid)
      applyWorkspaceSidebarState(ws)
      if (metaReadyRef.current) {
        void persistMetadataPatch(buildWorkspacesMetadataSnapshot(workspaces, wid)).catch(() => {})
      }
    },
    [applyWorkspaceSidebarState, persistMetadataPatch, workspaces],
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

      activeWorkspaceIdRef.current = nextWs.id
      setWorkspaces(nextWorkspaces)
      setActiveWorkspaceId(nextWs.id)
      applyWorkspaceSidebarState(nextWs)
      persistWorkspacesSnapshot(nextWorkspaces, nextWs.id)
      void api.ui.showToast(`已新建工作区：${nextTitle}`)
    },
    [api.ui, applyWorkspaceSidebarState, persistWorkspacesSnapshot, workspaces],
  )

  const handleRenameWorkspace = React.useCallback(
    (workspaceId: string, title: string) => {
      const wid = String(workspaceId || '').trim()
      const nextTitle = String(title || '').trim()
      if (!wid || !nextTitle) return
      const nextWorkspaces = updateWorkspaceById(workspaces, wid, ws => ({ ...ws, title: nextTitle }))
      if (nextWorkspaces === workspaces) return
      setWorkspaces(nextWorkspaces)
      persistWorkspacesSnapshot(nextWorkspaces, activeWorkspaceIdRef.current)
    },
    [persistWorkspacesSnapshot, workspaces],
  )

  const handleDeleteWorkspace = React.useCallback(
    (workspaceId: string) => {
      const wid = String(workspaceId || '').trim()
      if (!wid) return
      if (workspaces.length <= 1) return void api.ui.showToast('至少保留一个工作区')
      const target = workspaces.find(w => w.id === wid)
      if (!target) return

      const nextWorkspaces = workspaces.filter(w => w.id !== wid)
      const deletingActive = activeWorkspaceIdRef.current === wid
      const nextActiveId = deletingActive ? nextWorkspaces[0]?.id || '' : activeWorkspaceIdRef.current
      const nextActiveWs = nextWorkspaces.find(w => w.id === nextActiveId) || nextWorkspaces[0]
      if (!nextActiveWs) return

      activeWorkspaceIdRef.current = nextActiveId
      setWorkspaces(nextWorkspaces)
      setActiveWorkspaceId(nextActiveId)
      if (deletingActive) applyWorkspaceSidebarState(nextActiveWs)
      persistWorkspacesSnapshot(nextWorkspaces, nextActiveId)
      void api.ui.showToast(`已删除工作区：${target.title}`)
    },
    [api.ui, applyWorkspaceSidebarState, persistWorkspacesSnapshot, workspaces],
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

  const loadAllNotes = React.useCallback(async () => {
    setAllNotesLoading(true)
    setAllNotesLoadError(null)
    try {
      const idx = await ensureNoteIndexLoaded()
      const notes = sortNotesByUpdatedAtDesc(Object.values(idx.notes || {}))
      setAllNotes(notes)
    } catch (e: any) {
      setAllNotesLoadError(String(e?.message || e || '加载全部笔记失败'))
    } finally {
      setAllNotesLoading(false)
    }
  }, [api, ensureNoteIndexLoaded])

  React.useEffect(() => {
    void (async () => {
      try {
        const meta = (await tryLoadMetadata(api)) || (await ensureMetadata(api))
        metaRef.current = meta
        setShortcutBindings(normalizeShortcutBindings(meta.shortcuts))
        const normalizedShortcutHintsEnabled = normalizeShortcutHintsEnabled((meta as any).shortcutHintsEnabled)
        setShortcutHintsEnabled(normalizedShortcutHintsEnabled)
        setAllNotesLayout(normalizeAllNotesLayout(meta.allNotesLayout))
        setTabsCollapsed(normalizeBoolean(meta.tabsCollapsed))
        setTabsMode(normalizeTabsMode(meta.tabsMode))
        const normalizedTrashEnabled = normalizeTrashEnabled(meta.trashEnabled)
        const normalizedTrashAutoDeleteDays = normalizeTrashAutoDeleteDays(meta.trashAutoDeleteDays)
        setTrashEnabled(normalizedTrashEnabled)
        setTrashAutoDeleteDays(normalizedTrashAutoDeleteDays)
        setHtmlFaceDisplayMode(normalizeHtmlFaceDisplayMode(meta.htmlFaceDisplayMode))
        setHtmlFaceFixedScaleDefault(normalizeHtmlFaceFixedScaleDefault(meta.htmlFaceFixedScaleDefault))
        setIndexEditMode(normalizeIndexEditMode((meta as any).indexEditMode))
        setCurrentFolderId(String((meta as any).currentFolderId || '').trim() || 'root')
        const activeKey = typeof meta.activeTabKey === 'string' ? meta.activeTabKey.trim() : ''
        restoreActiveTabKeyRef.current = activeKey

        const [nextFavoritesDoc, nextAssetPoolIndex] = await Promise.all([
          ensureFavorites(api),
          ensureAssetsIndex(api, 'library'),
        ])
        setFavoritesDoc(nextFavoritesDoc)
        setAssetPoolIndex(nextAssetPoolIndex as any)

        const legacyTabsDetected =
          Array.isArray((meta as any).openNoteIds) ||
          typeof (meta as any).activeNoteId === 'string' ||
          ((meta as any).tabGroupByNoteId && typeof (meta as any).tabGroupByNoteId === 'object')
        const v2TabsDetected =
          Array.isArray((meta as any).openTabKeys) ||
          typeof (meta as any).activeTabKey === 'string' ||
          ((meta as any).tabGroupByTabKey && typeof (meta as any).tabGroupByTabKey === 'object') ||
          Array.isArray(meta.workspaces)
        if (legacyTabsDetected && !v2TabsDetected) {
          void api.ui.showToast('检测到旧版标签页数据：当前开发版本已移除迁移逻辑，请重置 HyperCortex 数据后再试')
        }

        let nextWorkspaces = normalizeWorkspaces(meta.workspaces, {
          sidebarItems: meta.sidebarItems,
          openTabKeys: meta.openTabKeys,
          activeTabKey: meta.activeTabKey,
          tabGroups: meta.tabGroups,
          tabGroupByTabKey: meta.tabGroupByTabKey,
        })
        const nextActiveWorkspaceId = normalizeActiveWorkspaceId(meta.activeWorkspaceId, nextWorkspaces)
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

        const shouldPersistNormalized =
          !Array.isArray(meta.workspaces) ||
          meta.activeWorkspaceId !== nextActiveWorkspaceId ||
          didMutateActiveWorkspace ||
          (meta as any).shortcutHintsEnabled !== normalizedShortcutHintsEnabled ||
          meta.trashEnabled !== normalizedTrashEnabled ||
          meta.trashAutoDeleteDays !== normalizedTrashAutoDeleteDays
        if (shouldPersistNormalized) {
          void persistMetadataPatch({
            ...buildWorkspacesMetadataSnapshot(nextWorkspaces, nextActiveWorkspaceId),
            shortcutHintsEnabled: normalizedShortcutHintsEnabled,
            trashEnabled: normalizedTrashEnabled,
            trashAutoDeleteDays: normalizedTrashAutoDeleteDays,
          }).catch(() => {})
        }
      } catch {
      } finally {
        setTabsInitReady(true)
        setMetaReady(true)
      }
    })()
  }, [api])

  const autoCleanupRanForDaysRef = React.useRef<number | null>(null)
  React.useEffect(() => {
    if (!metaReady) return
    const days = trashAutoDeleteDaysRef.current
    if (!(days > 0)) return
    if (autoCleanupRanForDaysRef.current === days) return
    autoCleanupRanForDaysRef.current = days
    void (async () => {
      const result = await maybeAutoCleanupTrash(api, 'library', days).catch(() => null)
      if (!result || !(result.deletedCount > 0)) return
      void api.ui.showToast(`回收站已自动清理 ${result.deletedCount} 项`)
    })()
  }, [api, metaReady, trashAutoDeleteDays])

  const handleTrashEnabledChange = React.useCallback(
    (enabled: boolean) => {
      const next = enabled === true
      setTrashEnabled(next)
      if (!metaReadyRef.current) return
      void persistMetadataPatch({ trashEnabled: next }).catch(() => {})
    },
    [persistMetadataPatch],
  )

  const handleTrashAutoDeleteDaysChange = React.useCallback(
    (days: number) => {
      const next = normalizeTrashAutoDeleteDays(days)
      setTrashAutoDeleteDays(next)
      if (!metaReadyRef.current) return
      void persistMetadataPatch({ trashAutoDeleteDays: next }).catch(() => {})
    },
    [persistMetadataPatch],
  )

  const handleHtmlFaceDisplayModeChange = React.useCallback(
    (mode: HyperCortexHtmlFaceDisplayModeV1) => {
      const next = normalizeHtmlFaceDisplayMode(mode)
      setHtmlFaceDisplayMode(next)
      if (!metaReadyRef.current) return
      void persistMetadataPatch({ htmlFaceDisplayMode: next }).catch(() => {})
    },
    [persistMetadataPatch],
  )

  const handleIndexEditModeChange = React.useCallback(
    (next: boolean) => {
      setIndexEditMode(next)
      if (!metaReadyRef.current) return
      void persistMetadataPatch({ indexEditMode: next ?? false }).catch(() => {})
    },
    [persistMetadataPatch],
  )

  const handleNavigateFolder = React.useCallback(
    (folderId: string) => {
      setCurrentFolderId(folderId)
      if (metaReadyRef.current) void persistMetadataPatch({ currentFolderId: folderId }).catch(() => {})
    },
    [persistMetadataPatch],
  )

  const handleFavoritesDocChange = React.useCallback(
    (nextDoc: HyperCortexFavoritesDocV1) => {
      setFavoritesDoc(nextDoc)
      void saveFavorites(api, nextDoc).catch(() => {})
    },
    [api],
  )

  const handleHtmlFaceFixedScaleDefaultChange = React.useCallback(
    (scale: number) => {
      const next = normalizeHtmlFaceFixedScaleDefault(scale)
      setHtmlFaceFixedScaleDefault(next)
      if (!metaReadyRef.current) return
      void persistMetadataPatch({ htmlFaceFixedScaleDefault: next }).catch(() => {})
    },
    [persistMetadataPatch],
  )

  const handleOpenTrashPage = React.useCallback(() => navigatePage('trash'), [navigatePage])

  const handleDeleteNote = React.useCallback(
    async (payload: { note: NoteMeta; mode: 'trash' | 'permanent' }) => {
      const note = payload.note
      const nid = String(note?.id || '').trim()
      if (!nid) return

      if (isDraftNoteId(nid) || !String(note?.dir || '').trim()) {
        closeTabKeysDirectRef.current([noteTabKey(nid)])
        setAllNotes(prev => prev.filter(n => n.id !== nid))
        setNoteIndex(prev => {
          const current = prev || { version: 1, notes: {} }
          const nextNotes = { ...(current.notes || {}) }
          delete nextNotes[nid]
          return { ...current, notes: nextNotes }
        })
        setRefIndex(prev => {
          const next = { ...(prev || {}) }
          delete next[nid]
          return next
        })
        return
      }

      try {
        if (payload.mode === 'trash') await moveNoteToTrash(api, 'library', note)
        else await permanentlyDeleteNoteDir(api, 'library', nid, note.dir)

        closeTabKeysDirectRef.current([noteTabKey(nid)])
        setAllNotes(prev => prev.filter(n => n.id !== nid))
        setNoteIndex(prev => {
          const current = prev || { version: 1, notes: {} }
          const nextNotes = { ...(current.notes || {}) }
          delete nextNotes[nid]
          return { ...current, notes: nextNotes }
        })
        setRefIndex(prev => {
          const next = { ...(prev || {}) }
          delete next[nid]
          return next
        })
      } catch (e: any) {
        void api.ui.showToast(String(e?.message || e || '删除失败'))
      }
    },
    [api],
  )

  const confirmDeleteNoteFromCard = React.useCallback(async () => {
    const target = noteCardDeleteTarget
    if (!target) return
    setNoteCardDeleteTarget(null)
    closeNoteCardMenu()
    const mode: 'trash' | 'permanent' = trashEnabled ? 'trash' : 'permanent'
    await handleDeleteNote({ note: target, mode })
  }, [closeNoteCardMenu, handleDeleteNote, noteCardDeleteTarget, trashEnabled])

  const resolveNoteAbsoluteDir = React.useCallback(
    async (note: NoteMeta): Promise<string> => {
      const rawDir = String(note?.dir || '').trim()
      if (!rawDir) throw new Error('笔记目录为空')

      const detectStyle = (p: string): 'windows' | 'posix' | 'unknown' => {
        const s = String(p || '').trim()
        if (/^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('\\\\') || s.startsWith('//')) return 'windows'
        if (s.startsWith('/')) return 'posix'
        return 'unknown'
      }

      const normalizeWindowsAbs = (p: string): string => {
        const s = String(p || '').trim()
        if (!s) return ''
        // 统一用反斜杠，让 explorer 行为更可控；同时支持 //server/share 的 UNC 写法。
        if (s.startsWith('//')) return `\\\\${s.slice(2).replace(/\//g, '\\')}`
        return s.replace(/\//g, '\\')
      }

      const normalizePosixAbs = (p: string): string => {
        const s = String(p || '').trim()
        if (!s) return ''
        return s.replace(/\\/g, '/')
      }

      const joinWindows = (base: string, rel: string): string => {
        const b = normalizeWindowsAbs(base).replace(/[\\\/]+$/g, '')
        const r = String(rel || '').trim().replace(/^[\\\/]+/g, '').replace(/\//g, '\\')
        return `${b}\\${r}`
      }

      const joinPosix = (base: string, rel: string): string => {
        const b = normalizePosixAbs(base).replace(/[\\\/]+$/g, '')
        const r = String(rel || '').trim().replace(/^[\\\/]+/g, '').replace(/\\/g, '/')
        return `${b}/${r}`
      }

      const style = detectStyle(rawDir)
      if (style === 'windows') return normalizeWindowsAbs(rawDir)
      if (style === 'posix') return normalizePosixAbs(rawDir)

      const libDir = String(await api.files.getLibraryDir()).trim()
      const libStyle = detectStyle(libDir)
      if (libStyle === 'windows') return joinWindows(libDir, rawDir)
      if (libStyle === 'posix') return joinPosix(libDir, rawDir)

      throw new Error('库目录不是绝对路径')
    },
    [api],
  )

  const requestCopyTitleFromCardMenu = React.useCallback(async () => {
    const note = noteCardMenu?.note
    if (!note) return
    closeNoteCardMenu()
    const title = String(note.title || '').trim() || '未命名'
    try {
      await api.clipboard.writeText(title)
      void api.ui.showToast('已复制标题')
    } catch (e: any) {
      void api.ui.showToast(String(e?.message || e || '复制失败'))
    }
  }, [api, closeNoteCardMenu, noteCardMenu])

  const requestOpenDirFromCardMenu = React.useCallback(async () => {
    const note = noteCardMenu?.note
    if (!note) return
    closeNoteCardMenu()
    if (isDraftNoteId(note.id) || !String(note.dir || '').trim()) {
      void api.ui.showToast('草稿暂无所在目录（请先保存）')
      return
    }
    try {
      const abs = await resolveNoteAbsoluteDir(note)
      await api.files.openDir(abs)
    } catch (e: any) {
      void api.ui.showToast(String(e?.message || e || '打开目录失败'))
    }
  }, [api, closeNoteCardMenu, noteCardMenu, resolveNoteAbsoluteDir])

  const handleTrashRestored = React.useCallback(
    (meta: NoteMeta) => {
      if (!meta?.id) return
      setNoteIndex(prev => {
        const current = prev || { version: 1, notes: {} }
        const nextNotes = { ...(current.notes || {}) }
        nextNotes[meta.id] = meta
        return { ...current, notes: nextNotes }
      })
      setAllNotes(prev => sortNotesByUpdatedAtDesc([meta, ...prev.filter(n => n.id !== meta.id)]))
      void api.ui.showToast('已恢复笔记')
    },
    [api],
  )

  React.useEffect(() => {
    if (page !== 'all-notes') return
    void loadAllNotes()
  }, [loadAllNotes, page])

  const handleCreateDraftNote = React.useCallback(() => {
    const now = Date.now()
    const draftId = `draft_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const draftKey = noteTabKey(draftId)
    const meta: NoteMeta = {
      id: draftId,
      title: '未命名',
      dir: '',
      createdAtMs: now,
      updatedAtMs: now,
    }
    draftNoteMetaRef.current[draftId] = meta

    noteInitSnapshotsRef.current[draftId] = {
      doc: null,
      htmlFace: null,
      base: { title: '未命名', body: '', tags: [], html: '' },
      editing: true,
      textEditorMode: 'live',
      face: 'text',
      faces: ['text'],
      editTitle: '未命名',
      editBody: '',
      editTags: [],
      editHtml: '',
      infoSidebarVisible: false,
    }

    setOpenNoteTabs(prev => {
      return [...prev, meta]
    })

    setActiveNoteId(draftId)
    setActiveTabKey(draftKey)
    updateSidebarItems(prev => insertTabAsUngrouped(prev, draftKey, prev.length), { activeTabKey: draftKey })
    navigatePage('note-detail')
  }, [navigatePage, updateSidebarItems])

  React.useEffect(() => {
    const clearTabSwitchHold = () => {
      const win = window as any
      if (win.__hcTabSwitchHoldTimer) clearTimeout(win.__hcTabSwitchHoldTimer)
      if (win.__hcTabSwitchHoldInterval) clearInterval(win.__hcTabSwitchHoldInterval)
      win.__hcTabSwitchHoldTimer = null
      win.__hcTabSwitchHoldInterval = null
      win.__hcTabSwitchHoldDir = null
    }

    const getVisibleSidebarTabKeys = (): string[] => {
      // 以侧边栏“当前可见顺序”为准：
      // 1. 未分组 tab：按 openTabKeys 原顺序
      // 2. 分组：按 tabGroups 顺序
      // 3. 分组内 tab：按 openTabKeys 原顺序（该 group 下的 tab）
      // 4. 若分组 collapsed，则跳过该分组的 tab
      // 5. 最后兜底去重
      const all = (openTabKeysRef.current || []).map(s => String(s || '').trim()).filter(Boolean)
      const byTabKey = tabGroupingRef.current.byTabKey || {}
      const groups = Array.isArray(tabGroupingRef.current.groups) ? tabGroupingRef.current.groups : []
      const groupById: Record<string, HyperCortexTabGroupV1> = {}
      for (const g of groups) groupById[String(g?.id || '').trim()] = g

      const out: string[] = []
      const seen = new Set<string>()

      // ungrouped first
      for (const k of all) {
        const gid = String(byTabKey[k] || '').trim()
        if (gid && groupById[gid]) continue
        if (seen.has(k)) continue
        seen.add(k)
        out.push(k)
      }

      // grouped by group order
      for (const g of groups) {
        const gid = String(g?.id || '').trim()
        if (!gid) continue
        if (g.collapsed === true) continue
        for (const k of all) {
          if (String(byTabKey[k] || '').trim() !== gid) continue
          if (seen.has(k)) continue
          seen.add(k)
          out.push(k)
        }
      }

      return out
    }

    const triggerSwitchTab = (direction: -1 | 1): boolean => {
      if (pageRef.current !== 'note-detail' && pageRef.current !== 'asset-detail') {
        clearTabSwitchHold()
        return false
      }
      const keys = getVisibleSidebarTabKeys()
      if (keys.length <= 1) {
        clearTabSwitchHold()
        return false
      }
      const cur = String(activeTabKeyRef.current || '').trim()
      const idx = cur ? keys.indexOf(cur) : -1
      if (idx < 0) {
        // 状态异常：详情页却没有 active tab，直接停止。
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
      activateExistingTabKeyRef.current(nextKey, { recordHistory: false })
      return true
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
      if (getVisibleSidebarTabKeys().length <= 1) return

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

      // 禁用 Tab 的默认“焦点切换/选中游走”，但不影响编辑器/输入框内的 Tab（例如缩进）。
      if (e.key === 'Tab' && !isEditableTarget(e.target)) {
        e.preventDefault()
        e.stopPropagation()
        return
      }

      const bindings = shortcutBindingsRef.current
      if (!bindings) return

      // 长按行为只在对应 mainKey 抬起时停止。
      if (shouldTriggerShortcut(e, bindings.selectPrevTab)) {
        e.preventDefault()
        e.stopPropagation()
        startTabSwitchHoldToRepeat(-1)
        return
      }

      if (shouldTriggerShortcut(e, bindings.selectNextTab)) {
        e.preventDefault()
        e.stopPropagation()
        startTabSwitchHoldToRepeat(1)
        return
      }

      if (shouldTriggerShortcut(e, bindings.toggleSidebar)) {
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

      if (shouldTriggerShortcut(e, bindings.goBackPage)) {
        e.preventDefault()
        e.stopPropagation()
        void goBackPage()
        return
      }

      if (shouldTriggerShortcut(e, bindings.newNote)) {
        e.preventDefault()
        e.stopPropagation()
        handleCreateDraftNote()
        return
      }

      if (shouldTriggerShortcut(e, bindings.toggleQuickSearch)) {
        e.preventDefault()
        e.stopPropagation()
        setShortcutHintsOpen(false)
        setQuickSearchOpen(prev => !prev)
        return
      }

      if (shouldTriggerShortcut(e, bindings.closeActiveTab)) {
        if (pageRef.current !== 'note-detail' && pageRef.current !== 'asset-detail') return
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

      if (pageRef.current !== 'note-detail') return
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

      if (tabsMode !== 'hover') return
      if (!sidebarShortcutHoldRef.current) return
      if (!bindings) return
      if (!bindings.toggleSidebar) return
      if (!isKeyUpForChordMainKey(e, bindings.toggleSidebar)) return

      sidebarShortcutHoldRef.current = false
      if (!sidebarHoverRef.current) setTabsHoverOpen(false)
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', clearTabSwitchHold, true)
    return () => {
      clearTabSwitchHold()
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', clearTabSwitchHold, true)
    }
  }, [goBackPage, handleCreateDraftNote, shortcutHintsOpen, tabsMode, toggleTabsCollapsed])

  const handleOpenNote = React.useCallback(
    (note: NoteMeta) => {
      const nid = String(note?.id || '').trim()
      if (!nid) return
      const nextKey = noteTabKey(nid)
      const prevActiveKey = String(activeTabKeyRef.current || '').trim()
      if ((pageRef.current === 'note-detail' || pageRef.current === 'asset-detail') && prevActiveKey && prevActiveKey !== nextKey) {
        pushNavHistory({ kind: 'tab', tabKey: prevActiveKey })
      }
      setOpenNoteTabs(prev => {
        return prev.some(t => t.id === nid) ? prev : [...prev, note]
      })
      setActiveNoteId(nid)
      setActiveTabKey(nextKey)
      updateSidebarItems(prev => (deriveSidebarFields(prev).openTabKeys.includes(nextKey) ? prev : insertTabAsUngrouped(prev, nextKey, prev.length)), { activeTabKey: nextKey })
      navigatePage('note-detail')
    },
    [navigatePage, pushNavHistory, updateSidebarItems],
  )

  const handleOpenAssetTab = React.useCallback(
    (asset: AssetEntry) => {
      const sanitized: AssetEntry = { ...asset, thumbnailUrl: undefined }
      const tabKey = assetTabId(sanitized) as TabKey
      const prevActiveKey = String(activeTabKeyRef.current || '').trim()
      if ((pageRef.current === 'note-detail' || pageRef.current === 'asset-detail') && prevActiveKey && prevActiveKey !== tabKey) {
        pushNavHistory({ kind: 'tab', tabKey: prevActiveKey })
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
      updateSidebarItems(prev => (deriveSidebarFields(prev).openTabKeys.includes(tabKey) ? prev : insertTabAsUngrouped(prev, tabKey, prev.length)), { activeTabKey: tabKey })
      navigatePage('asset-detail')
    },
    [navigatePage, pushNavHistory, updateSidebarItems],
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
        setActiveTabKey(key)
        setActiveNoteId(nid)
        commitActiveWorkspacePatch({ activeTabKey: key })
        navigatePage('note-detail', opts)
        return true
      }

      if (kind === 'asset') {
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

      if (!nextActive) {
        setActiveNoteId('')
        if (pageRef.current === 'note-detail') navigatePage('home', { recordHistory: false })
        if (pageRef.current === 'asset-detail') navigatePage('attachments', { recordHistory: false })
        if (metaReady) void persistMetadataPatch({ activeTabKey: '' }).catch(() => {})
        return
      }

      activateExistingTabKey(nextActive, { recordHistory: false })
    },
    [activateExistingTabKey, metaReady, navigatePage, persistMetadataPatch, updateSidebarItems],
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
    if (!metaReady || !tabsInitReady) return
    const targetKey = restoreActiveTabKeyRef.current
    if (!targetKey) return
    restoreActiveTabKeyRef.current = ''
    void activateExistingTabKey(targetKey, { recordHistory: false })
  }, [activateExistingTabKey, metaReady, tabsInitReady])

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
    refsForIndex?: string[]
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
    }

    setNoteIndex(prev => {
      const current = prev || { version: 1, notes: {} }
      const nextNotes = { ...(current.notes || {}) }
      if (didMigrateId) delete nextNotes[originalId]
      nextNotes[meta.id] = meta
      return { ...current, notes: nextNotes }
    })

    setAllNotes(prev => sortNotesByUpdatedAtDesc([meta, ...prev.filter(item => item.id !== originalId)]))
    void refreshNoteCardInfo(meta).catch(() => {})

    setRefIndex(prev => {
      const next = { ...(prev || {}) }
      if (didMigrateId) delete next[originalId]

      const refs = Array.isArray(payload.refsForIndex)
        ? Array.from(new Set(payload.refsForIndex.map(v => String(v || '').trim()).filter(Boolean)))
        : []

      if (refs.length) next[meta.id] = refs
      else delete next[meta.id]

      return next
    })

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
  }, [activeNoteId, refreshNoteCardInfo, updateSidebarItems])

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

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles
        styles={{
          html: { height: '100%' },
          body: { height: '100%', margin: 0, backgroundColor: '#fff' },
          '#app': { height: '100%' },
          '*': {
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(0,0,0,.24) transparent',
          },
          '*::-webkit-scrollbar': {
            width: 8,
            height: 8,
          },
          '*::-webkit-scrollbar-track': {
            background: 'transparent',
          },
          '*::-webkit-scrollbar-button': {
            width: 0,
            height: 0,
            display: 'none',
          },
          '*::-webkit-scrollbar-thumb': {
            backgroundColor: 'rgba(0,0,0,.24)',
            borderRadius: 999,
            border: '2px solid transparent',
            backgroundClip: 'content-box',
          },
          '*::-webkit-scrollbar-thumb:hover': {
            backgroundColor: 'rgba(0,0,0,.34)',
          },
          '*::-webkit-scrollbar-corner': {
            background: 'transparent',
          },
        }}
      />

      <ErrorBoundary>
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: '#fff' }}>
          <AppBar position="static" elevation={0} sx={{ bgcolor: '#fff', color: 'text.primary' }}>
            <Toolbar
              variant="dense"
              data-tauri-drag-region="true"
              sx={{
                gap: 0.5,
                minHeight: 40,
                pl: 0,
                pr: 0,
                '&.MuiToolbar-root': { minHeight: 40, paddingLeft: 0, paddingRight: 0 },
                WebkitAppRegion: 'drag',
                justifyContent: 'space-between',
              }}
              onPointerDown={onTopbarPointerDown}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                <IconButton
                  onClick={backToHost}
                  size="small"
                  aria-label="返回主界面"
                  data-tauri-drag-region="false"
                  sx={{ WebkitAppRegion: 'no-drag', ml: 0.25 }}
                >
                <ArrowBackRoundedIcon fontSize="small" />
              </IconButton>

              <Typography variant="subtitle2" sx={{ fontWeight: 900, whiteSpace: 'nowrap' }}>
                HyperCortex
              </Typography>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, ml: 0.25 }}>
                <NavIconButton title="主页" ariaLabel="主页" active={page === 'home'} onClick={() => navigatePage('home')}>
                  <HomeRoundedIcon fontSize="small" />
                </NavIconButton>
                <NavIconButton title="索引" ariaLabel="索引" active={page === 'index'} onClick={() => navigatePage('index')}>
                  <AccountTreeRoundedIcon fontSize="small" />
                </NavIconButton>
                <NavIconButton title="附件" ariaLabel="附件" active={page === 'attachments'} onClick={() => navigatePage('attachments')}>
                  <AttachFileRoundedIcon fontSize="small" />
                </NavIconButton>
                <NavIconButton title="全部笔记" ariaLabel="全部笔记" active={page === 'all-notes'} onClick={() => navigatePage('all-notes')}>
                  <NotesRoundedIcon fontSize="small" />
                </NavIconButton>

                <Tooltip title="搜索" placement="bottom">
                  <IconButton
                    ref={quickSearchAnchorRef}
                    onClick={() => setQuickSearchOpen(v => !v)}
                    size="small"
                    aria-label="搜索"
                    data-tauri-drag-region="false"
                    sx={{
                      WebkitAppRegion: 'no-drag',
                      borderRadius: 2,
                      bgcolor: quickSearchOpen ? 'rgba(25,118,210,.10)' : 'transparent',
                      '&:hover': { bgcolor: quickSearchOpen ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
                    }}
                  >
                    <SearchRoundedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', pr: 1, gap: 0.25 }}>
              {shortcutHintsEnabled ? (
                <Tooltip title={shortcutHintsOpen ? '关闭快捷键提示' : '快捷键提示'} placement="bottom">
                  <IconButton
                    ref={shortcutHintsAnchorRef}
                    size="small"
                    aria-label="快捷键提示"
                    data-tauri-drag-region="false"
                    onClick={() => {
                      setQuickSearchOpen(false)
                      setShortcutHintsOpen(prev => !prev)
                    }}
                    sx={{
                      WebkitAppRegion: 'no-drag',
                      borderRadius: 2,
                      bgcolor: shortcutHintsOpen ? 'rgba(25,118,210,.10)' : 'transparent',
                      '&:hover': { bgcolor: shortcutHintsOpen ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
                    }}
                  >
                    <HelpOutlineRoundedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              ) : null}
              <NavIconButton title="设置" ariaLabel="设置" active={page === 'settings'} onClick={() => navigatePage('settings')}>
                <SettingsRoundedIcon fontSize="small" />
              </NavIconButton>
            </Box>
            </Toolbar>
          </AppBar>

          <QuickSearchPopover
            api={api}
            scope="library"
            open={quickSearchOpen}
            triggerEl={quickSearchAnchorRef.current}
            notes={notesForQuickSearch}
            allNotesLayout={allNotesLayout}
            onToggleAllNotesLayout={toggleAllNotesLayout}
            noteCardInfoById={noteCardInfoById}
            onEnsureNoteCardInfoLoaded={ensureNoteCardInfoLoaded}
            onClose={() => setQuickSearchOpen(false)}
            onOpenNote={note => {
              setQuickSearchOpen(false)
              handleOpenNote(note)
            }}
            onOpenAsset={asset => {
              setQuickSearchOpen(false)
              handleOpenAssetTab(asset)
            }}
          />

          <Popper open={shortcutHintsOpen} anchorEl={shortcutHintsAnchorRef.current} placement="bottom-end" disablePortal={false} sx={{ zIndex: 2000 }}>
            <Box sx={{ pt: 0.75, WebkitAppRegion: 'no-drag' }}>
              <ClickAwayListener
                onClickAway={(e: any) => {
                  const anchor = shortcutHintsAnchorRef.current
                  if (anchor && e?.target && (anchor === e.target || anchor.contains(e.target))) return
                  setShortcutHintsOpen(false)
                }}
              >
                <Paper
                  elevation={10}
                  sx={{
                    width: 360,
                    maxWidth: 'min(440px, calc(100vw - 24px))',
                    borderRadius: 3,
                    overflow: 'hidden',
                    boxShadow: '0 18px 48px rgba(0,0,0,.20)',
                  }}
                >
                  <Box sx={{ px: 1.25, py: 1, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                    <Typography sx={{ fontSize: 12, fontWeight: 900, color: '#111' }}>已设置的快捷键</Typography>
                    <Typography sx={{ fontSize: 11, color: 'rgba(0,0,0,.42)' }}>
                      只展示你已设置的快捷键
                    </Typography>
                  </Box>

                  <Box sx={{ px: 0.75, pb: 0.75, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                    {(() => {
                      const rows = SHORTCUT_HINT_ITEMS.map(item => ({
                        id: item.id,
                        title: item.title,
                        chord: getShortcutChord(shortcutBindings, item.id),
                      })).filter(item => !!String(item.chord || '').trim())

                      if (!rows.length) {
                        return (
                          <Box sx={{ px: 1, py: 1.25 }}>
                            <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.55)', fontWeight: 900 }}>还没有已设置的快捷键</Typography>
                            <Typography sx={{ mt: 0.25, fontSize: 11, color: 'rgba(0,0,0,.42)' }}>
                              去设置页录制后，这里会自动显示
                            </Typography>
                          </Box>
                        )
                      }

                      return rows.map(item => (
                        <Box
                          key={item.id}
                          sx={{
                            display: 'grid',
                            gridTemplateColumns: '1fr auto',
                            alignItems: 'center',
                            gap: 1,
                            px: 1,
                            py: 0.75,
                            borderRadius: 2,
                            bgcolor: 'rgba(0,0,0,.02)',
                          }}
                        >
                          <Typography sx={{ fontSize: 12.5, fontWeight: 900, color: '#111' }} noWrap>
                            {item.title}
                          </Typography>
                          <Typography
                            sx={{
                              fontSize: 12,
                              color: 'rgba(0,0,0,.72)',
                              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                              whiteSpace: 'nowrap',
                            }}
                            title={formatChordForDisplay(item.chord)}
                          >
                            {formatChordForDisplay(item.chord)}
                          </Typography>
                        </Box>
                      ))
                    })()}
                  </Box>
                </Paper>
              </ClickAwayListener>
            </Box>
          </Popper>

        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch', position: 'relative' }}>
          <Box
            onMouseEnter={onSidebarMouseEnter}
            onMouseLeave={onSidebarMouseLeave}
            sx={{
              width: sidebarRailWidth,
              minWidth: sidebarRailWidth,
              minHeight: 0,
              position: 'relative',
              bgcolor: '#fff',
              borderRight: '1px solid rgba(0,0,0,.08)',
            }}
          >
            <Box
              sx={{
                width: sidebarPanelWidth,
                minHeight: 0,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                bgcolor: '#fff',
                borderRight: sidebarPanelWidth > sidebarRailWidth ? '1px solid rgba(0,0,0,.08)' : 'none',
                position: isHoverTabsMode && sidebarPanelExpanded ? 'absolute' : 'relative',
                left: 0,
                top: 0,
                bottom: 0,
                zIndex: isHoverTabsMode && sidebarPanelExpanded ? 20 : 'auto',
                boxShadow: isHoverTabsMode && sidebarPanelExpanded ? '0 10px 30px rgba(0,0,0,.14)' : 'none',
              }}
            >
              <OpenTabsPanel
                panelWidth={sidebarPanelWidth}
                tabsMode={tabsMode}
                tabsCollapsed={tabsCollapsed}
                sidebarItems={sidebarItems}
                openTabKeys={openTabKeys}
                activeTabKey={activeTabKey}
                openNoteTabs={openNoteTabs}
                openAssetTabs={openAssetTabs}
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
                onMoveTabToUngroupedIndex={handleMoveTabToUngroupedIndex}
                onMoveTabToGroupIndex={handleMoveTabToGroupIndex}
                onMoveGroupToIndex={handleMoveGroupToIndex}
              />
            </Box>
          </Box>

          <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: page === 'note-detail' || page === 'asset-detail' ? 'hidden' : 'auto' }}>
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
              {page === 'home' ? <Typography color="text.secondary">这是主页页面。</Typography> : null}
              {page === 'attachments' ? <AssetPoolPanel api={api} scope="library" onOpenAsset={handleOpenAssetTab} /> : null}
              {page === 'all-notes' ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                    <Typography sx={{ fontSize: 24, lineHeight: 1.25, fontWeight: 900, color: '#111' }}>全部笔记</Typography>
                    <Tooltip
                      title={allNotesLayout === 'list' ? '切换到网格' : allNotesLayout === 'grid' ? '切换到紧凑' : '切换到列表'}
                      placement="left"
                    >
                      <IconButton
                        size="small"
                        aria-label={allNotesLayout === 'list' ? '切换到网格' : allNotesLayout === 'grid' ? '切换到紧凑' : '切换到列表'}
                        onClick={toggleAllNotesLayout}
                        sx={{
                          color: 'rgba(0,0,0,.58)',
                          bgcolor: 'transparent',
                          boxShadow: 'none',
                          border: 0,
                          '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
                        }}
                      >
                        {allNotesLayout === 'list' ? (
                          <ViewModuleRoundedIcon fontSize="small" />
                        ) : allNotesLayout === 'grid' ? (
                          <AppsRoundedIcon fontSize="small" />
                        ) : (
                          <ViewListRoundedIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Tooltip>
                  </Box>

                  {allNotesLoading ? <Typography color="text.secondary">正在加载笔记...</Typography> : null}
                  {!allNotesLoading && allNotesLoadError ? <Typography color="error">{allNotesLoadError}</Typography> : null}
                  {!allNotesLoading && !allNotesLoadError && allNotes.length === 0 ? (
                    <Typography color="text.secondary">还没有笔记。</Typography>
                  ) : null}

                  {!allNotesLoading && !allNotesLoadError && allNotes.length > 0 && allNotesLayout === 'grid' ? (
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                        gap: 1,
                      }}
                    >
                      {allNotes.map(note => (
                        <AllNotesGridNoteCard
                          key={note.id}
                          note={note}
                          info={noteCardInfoById[note.id]}
                          onOpen={note => void handleOpenNote(note)}
                          onCopyRef={note => {
                            void api.clipboard.writeText(buildNotePlaceholderForCopy(note.id, note.title))
                            void api.ui.showToast('已复制引用占位符')
                          }}
                          onMore={openNoteCardMenu}
                        />
                      ))}
                    </Box>
                  ) : null}

                  {!allNotesLoading && !allNotesLoadError && allNotes.length > 0 && allNotesLayout === 'icon' ? (
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))',
                        gap: 1,
                      }}
                    >
                      {allNotes.map(note => (
                        <AllNotesIconNoteCard
                          key={note.id}
                          note={note}
                          info={noteCardInfoById[note.id]}
                          onOpen={note => void handleOpenNote(note)}
                          onCopyRef={note => {
                            void api.clipboard.writeText(buildNotePlaceholderForCopy(note.id, note.title))
                            void api.ui.showToast('已复制引用占位符')
                          }}
                          onMore={openNoteCardMenu}
                        />
                      ))}
                    </Box>
                  ) : null}

                  {!allNotesLoading && !allNotesLoadError && allNotes.length > 0 && allNotesLayout === 'list' ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                      {allNotes.map(note => (
                        <AllNotesListNoteRow
                          key={note.id}
                          note={note}
                          info={noteCardInfoById[note.id]}
                          onOpen={note => void handleOpenNote(note)}
                          onCopyRef={note => {
                            void api.clipboard.writeText(buildNotePlaceholderForCopy(note.id, note.title))
                            void api.ui.showToast('已复制引用占位符')
                          }}
                          onMore={openNoteCardMenu}
                        />
                      ))}
                    </Box>
                  ) : null}
                </Box>
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
                      api={api}
                      scope="library"
                      note={tab}
                      visible={page === 'note-detail' && tab.id === activeNoteId}
                      bodyScrollRef={page === 'note-detail' && tab.id === activeNoteId ? mainScrollElRef : undefined}
                      noteIndexMap={noteIndexMap}
                      allNotesById={allNotesById}
                      refIndex={refIndex}
                      consumeInitSnapshot={consumeInitSnapshot}
                      onOpenNote={handleOpenNote}
                      onDirtyChange={handleNoteDirtyChange}
                      onSaved={handleNoteSessionSaved}
                      trashEnabled={trashEnabled}
                      onRequestDeleteNote={handleDeleteNote}
                      htmlFaceDisplayMode={htmlFaceDisplayMode}
                      htmlFaceGlobalDefaultScale={htmlFaceFixedScaleDefault}
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
                      api={api}
                      scope="library"
                      asset={asset}
                      visible={page === 'asset-detail' && assetTabId(asset) === activeTabKey}
                    />
                  ))
                )}
              </Box>
              {page === 'index' && favoritesDoc ? (
                <IndexPage
                  api={api}
                  scope="library"
                  doc={favoritesDoc}
                  currentFolderId={currentFolderId}
                  editMode={indexEditMode}
                  noteIndex={noteIndex?.notes}
                  assetIndex={assetPoolIndex?.assets}
                  onNavigateFolder={handleNavigateFolder}
                  onOpenNote={handleOpenNote}
                  onOpenAsset={handleOpenAssetTab}
                  onDocChange={handleFavoritesDocChange}
                  onEditModeChange={handleIndexEditModeChange}
                />
              ) : null}
              {page === 'trash' ? (
                <TrashPanel
                  api={api}
                  scope="library"
                  onRestored={handleTrashRestored}
                  onPermanentlyDeleted={noteId => {
                    const nid = String(noteId || '').trim()
                    if (!nid) return
                    closeTabKeysDirectRef.current([noteTabKey(nid)])
                    setAllNotes(prev => prev.filter(n => n.id !== nid))
                    setNoteIndex(prev => {
                      const current = prev || { version: 1, notes: {} }
                      const nextNotes = { ...(current.notes || {}) }
                      delete nextNotes[nid]
                      return { ...current, notes: nextNotes }
                    })
                    setRefIndex(prev => {
                      const next = { ...(prev || {}) }
                      delete next[nid]
                      return next
                    })
                  }}
                />
              ) : null}
              {page === 'settings' ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 760 }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                    <Typography sx={{ fontSize: 18, lineHeight: 1.25, fontWeight: 900, color: '#111' }}>快捷键提示</Typography>
                    <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.62)' }}>
                      启用后，顶部栏会出现一个问号按钮，点击即可查看当前已设置的快捷键。
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1, py: 0.75, borderRadius: 2, bgcolor: 'rgba(0,0,0,.02)' }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#111' }}>显示顶部栏问号</Typography>
                      <Switch checked={shortcutHintsEnabled} onChange={(_, checked) => handleShortcutHintsEnabledChange(checked)} />
                    </Box>
                  </Box>

                  <ShortcutSettingsPanel
                    bindings={shortcutBindings}
                    onChange={handleShortcutBindingsChange}
                    onRecordingChange={handleShortcutRecordingChange}
                  />
                  <TrashSettingsPanel
                    enabled={trashEnabled}
                    autoDeleteDays={trashAutoDeleteDays}
                    onEnabledChange={handleTrashEnabledChange}
                    onAutoDeleteDaysChange={handleTrashAutoDeleteDaysChange}
                    onOpenTrash={handleOpenTrashPage}
                  />
                  <HtmlFaceDisplaySettingsPanel
                    mode={htmlFaceDisplayMode}
                    onChange={handleHtmlFaceDisplayModeChange}
                    fixedScaleDefault={htmlFaceFixedScaleDefault}
                    onFixedScaleDefaultChange={handleHtmlFaceFixedScaleDefaultChange}
                  />
                </Box>
              ) : null}
            </Box>
          </Box>
        </Box>
        </Box>
      </ErrorBoundary>

      <Menu
        open={!!noteCardMenu}
        onClose={closeNoteCardMenu}
        anchorEl={noteCardMenu?.anchorEl}
        PaperProps={{ sx: { borderRadius: 7, overflow: 'hidden' } }}
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
        <Divider />
        <MenuItem
          onClick={() => {
            const target = noteCardMenu?.note
            if (!target) return
            setNoteCardDeleteTarget(target)
            closeNoteCardMenu()
          }}
          sx={{ color: '#d32f2f' }}
        >
          删除此笔记…
        </MenuItem>
      </Menu>

      <Dialog open={!!noteCardDeleteTarget} onClose={() => setNoteCardDeleteTarget(null)} maxWidth="xs" fullWidth>
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

      <Dialog open={!!closeTabPrompt} onClose={handleCloseTabPromptCancel} maxWidth="xs" fullWidth>
        <DialogTitle>未保存改动</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.72)' }}>
            笔记「{closeTabPromptTitle}」还有未保存的改动。关闭标签页会丢失这些改动，请先保存或放弃改动。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseTabPromptCancel}>取消</Button>
          <Button variant="outlined" onClick={handleCloseTabPromptGoSave}>去保存</Button>
          <Button variant="contained" color="error" onClick={handleCloseTabPromptDiscardAndClose} disabled={closeTabPromptTargetSaving}>放弃改动并关闭</Button>
        </DialogActions>
      </Dialog>
    </ThemeProvider>
  )
}
