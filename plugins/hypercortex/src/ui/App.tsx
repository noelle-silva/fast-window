import * as React from 'react'
import { AppBar, Box, Button, CssBaseline, Dialog, DialogActions, DialogContent, DialogTitle, GlobalStyles, IconButton, InputBase, ThemeProvider, Toolbar, Tooltip, Typography, createTheme } from '@mui/material'
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
import {
  ensureMetadata,
  getApi,
  kindFromMime,
  mimeFromExt,
  saveMetadata,
  tryLoadMetadata,
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
import { AssetPoolPanel } from './AssetPoolPanel'
import { OpenTabsPanel } from './OpenTabsPanel'
import { NoteDetailSession, type NoteDetailSessionHandle, type NoteDetailSnapshotV1 } from './NoteDetailSession'
import { AssetDetailSession } from './AssetDetailSession'
import { ErrorBoundary } from './ErrorBoundary'
import { ShortcutSettingsPanel } from './ShortcutSettingsPanel'
import { QuickSearchPopover } from './QuickSearchPopover'
import { createTabGroupId, pickNextTabGroupColor, pickNextTabGroupTitle } from './tabGroups'
import { createWorkspaceId, normalizeActiveWorkspaceId, normalizeWorkspaces, pickNextWorkspaceTitle, updateWorkspaceById } from './workspaces'
import { applyActiveWorkspacePatch, buildWorkspacesMetadataSnapshot, normalizeOpenTabKeys } from './workspaceModel'
import { DEFAULT_SHORTCUT_BINDINGS, isEditableTarget, mainKeyFromChord, normalizeMainKey, normalizeShortcutBindings, shouldTriggerShortcut, type HyperCortexShortcutBindingsV1 } from '../shortcuts'
import type { AssetEntry } from '../assetTypes'
import { assetTabId } from '../assetTypes'
import { assetRefKeyFromTabKey, noteIdFromTabKey, noteTabKey, parseAssetRefKey, tabKind, type TabKey } from '../tabKey'

type PageId = 'home' | 'attachments' | 'all-notes' | 'note-detail' | 'asset-detail' | 'index' | 'settings'

type AllNotesLayout = 'list' | 'grid' | 'icon'
type TabsMode = 'manual' | 'hover'

function normalizeAllNotesLayout(value: unknown): AllNotesLayout {
  return value === 'grid' || value === 'icon' ? value : 'list'
}

function normalizeBoolean(value: unknown): boolean {
  return value === true
}

function normalizeTabsMode(value: unknown): TabsMode {
  return value === 'hover' ? 'hover' : 'manual'
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
  const next: HyperCortexMetadataV1 = { ...meta, version: 1 }

  delete (next as any).openNoteIds
  delete (next as any).activeNoteId
  delete (next as any).tabGroupByNoteId

  if (typeof (next as any).activeTabKey === 'string') {
    const k = String((next as any).activeTabKey || '').trim()
    if (k && tabKind(k) === 'note' && isDraftNoteId(noteIdFromTabKey(k))) (next as any).activeTabKey = ''
  }
  if ('openTabKeys' in next) (next as any).openTabKeys = stripDraftTabKeys((next as any).openTabKeys)
  if ('tabGroupByTabKey' in next) (next as any).tabGroupByTabKey = stripDraftTabKeyMap((next as any).tabGroupByTabKey)
  if ('shortcuts' in next) (next as any).shortcuts = normalizeShortcutBindings((next as any).shortcuts)

  if (Array.isArray(next.workspaces)) {
    next.workspaces = next.workspaces.map(ws => {
      const openTabKeys = stripDraftTabKeys((ws as any).openTabKeys)
      const tabGroupByTabKey = stripDraftTabKeyMap((ws as any).tabGroupByTabKey)
      let activeTabKey = String((ws as any).activeTabKey || '').trim()
      if (activeTabKey && tabKind(activeTabKey) === 'note' && isDraftNoteId(noteIdFromTabKey(activeTabKey))) activeTabKey = ''
      const id = String((ws as any).id || '').trim() || createWorkspaceId()
      const title = String((ws as any).title || '').trim() || '工作区'
      return {
        id,
        title,
        tabGroups: Array.isArray((ws as any).tabGroups) ? ((ws as any).tabGroups as any) : [],
        openTabKeys,
        tabGroupByTabKey,
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

export function HyperCortexApp() {
  const api = React.useMemo(() => getApi(), [])

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

  // ---- 全部笔记列表
  const [noteIndex, setNoteIndex] = React.useState<HyperCortexIndexV1 | null>(null)
  const [allNotesLayout, setAllNotesLayout] = React.useState<AllNotesLayout>('list')
  const [allNotes, setAllNotes] = React.useState<NoteMeta[]>([])
  const [allNotesLoading, setAllNotesLoading] = React.useState(false)
  const [allNotesLoadError, setAllNotesLoadError] = React.useState<string | null>(null)

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
  const [tabGrouping, setTabGrouping] = React.useState<{ groups: HyperCortexTabGroupV1[]; byTabKey: Record<string, string> }>({
    groups: [],
    byTabKey: {},
  })

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

  const persistMetadataPatch = React.useCallback(
    async (patch: Partial<HyperCortexMetadataV1>) => {
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

  const commitActiveWorkspacePatch = React.useCallback(
    (patch: Partial<Pick<HyperCortexWorkspaceV1, 'title' | 'openTabKeys' | 'activeTabKey' | 'tabGroups' | 'tabGroupByTabKey'>>) => {
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
      const nextOpenTabKeys = normalizeOpenTabKeys(ws.openTabKeys)
      setTabGrouping({ groups: ws.tabGroups, byTabKey: ws.tabGroupByTabKey || {} })
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
    updateTabGrouping(prev => {
      const nextGroup: HyperCortexTabGroupV1 = {
        id: createTabGroupId(),
        title: pickNextTabGroupTitle(prev.groups),
        color: pickNextTabGroupColor(prev.groups),
        collapsed: false,
      }
      return { ...prev, groups: [...prev.groups, nextGroup] }
    })
  }, [updateTabGrouping])

  const handleCollapseAllGroups = React.useCallback(() => {
    updateTabGrouping(prev => {
      if (!prev.groups.length) return prev
      if (prev.groups.every(g => g.collapsed === true)) return prev
      return { ...prev, groups: prev.groups.map(g => (g.collapsed === true ? g : { ...g, collapsed: true })) }
    })
  }, [updateTabGrouping])

  const handleAssignTabToGroup = React.useCallback(
    (tabKey: string, groupId: string) => {
      const nid = String(tabKey || '').trim()
      const gid = String(groupId || '').trim()
      if (!nid || !gid) return
      updateTabGrouping(prev => {
        if (!prev.groups.some(g => g.id === gid)) return prev
        return { ...prev, byTabKey: { ...prev.byTabKey, [nid]: gid } }
      })
    },
    [updateTabGrouping],
  )

  const handleUnassignTabFromGroup = React.useCallback(
    (tabKey: string) => {
      const nid = String(tabKey || '').trim()
      if (!nid) return
      updateTabGrouping(prev => {
        if (!prev.byTabKey[nid]) return prev
        const nextByTabKey = { ...prev.byTabKey }
        delete nextByTabKey[nid]
        return { ...prev, byTabKey: nextByTabKey }
      })
    },
    [updateTabGrouping],
  )

  const handleReorderOpenTabs = React.useCallback(
    (nextOpenTabKeys: string[]) => {
      const ids = Array.isArray(nextOpenTabKeys) ? nextOpenTabKeys : []
      setOpenTabKeys(prev => {
        if (prev.length <= 1) return prev
        const existed = new Set(prev)
        const seen = new Set<string>()
        const next: string[] = []

        for (const raw of ids) {
          const key = typeof raw === 'string' ? raw.trim() : ''
          if (!key || seen.has(key)) continue
          if (!existed.has(key)) continue
          seen.add(key)
          next.push(key)
        }

        for (const key of prev) {
          if (seen.has(key)) continue
          seen.add(key)
          next.push(key)
        }

        if (next.length === prev.length && next.every((k, i) => k === prev[i])) return prev
        commitActiveWorkspacePatch({ openTabKeys: next })
        return next
      })
    },
    [commitActiveWorkspacePatch],
  )

  const handleReorderTabGroups = React.useCallback(
    (nextGroupIds: string[]) => {
      const ids = Array.isArray(nextGroupIds) ? nextGroupIds : []
      updateTabGrouping(prev => {
        if (prev.groups.length <= 1) return prev
        const byId: Record<string, HyperCortexTabGroupV1> = {}
        for (const g of prev.groups) byId[g.id] = g
        const seen = new Set<string>()
        const nextGroups: HyperCortexTabGroupV1[] = []

        for (const raw of ids) {
          const id = typeof raw === 'string' ? raw.trim() : ''
          if (!id || seen.has(id)) continue
          const g = byId[id]
          if (!g) continue
          seen.add(id)
          nextGroups.push(g)
        }
        for (const g of prev.groups) {
          if (seen.has(g.id)) continue
          seen.add(g.id)
          nextGroups.push(g)
        }

        if (nextGroups.length === prev.groups.length && nextGroups.every((g, i) => g.id === prev.groups[i]?.id)) return prev
        return { ...prev, groups: nextGroups }
      })
    },
    [updateTabGrouping],
  )

  const handleToggleGroupCollapsed = React.useCallback(
    (groupId: string) => {
      const gid = String(groupId || '').trim()
      if (!gid) return
      updateTabGrouping(prev => {
        const nextGroups = prev.groups.map(g => (g.id === gid ? { ...g, collapsed: !g.collapsed } : g))
        return { ...prev, groups: nextGroups }
      })
    },
    [updateTabGrouping],
  )

  const handleRenameGroup = React.useCallback(
    (groupId: string, title: string) => {
      const gid = String(groupId || '').trim()
      const nextTitle = String(title || '').trim()
      if (!gid || !nextTitle) return
      updateTabGrouping(prev => {
        const nextGroups = prev.groups.map(g => (g.id === gid ? { ...g, title: nextTitle } : g))
        return { ...prev, groups: nextGroups }
      })
    },
    [updateTabGrouping],
  )

  const handleSetGroupColor = React.useCallback(
    (groupId: string, color: string) => {
      const gid = String(groupId || '').trim()
      const nextColor = String(color || '').trim()
      if (!gid || !nextColor) return
      updateTabGrouping(prev => {
        const nextGroups = prev.groups.map(g => (g.id === gid ? { ...g, color: nextColor } : g))
        return { ...prev, groups: nextGroups }
      })
    },
    [updateTabGrouping],
  )

  const handleDeleteGroupOnly = React.useCallback(
    (groupId: string) => {
      const gid = String(groupId || '').trim()
      if (!gid) return
      updateTabGrouping(prev => {
        const nextGroups = prev.groups.filter(g => g.id !== gid)
        const nextByTabKey: Record<string, string> = {}
        for (const [tabKey, mapped] of Object.entries(prev.byTabKey)) {
          if (mapped === gid) continue
          nextByTabKey[tabKey] = mapped
        }
        return { groups: nextGroups, byTabKey: nextByTabKey }
      })
    },
    [updateTabGrouping],
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
        setAllNotesLayout(normalizeAllNotesLayout(meta.allNotesLayout))
        setTabsCollapsed(normalizeBoolean(meta.tabsCollapsed))
        setTabsMode(normalizeTabsMode(meta.tabsMode))
        const activeKey = typeof meta.activeTabKey === 'string' ? meta.activeTabKey.trim() : ''
        restoreActiveTabKeyRef.current = activeKey

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
            const nextOpenKeys = [...openKeys, activeKey]
            nextWorkspaces = updateWorkspaceById(nextWorkspaces, nextActiveWorkspaceId, ws => ({ ...ws, openTabKeys: nextOpenKeys, activeTabKey: activeKey }))
            activeWs = { ...activeWs, openTabKeys: nextOpenKeys, activeTabKey: activeKey }
            didMutateActiveWorkspace = true
          }
        }

        activeWorkspaceIdRef.current = nextActiveWorkspaceId
        setWorkspaces(nextWorkspaces)
        setActiveWorkspaceId(nextActiveWorkspaceId)
        if (activeWs) applyWorkspaceSidebarState(activeWs)

        const shouldPersistNormalized = !Array.isArray(meta.workspaces) || meta.activeWorkspaceId !== nextActiveWorkspaceId || didMutateActiveWorkspace
        if (shouldPersistNormalized) void persistMetadataPatch(buildWorkspacesMetadataSnapshot(nextWorkspaces, nextActiveWorkspaceId)).catch(() => {})
      } catch {
      } finally {
        setTabsInitReady(true)
        setMetaReady(true)
      }
    })()
  }, [api])

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
    setOpenTabKeys(prev => {
      const next = [...prev, draftKey]
      commitActiveWorkspacePatch({ openTabKeys: next, activeTabKey: draftKey })
      return next
    })
    navigatePage('note-detail')
  }, [commitActiveWorkspacePatch, navigatePage])

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (shortcutRecordingRef.current) return

      // 禁用 Tab 的默认“焦点切换/选中游走”，但不影响编辑器/输入框内的 Tab（例如缩进）。
      if (e.key === 'Tab' && !isEditableTarget(e.target)) {
        e.preventDefault()
        e.stopPropagation()
        return
      }

      const bindings = shortcutBindingsRef.current
      if (!bindings) return

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
      if (tabsMode !== 'hover') return
      if (!sidebarShortcutHoldRef.current) return
      const bindings = shortcutBindingsRef.current
      if (!bindings) return
      if (!bindings.toggleSidebar) return
      if (!isKeyUpForChordMainKey(e, bindings.toggleSidebar)) return

      sidebarShortcutHoldRef.current = false
      if (!sidebarHoverRef.current) setTabsHoverOpen(false)
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
    }
  }, [goBackPage, handleCreateDraftNote, tabsMode, toggleTabsCollapsed])

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
      setOpenTabKeys(prev => {
        const next = prev.includes(nextKey) ? prev : [...prev, nextKey]
        commitActiveWorkspacePatch({ openTabKeys: next, activeTabKey: nextKey })
        return next
      })
      navigatePage('note-detail')
    },
    [commitActiveWorkspacePatch, navigatePage, pushNavHistory],
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
      setOpenTabKeys(prev => {
        const next = prev.includes(tabKey) ? prev : [...prev, tabKey]
        commitActiveWorkspacePatch({ openTabKeys: next, activeTabKey: tabKey })
        return next
      })
      navigatePage('asset-detail')
    },
    [commitActiveWorkspacePatch, navigatePage, pushNavHistory],
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

      setOpenTabKeys(nextKeys as any)
      commitActiveWorkspacePatch({ openTabKeys: nextKeys, activeTabKey: nextActive })

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
    [activateExistingTabKey, commitActiveWorkspacePatch, metaReady, navigatePage, persistMetadataPatch],
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
      const keysToClose = (openTabKeysRef.current || []).filter(k => tabGrouping.byTabKey[k] === gid)
      handleDeleteGroupOnly(gid)
      if (keysToClose.length) closeTabKeysDirect(keysToClose)
    },
    [closeTabKeysDirect, handleDeleteGroupOnly, tabGrouping.byTabKey],
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
      updateTabGrouping(prev => {
        const gid = prev.byTabKey[oldKey]
        if (!gid) return prev
        const byTabKey = { ...prev.byTabKey }
        byTabKey[newKey] = gid
        delete byTabKey[oldKey]
        return { ...prev, byTabKey }
      })
      setCloseTabPrompt(p => (p?.noteId === originalId ? { noteId: meta.id } : p))

      setOpenTabKeys(prev => {
        const next = prev.map(k => (k === oldKey ? newKey : k))
        const deduped: string[] = []
        for (const k of next) {
          const s = String(k || '').trim()
          if (!s) continue
          if (deduped.includes(s)) continue
          deduped.push(s)
        }
        const nextActive = String(activeTabKeyRef.current || '').trim() === oldKey ? newKey : String(activeTabKeyRef.current || '').trim()
        commitActiveWorkspacePatch({ openTabKeys: deduped, activeTabKey: nextActive })
        if (String(activeTabKeyRef.current || '').trim() === oldKey) setActiveTabKey(newKey)
        return deduped as any
      })
    }

    setNoteIndex(prev => {
      const current = prev || { version: 1, notes: {} }
      const nextNotes = { ...(current.notes || {}) }
      if (didMigrateId) delete nextNotes[originalId]
      nextNotes[meta.id] = meta
      return { ...current, notes: nextNotes }
    })

    setAllNotes(prev => sortNotesByUpdatedAtDesc([meta, ...prev.filter(item => item.id !== originalId)]))

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
  }, [activeNoteId, commitActiveWorkspacePatch, updateTabGrouping])

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
                onReorderOpenTabs={handleReorderOpenTabs}
                onReorderTabGroups={handleReorderTabGroups}
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
                        <Box
                          key={note.id}
                          onClick={() => void handleOpenNote(note)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              void handleOpenNote(note)
                            }
                          }}
                          sx={{
                            position: 'relative',
                            minHeight: 144,
                            px: 1.5,
                            py: 1.5,
                            borderRadius: 3,
                            bgcolor: '#fff',
                            display: 'flex',
                            alignItems: 'flex-start',
                            justifyContent: 'flex-start',
                            boxShadow: '0 1px 2px rgba(0,0,0,.04)',
                            cursor: 'pointer',
                            transition: 'background-color .16s ease, box-shadow .16s ease, transform .16s ease',
                            '&:hover': {
                              bgcolor: 'rgba(0,0,0,.02)',
                              boxShadow: '0 6px 16px rgba(0,0,0,.08)',
                              transform: 'translateY(-1px)',
                            },
                            '&:hover .hc-copy-ref-btn': { opacity: 1 },
                          }}
                        >
                          <Box
                            component="button"
                            className="hc-copy-ref-btn"
                            onClick={(e: React.MouseEvent) => {
                              e.stopPropagation()
                              void api.clipboard.writeText(buildNotePlaceholderForCopy(note.id, note.title))
                              void api.ui.showToast('已复制引用占位符')
                            }}
                            sx={{
                              position: 'absolute', top: 6, right: 6,
                              opacity: 0, transition: 'opacity .15s',
                              border: 'none', background: 'rgba(0,0,0,.05)', borderRadius: 1.5,
                              width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
                              cursor: 'pointer', fontSize: 13, color: 'rgba(0,0,0,.45)',
                              '&:hover': { background: 'rgba(0,0,0,.1)' },
                            }}
                            title="复制引用占位符"
                          >
                            🔗
                          </Box>
                          <Typography
                            sx={{
                              fontSize: 14,
                              lineHeight: 1.5,
                              fontWeight: 600,
                              color: '#111',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {note.title}
                          </Typography>
                        </Box>
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
                        <Box
                          key={note.id}
                          onClick={() => void handleOpenNote(note)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              void handleOpenNote(note)
                            }
                          }}
                          sx={{
                            position: 'relative',
                            minHeight: 84,
                            px: 1.25,
                            py: 1.25,
                            borderRadius: 3,
                            bgcolor: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            textAlign: 'center',
                            boxShadow: '0 1px 2px rgba(0,0,0,.04)',
                            cursor: 'pointer',
                            transition: 'background-color .16s ease, box-shadow .16s ease, transform .16s ease',
                            '&:hover': {
                              bgcolor: 'rgba(0,0,0,.02)',
                              boxShadow: '0 6px 16px rgba(0,0,0,.08)',
                              transform: 'translateY(-1px)',
                            },
                            '&:hover .hc-copy-ref-btn': { opacity: 1 },
                          }}
                        >
                          <Box
                            component="button"
                            className="hc-copy-ref-btn"
                            onClick={(e: React.MouseEvent) => {
                              e.stopPropagation()
                              void api.clipboard.writeText(buildNotePlaceholderForCopy(note.id, note.title))
                              void api.ui.showToast('已复制引用占位符')
                            }}
                            sx={{
                              position: 'absolute', top: 4, right: 4,
                              opacity: 0, transition: 'opacity .15s',
                              border: 'none', background: 'rgba(0,0,0,.05)', borderRadius: 1.5,
                              width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                              cursor: 'pointer', fontSize: 11, color: 'rgba(0,0,0,.45)',
                              '&:hover': { background: 'rgba(0,0,0,.1)' },
                            }}
                            title="复制引用占位符"
                          >
                            🔗
                          </Box>
                          <Typography
                            sx={{
                              fontSize: 13,
                              lineHeight: 1.45,
                              fontWeight: 600,
                              color: '#111',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {note.title}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  ) : null}

                  {!allNotesLoading && !allNotesLoadError && allNotes.length > 0 && allNotesLayout === 'list' ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                      {allNotes.map(note => (
                        <Box
                          key={note.id}
                          onClick={() => void handleOpenNote(note)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              void handleOpenNote(note)
                            }
                          }}
                          sx={{
                            position: 'relative',
                            px: 1.5,
                            py: 1.15,
                            borderRadius: 3,
                            bgcolor: '#fff',
                            boxShadow: '0 1px 2px rgba(0,0,0,.04)',
                            cursor: 'pointer',
                            transition: 'background-color .16s ease, box-shadow .16s ease, transform .16s ease',
                            '&:hover': {
                              bgcolor: 'rgba(0,0,0,.02)',
                              boxShadow: '0 6px 16px rgba(0,0,0,.08)',
                              transform: 'translateY(-1px)',
                            },
                            '&:hover .hc-copy-ref-btn': { opacity: 1 },
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Box
                              component="button"
                              className="hc-copy-ref-btn"
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation()
                                void api.clipboard.writeText(buildNotePlaceholderForCopy(note.id, note.title))
                                void api.ui.showToast('已复制引用占位符')
                              }}
                              sx={{
                                opacity: 0, transition: 'opacity .15s',
                                border: 'none', background: 'rgba(0,0,0,.05)', borderRadius: 1.5,
                                width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                cursor: 'pointer', fontSize: 13, color: 'rgba(0,0,0,.45)', flexShrink: 0,
                                '&:hover': { background: 'rgba(0,0,0,.1)' },
                              }}
                              title="复制引用占位符"
                            >
                              🔗
                            </Box>
                          <Typography
                            sx={{
                              fontSize: 14,
                              lineHeight: 1.5,
                              fontWeight: 600,
                              color: '#111',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {note.title}
                          </Typography>
                          </Box>
                        </Box>
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
              {page === 'index' ? <Typography color="text.secondary">这是索引页面。</Typography> : null}
              {page === 'settings' ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 760 }}>
                  <ShortcutSettingsPanel
                    bindings={shortcutBindings}
                    onChange={handleShortcutBindingsChange}
                    onRecordingChange={handleShortcutRecordingChange}
                  />
                </Box>
              ) : null}
            </Box>
          </Box>
        </Box>
        </Box>
      </ErrorBoundary>

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
