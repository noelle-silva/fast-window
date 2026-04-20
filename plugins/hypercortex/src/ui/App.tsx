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
import {
  ensureMetadata,
  getApi,
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
import { AssetPoolPanel } from './AssetPoolPanel'
import { OpenTabsPanel } from './OpenTabsPanel'
import { NoteDetailSession, type NoteDetailSessionHandle, type NoteDetailSnapshotV1 } from './NoteDetailSession'
import { createTabGroupId, pickNextTabGroupColor, pickNextTabGroupTitle } from './tabGroups'
import { createWorkspaceId, normalizeActiveWorkspaceId, normalizeWorkspaces, pickNextWorkspaceTitle, updateWorkspaceById } from './workspaces'

type PageId = 'home' | 'attachments' | 'all-notes' | 'note-detail' | 'index' | 'settings'

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

function stripDraftIds(ids: unknown): string[] {
  const list = Array.isArray(ids) ? ids : []
  return list
    .map(v => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .filter(id => !isDraftNoteId(id))
}

function stripDraftKeys(value: any): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value)) {
    const key = String(k || '').trim()
    if (!key || isDraftNoteId(key)) continue
    const val = String(v || '').trim()
    if (!val) continue
    out[key] = val
  }
  return out
}

function sanitizeMetadataForSave(meta: HyperCortexMetadataV1): HyperCortexMetadataV1 {
  const next: HyperCortexMetadataV1 = { ...meta, version: 1 }

  if (typeof (next as any).activeNoteId === 'string' && isDraftNoteId((next as any).activeNoteId)) {
    ;(next as any).activeNoteId = ''
  }
  if ('openNoteIds' in next) (next as any).openNoteIds = stripDraftIds((next as any).openNoteIds)
  if ('tabGroupByNoteId' in next) (next as any).tabGroupByNoteId = stripDraftKeys((next as any).tabGroupByNoteId)

  if (Array.isArray(next.workspaces)) {
    next.workspaces = next.workspaces.map(ws => {
      const openNoteIds = stripDraftIds((ws as any).openNoteIds)
      const tabGroupByNoteId = stripDraftKeys((ws as any).tabGroupByNoteId)
      return { ...ws, openNoteIds, tabGroupByNoteId }
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

function isDraftNoteId(noteId: string): boolean {
  return String(noteId || '').startsWith('draft_')
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
  const [page, setPage] = React.useState<PageId>('home')
  const pageRef = React.useRef<PageId>('home')
  React.useEffect(() => {
    pageRef.current = page
  }, [page])

  // ---- 元数据（持久化）
  const metaRef = React.useRef<HyperCortexMetadataV1 | null>(null)
  const [metaReady, setMetaReady] = React.useState(false)
  const restoreActiveNoteIdRef = React.useRef<string>('')

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
  }, [])

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

  // ---- 侧边栏 / 工作区 / 分组
  const [tabsCollapsed, setTabsCollapsed] = React.useState(false)
  const [workspaces, setWorkspaces] = React.useState<HyperCortexWorkspaceV1[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = React.useState<string>('')
  const [openNoteTabs, setOpenNoteTabs] = React.useState<NoteMeta[]>([])
  const [tabsInitReady, setTabsInitReady] = React.useState(false)
  const [tabsMode, setTabsMode] = React.useState<TabsMode>('manual')
  const [tabsHoverOpen, setTabsHoverOpen] = React.useState(false)
  const [tabGrouping, setTabGrouping] = React.useState<{ groups: HyperCortexTabGroupV1[]; byNoteId: Record<string, string> }>({
    groups: [],
    byNoteId: {},
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

  const setNoteSessionHandle = React.useCallback((noteId: string, handle: NoteDetailSessionHandle | null) => {
    const nid = String(noteId || '').trim()
    if (!nid) return
    if (!handle) delete noteSessionHandlesRef.current[nid]
    else noteSessionHandlesRef.current[nid] = handle
  }, [])

  const isNoteDirtyById = React.useCallback((noteId: string): boolean => {
    const nid = String(noteId || '').trim()
    if (!nid) return false
    return noteSessionHandlesRef.current[nid]?.isDirty?.() === true
  }, [])

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

  const commitActiveWorkspacePatch = React.useCallback(
    (patch: Partial<Pick<HyperCortexWorkspaceV1, 'title' | 'openNoteIds' | 'tabGroups' | 'tabGroupByNoteId'>>) => {
      setWorkspaces(prev => {
        const wid = activeWorkspaceIdRef.current
        if (!wid) return prev
        const idx = prev.findIndex(w => w.id === wid)
        if (idx < 0) return prev
        const current = prev[idx]
        const nextWs: HyperCortexWorkspaceV1 = {
          ...current,
          ...patch,
          title: typeof patch.title === 'string' ? patch.title.trim() || current.title : current.title,
          openNoteIds: Array.isArray(patch.openNoteIds) ? patch.openNoteIds : current.openNoteIds,
          tabGroups: Array.isArray(patch.tabGroups) ? patch.tabGroups : current.tabGroups,
          tabGroupByNoteId: patch.tabGroupByNoteId && typeof patch.tabGroupByNoteId === 'object' ? (patch.tabGroupByNoteId as any) : current.tabGroupByNoteId,
        }
        if (nextWs === current) return prev
        const nextList = prev.slice()
        nextList[idx] = nextWs

        if (metaReadyRef.current) {
          void persistMetadataPatch({
            workspaces: nextList,
            activeWorkspaceId: wid,
            openNoteIds: nextWs.openNoteIds,
            tabGroups: nextWs.tabGroups,
            tabGroupByNoteId: nextWs.tabGroupByNoteId,
          }).catch(() => {})
        }

        return nextList
      })
    },
    [persistMetadataPatch],
  )

  const updateTabGrouping = React.useCallback(
    (updater: (prev: { groups: HyperCortexTabGroupV1[]; byNoteId: Record<string, string> }) => { groups: HyperCortexTabGroupV1[]; byNoteId: Record<string, string> }) => {
      setTabGrouping(prev => {
        const next = updater(prev)
        commitActiveWorkspacePatch({ tabGroups: next.groups, tabGroupByNoteId: next.byNoteId })
        return next
      })
    },
    [commitActiveWorkspacePatch],
  )

  const isHoverTabsMode = tabsMode === 'hover'
  const sidebarRailWidth = isHoverTabsMode ? 52 : tabsCollapsed ? 52 : 220
  const sidebarPanelExpanded = isHoverTabsMode ? tabsHoverOpen : !tabsCollapsed
  const sidebarPanelWidth = isHoverTabsMode ? (tabsHoverOpen ? 220 : 52) : sidebarRailWidth

  const backToHost = React.useCallback(() => {
    try {
      if (typeof api.ui?.back === 'function') return void api.ui.back()
      if (typeof api.host?.back === 'function') return void api.host.back()
      return void api.ui?.showToast?.('无法返回')
    } catch (e: any) {
      api.ui?.showToast?.(String(e?.message || e))
    }
  }, [api])

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
      const wid = String(nextActiveWorkspaceId || '').trim()
      const activeWs = nextWorkspaces.find(w => w.id === wid) || nextWorkspaces[0]
      if (!activeWs) return
      void persistMetadataPatch({
        workspaces: nextWorkspaces,
        activeWorkspaceId: wid,
        openNoteIds: activeWs.openNoteIds,
        tabGroups: activeWs.tabGroups,
        tabGroupByNoteId: activeWs.tabGroupByNoteId,
      }).catch(() => {})
    },
    [persistMetadataPatch],
  )

  const applyWorkspaceSidebarState = React.useCallback(
    (ws: HyperCortexWorkspaceV1) => {
      setTabGrouping({ groups: ws.tabGroups, byNoteId: ws.tabGroupByNoteId })

      const seq = (workspaceSwitchSeqRef.current += 1)
      const openIds = ws.openNoteIds
      if (!openIds.length) {
        setOpenNoteTabs([])
      } else {
        void (async () => {
          try {
            const idx = await loadNoteIndex(api, 'library')
            const tabs = openIds
              .map(id => {
                const noteId = String(id || '').trim()
                if (!noteId) return null
                return (idx.notes?.[noteId] as NoteMeta | undefined) || draftNoteMetaRef.current[noteId] || null
              })
              .filter(Boolean) as NoteMeta[]
            if (workspaceSwitchSeqRef.current !== seq) return
            setOpenNoteTabs(tabs)
          } catch {
            if (workspaceSwitchSeqRef.current !== seq) return
            setOpenNoteTabs([])
          }
        })()
      }

      const currentActiveId = String(activeNoteId || '').trim()
      if (currentActiveId && !openIds.includes(currentActiveId)) {
        setActiveNoteId('')
        if (page === 'note-detail') setPage('home')
      }
    },
    [activeNoteId, api, page],
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
        void persistMetadataPatch({
          activeWorkspaceId: wid,
          openNoteIds: ws.openNoteIds,
          tabGroups: ws.tabGroups,
          tabGroupByNoteId: ws.tabGroupByNoteId,
        }).catch(() => {})
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
        openNoteIds: [],
        tabGroups: [],
        tabGroupByNoteId: {},
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
    (noteId: string, groupId: string) => {
      const nid = String(noteId || '').trim()
      const gid = String(groupId || '').trim()
      if (!nid || !gid) return
      updateTabGrouping(prev => {
        if (!prev.groups.some(g => g.id === gid)) return prev
        return { ...prev, byNoteId: { ...prev.byNoteId, [nid]: gid } }
      })
    },
    [updateTabGrouping],
  )

  const handleUnassignTabFromGroup = React.useCallback(
    (noteId: string) => {
      const nid = String(noteId || '').trim()
      if (!nid) return
      updateTabGrouping(prev => {
        if (!prev.byNoteId[nid]) return prev
        const nextByNoteId = { ...prev.byNoteId }
        delete nextByNoteId[nid]
        return { ...prev, byNoteId: nextByNoteId }
      })
    },
    [updateTabGrouping],
  )

  const handleReorderOpenTabs = React.useCallback(
    (nextOpenNoteIds: string[]) => {
      const ids = Array.isArray(nextOpenNoteIds) ? nextOpenNoteIds : []
      setOpenNoteTabs(prev => {
        if (prev.length <= 1) return prev
        const byId = new Map(prev.map(t => [t.id, t]))
        const seen = new Set<string>()
        const next: NoteMeta[] = []

        for (const raw of ids) {
          const id = typeof raw === 'string' ? raw.trim() : ''
          if (!id || seen.has(id)) continue
          const meta = byId.get(id)
          if (!meta) continue
          seen.add(id)
          next.push(meta)
        }
        for (const meta of prev) {
          if (seen.has(meta.id)) continue
          seen.add(meta.id)
          next.push(meta)
        }

        if (next.length === prev.length && next.every((t, i) => t.id === prev[i]?.id)) return prev
        commitActiveWorkspacePatch({ openNoteIds: next.map(t => t.id) })
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
        const nextByNoteId: Record<string, string> = {}
        for (const [noteId, mapped] of Object.entries(prev.byNoteId)) {
          if (mapped === gid) continue
          nextByNoteId[noteId] = mapped
        }
        return { groups: nextGroups, byNoteId: nextByNoteId }
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
        setAllNotesLayout(normalizeAllNotesLayout(meta.allNotesLayout))
        setTabsCollapsed(normalizeBoolean(meta.tabsCollapsed))
        setTabsMode(normalizeTabsMode(meta.tabsMode))
        const activeId = typeof meta.activeNoteId === 'string' ? meta.activeNoteId.trim() : ''
        restoreActiveNoteIdRef.current = activeId

        let nextWorkspaces = normalizeWorkspaces(meta.workspaces, {
          openNoteIds: meta.openNoteIds,
          tabGroups: meta.tabGroups,
          tabGroupByNoteId: meta.tabGroupByNoteId,
        })
        const nextActiveWorkspaceId = normalizeActiveWorkspaceId(meta.activeWorkspaceId, nextWorkspaces)
        let activeWs = nextWorkspaces.find(w => w.id === nextActiveWorkspaceId) || nextWorkspaces[0]

        let didMutateActiveWorkspace = false
        if (activeWs && activeId && !activeWs.openNoteIds.includes(activeId)) {
          const nextOpenIds = [...activeWs.openNoteIds, activeId]
          nextWorkspaces = updateWorkspaceById(nextWorkspaces, nextActiveWorkspaceId, ws => ({ ...ws, openNoteIds: nextOpenIds }))
          activeWs = { ...activeWs, openNoteIds: nextOpenIds }
          didMutateActiveWorkspace = true
        }

        activeWorkspaceIdRef.current = nextActiveWorkspaceId
        setWorkspaces(nextWorkspaces)
        setActiveWorkspaceId(nextActiveWorkspaceId)
        setTabGrouping({ groups: activeWs.tabGroups, byNoteId: activeWs.tabGroupByNoteId })

        const openIds = activeWs.openNoteIds
        if (openIds.length) {
          try {
            const idx = await ensureNoteIndexLoaded()
            const tabs = openIds.map(id => idx.notes?.[id]).filter(Boolean) as NoteMeta[]
            setOpenNoteTabs(tabs)
          } catch {
          }
        }

        const shouldMigrateWorkspaces = !Array.isArray(meta.workspaces) || meta.activeWorkspaceId !== nextActiveWorkspaceId || didMutateActiveWorkspace
        if (shouldMigrateWorkspaces) {
          void persistMetadataPatch({
            workspaces: nextWorkspaces,
            activeWorkspaceId: nextActiveWorkspaceId,
            openNoteIds: openIds,
            tabGroups: activeWs.tabGroups,
            tabGroupByNoteId: activeWs.tabGroupByNoteId,
          }).catch(() => {})
        }
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
      const next = [...prev, meta]
      commitActiveWorkspacePatch({ openNoteIds: next.map(t => t.id) })
      return next
    })

    setActiveNoteId(draftId)
    setPage('note-detail')
  }, [commitActiveWorkspacePatch])

  const handleOpenNote = React.useCallback(
    (note: NoteMeta) => {
      const nid = String(note?.id || '').trim()
      if (!nid) return
      setOpenNoteTabs(prev => {
        const next = prev.some(t => t.id === nid) ? prev : [...prev, note]
        commitActiveWorkspacePatch({ openNoteIds: next.map(t => t.id) })
        if (metaReady && !isDraftNoteId(nid)) void persistMetadataPatch({ activeNoteId: nid }).catch(() => {})
        return next
      })
      setActiveNoteId(nid)
      setPage('note-detail')
    },
    [commitActiveWorkspacePatch, metaReady, persistMetadataPatch],
  )

  React.useEffect(() => {
    if (!metaReady || !tabsInitReady) return
    const targetId = restoreActiveNoteIdRef.current
    if (!targetId) return
    const meta = openNoteTabs.find(t => t.id === targetId)
    restoreActiveNoteIdRef.current = ''
    if (meta) handleOpenNote(meta)
  }, [handleOpenNote, metaReady, openNoteTabs, tabsInitReady])

  const handleCloseTabs = React.useCallback(
    (noteIds: string[]) => {
      const closing = new Set(noteIds.map(s => String(s || '').trim()).filter(Boolean))
      if (!closing.size) return
      setOpenNoteTabs(prev => {
        const hasAny = prev.some(t => closing.has(t.id))
        if (!hasAny) return prev
        for (const id of closing) {
          if (!isDraftNoteId(id)) continue
          delete draftNoteMetaRef.current[id]
          delete noteInitSnapshotsRef.current[id]
        }
        for (const id of closing) {
          delete noteSessionHandlesRef.current[id]
          delete noteInitSnapshotsRef.current[id]
          delete noteScrollTopByIdRef.current[id]
        }
        const next = prev.filter(t => !closing.has(t.id))

        const currentActiveId = String(activeNoteId || '').trim()
        const closingActive = !!currentActiveId && closing.has(currentActiveId)
        let fallback: NoteMeta | null = null
        if (closingActive) {
          const activeIdx = prev.findIndex(t => t.id === currentActiveId)
          for (let i = activeIdx + 1; i < prev.length; i++) {
            const t = prev[i]
            if (!closing.has(t.id)) {
              fallback = t
              break
            }
          }
          if (!fallback) {
            for (let i = activeIdx - 1; i >= 0; i--) {
              const t = prev[i]
              if (!closing.has(t.id)) {
                fallback = t
                break
              }
            }
          }
        }

        const nextActiveId = closingActive ? fallback?.id : currentActiveId
        commitActiveWorkspacePatch({ openNoteIds: next.map(t => t.id) })
        if (metaReady && !isDraftNoteId(nextActiveId || '')) void persistMetadataPatch({ activeNoteId: nextActiveId }).catch(() => {})

        if (!closingActive) return next
        setActiveNoteId(nextActiveId || '')
        if (page === 'note-detail') setPage(nextActiveId ? 'note-detail' : 'home')
        return next
      })
    },
    [activeNoteId, commitActiveWorkspacePatch, metaReady, page, persistMetadataPatch],
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

  const handleDeleteGroupAndCloseTabs = React.useCallback(
    (groupId: string) => {
      const gid = String(groupId || '').trim()
      if (!gid) return
      const idsToClose = openNoteTabs.filter(t => tabGrouping.byNoteId[t.id] === gid).map(t => t.id)
      handleDeleteGroupOnly(gid)
      if (idsToClose.length) handleCloseTabs(idsToClose)
    },
    [handleCloseTabs, handleDeleteGroupOnly, openNoteTabs, tabGrouping.byNoteId],
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
      noteInitSnapshotsRef.current[meta.id] = payload.snapshotForNewId
      delete draftNoteMetaRef.current[originalId]
      delete noteSessionHandlesRef.current[originalId]
      delete noteInitSnapshotsRef.current[originalId]
      if (noteScrollTopByIdRef.current[originalId] != null) {
        noteScrollTopByIdRef.current[meta.id] = noteScrollTopByIdRef.current[originalId]
        delete noteScrollTopByIdRef.current[originalId]
      }
      updateTabGrouping(prev => {
        const gid = prev.byNoteId[originalId]
        if (!gid) return prev
        const byNoteId = { ...prev.byNoteId }
        byNoteId[meta.id] = gid
        delete byNoteId[originalId]
        return { ...prev, byNoteId }
      })
      setCloseTabPrompt(p => (p?.noteId === originalId ? { noteId: meta.id } : p))
    }

    setNoteIndex(prev => {
      const current = prev || { version: 1, notes: {} }
      const nextNotes = { ...(current.notes || {}) }
      if (didMigrateId) delete nextNotes[originalId]
      nextNotes[meta.id] = meta
      return { ...current, notes: nextNotes }
    })

    setAllNotes(prev => sortNotesByUpdatedAtDesc([meta, ...prev.filter(item => item.id !== originalId)]))

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
      commitActiveWorkspacePatch({ openNoteIds: next.map(t => t.id) })
      return next
    })

    if (activeNoteId === originalId) setActiveNoteId(meta.id)
    if (metaReady && activeNoteId === originalId && !isDraftNoteId(meta.id)) void persistMetadataPatch({ activeNoteId: meta.id }).catch(() => {})
  }, [activeNoteId, commitActiveWorkspacePatch, metaReady, persistMetadataPatch, updateTabGrouping])

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
    setPage('note-detail')
    noteSessionHandlesRef.current[nid]?.enterEditMode?.()
  }, [closeTabPrompt?.noteId])

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
                <NavIconButton title="主页" ariaLabel="主页" active={page === 'home'} onClick={() => setPage('home')}>
                  <HomeRoundedIcon fontSize="small" />
                </NavIconButton>
                <NavIconButton title="索引" ariaLabel="索引" active={page === 'index'} onClick={() => setPage('index')}>
                  <AccountTreeRoundedIcon fontSize="small" />
                </NavIconButton>
                <NavIconButton title="附件" ariaLabel="附件" active={page === 'attachments'} onClick={() => setPage('attachments')}>
                  <AttachFileRoundedIcon fontSize="small" />
                </NavIconButton>
                <NavIconButton title="全部笔记" ariaLabel="全部笔记" active={page === 'all-notes'} onClick={() => setPage('all-notes')}>
                  <NotesRoundedIcon fontSize="small" />
                </NavIconButton>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', pr: 1 }}>
              <NavIconButton title="设置" ariaLabel="设置" active={page === 'settings'} onClick={() => setPage('settings')}>
                <SettingsRoundedIcon fontSize="small" />
              </NavIconButton>
            </Box>
          </Toolbar>
        </AppBar>

        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch', position: 'relative' }}>
          <Box
            onMouseEnter={() => isHoverTabsMode && setTabsHoverOpen(true)}
            onMouseLeave={() => isHoverTabsMode && setTabsHoverOpen(false)}
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
                openNoteTabs={openNoteTabs}
                activeNoteId={page === 'note-detail' ? activeNoteId : ''}
                isNoteDirty={isNoteDirtyById}
                workspaces={workspaces.map(w => ({ id: w.id, title: w.title }))}
                activeWorkspaceId={activeWorkspaceId}
                tabGroups={tabGrouping.groups}
                tabGroupByNoteId={tabGrouping.byNoteId}
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

          <Box ref={mainScrollElRef} sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' }}>
            <Box sx={{ minHeight: '100%', p: 2 }}>
              {page === 'home' ? <Typography color="text.secondary">这是主页页面。</Typography> : null}
              {page === 'attachments' ? <AssetPoolPanel api={api} scope="library" /> : null}
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
              <Box sx={{ display: page === 'note-detail' ? 'flex' : 'none', minHeight: '100%', flexDirection: 'column', alignItems: 'flex-start', gap: 2.5 }}>
                  {!openNoteTabs.length ? (
                    <Typography color="text.secondary">没有打开的笔记。</Typography>
                  ) : (
                    openNoteTabs.map(tab => (
                      <NoteDetailSession
                        key={tab.id}
                        ref={(handle) => setNoteSessionHandle(tab.id, handle)}
                        api={api}
                        scope="library"
                        note={tab}
                        visible={page === 'note-detail' && tab.id === activeNoteId}
                        noteIndexMap={noteIndexMap}
                        allNotesById={allNotesById}
                        refIndex={refIndex}
                        consumeInitSnapshot={consumeInitSnapshot}
                        onOpenNote={handleOpenNote}
                        onSaved={handleNoteSessionSaved}
                      />
                    ))
                  )}
                </Box>
              {page === 'index' ? <Typography color="text.secondary">这是索引页面。</Typography> : null}
              {page === 'settings' ? <Typography color="text.secondary">这是设置页面。</Typography> : null}
            </Box>
          </Box>
        </Box>
      </Box>

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
