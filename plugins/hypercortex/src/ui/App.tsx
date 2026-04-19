import * as React from 'react'
import { AppBar, Box, Button, CssBaseline, Dialog, DialogActions, DialogContent, DialogTitle, GlobalStyles, IconButton, InputBase, ThemeProvider, Toolbar, Tooltip, Typography, createTheme } from '@mui/material'
import { HyperCodeMirrorEditor as BlockEditor } from '../editor/HyperCodeMirrorEditor'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import HomeRoundedIcon from '@mui/icons-material/HomeRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded'
import NotesRoundedIcon from '@mui/icons-material/NotesRounded'
import AccountTreeRoundedIcon from '@mui/icons-material/AccountTreeRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import CodeRoundedIcon from '@mui/icons-material/CodeRounded'
import WysiwygRoundedIcon from '@mui/icons-material/WysiwygRounded'
import ViewListRoundedIcon from '@mui/icons-material/ViewListRounded'
import ViewModuleRoundedIcon from '@mui/icons-material/ViewModuleRounded'
import AppsRoundedIcon from '@mui/icons-material/AppsRounded'
import {
  ensureMetadata,
  getApi,
  saveMetadata,
  tryLoadMetadata,
  type HyperCortexMetadataV1,
  type HyperCortexNoteDoc,
  type HyperCortexTabGroupV1,
  type HyperCortexWorkspaceV1,
  type NoteMeta,
} from '../core'
import { loadHtmlFace, loadNoteIndex, loadNotePackage, saveHtmlFace, saveNotePackage, type HyperCortexHtmlFaceDoc } from '../notePackage'
import { loadRefIndex, getBacklinksFor, type NoteRefIndex } from '../noteRefs'
import { createMarkdownRenderEngine } from '../render/engine'
import { AutoHeightHtmlIframe } from './AutoHeightHtmlIframe'
import { AssetPoolPanel } from './AssetPoolPanel'
import { OpenTabsPanel } from './OpenTabsPanel'
import { createTabGroupId, pickNextTabGroupColor, pickNextTabGroupTitle } from './tabGroups'
import { createWorkspaceId, normalizeActiveWorkspaceId, normalizeWorkspaces, pickNextWorkspaceTitle, updateWorkspaceById } from './workspaces'

type PageId = 'home' | 'attachments' | 'all-notes' | 'note-detail' | 'index' | 'settings'

type AllNotesLayout = 'list' | 'grid' | 'icon'
type NoteFaceId = 'text' | 'html'
type TextEditorMode = 'source' | 'live'
type TabsMode = 'manual' | 'hover'

type NoteEditMode = 'read' | 'edit'

type NoteContent = {
  title: string
  body: string
  tags: string[]
  html: string
}

type NoteEditSession = {
  mode: NoteEditMode
  face: NoteFaceId
  faces: NoteFaceId[]
  textEditorMode: TextEditorMode
  base: NoteContent
  draft: NoteContent
}

function normalizeAllNotesLayout(value: unknown): AllNotesLayout {
  return value === 'grid' || value === 'icon' ? value : 'list'
}

function normalizeBoolean(value: unknown): boolean {
  return value === true
}

function normalizeTabsMode(value: unknown): TabsMode {
  return value === 'hover' ? 'hover' : 'manual'
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

function normalizeTagText(value: string): string {
  return String(value || '').trim()
}

function appendTag(list: string[], raw: string): string[] {
  const tag = normalizeTagText(raw)
  if (!tag) return list
  if (list.includes(tag)) return list
  return [...list, tag]
}

function areStringListsEqual(a: string[], b: string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function isNoteContentEqual(a: NoteContent, b: NoteContent): boolean {
  return a.title === b.title && a.body === b.body && a.html === b.html && areStringListsEqual(a.tags, b.tags)
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
  const [page, setPage] = React.useState<PageId>('home')
  const metaRef = React.useRef<HyperCortexMetadataV1 | null>(null)
  const [metaReady, setMetaReady] = React.useState(false)
  const restoreActiveNoteIdRef = React.useRef<string>('')
  const [allNotesLayout, setAllNotesLayout] = React.useState<AllNotesLayout>('list')
  const [allNotes, setAllNotes] = React.useState<NoteMeta[]>([])
  const [allNotesLoading, setAllNotesLoading] = React.useState(false)
  const [allNotesLoadError, setAllNotesLoadError] = React.useState<string | null>(null)
  const [activeNote, setActiveNote] = React.useState<NoteMeta | null>(null)
  const [activeNoteDoc, setActiveNoteDoc] = React.useState<HyperCortexNoteDoc | null>(null)
  const [activeNoteLoading, setActiveNoteLoading] = React.useState(false)
  const [activeNoteLoadError, setActiveNoteLoadError] = React.useState<string | null>(null)
  const [activeNoteEditing, setActiveNoteEditing] = React.useState(false)
  const [activeNoteTextEditorMode, setActiveNoteTextEditorMode] = React.useState<TextEditorMode>('live')
  const [activeNoteEditTitle, setActiveNoteEditTitle] = React.useState('')
  const [activeNoteEditBody, setActiveNoteEditBody] = React.useState('')
  const [activeNoteEditTags, setActiveNoteEditTags] = React.useState<string[]>([])
  const [activeNoteTagInput, setActiveNoteTagInput] = React.useState('')
  const [activeNoteEditHtml, setActiveNoteEditHtml] = React.useState('')
  const [activeNoteSaving, setActiveNoteSaving] = React.useState(false)
  const [activeNoteFace, setActiveNoteFace] = React.useState<NoteFaceId>('text')
  const [activeNoteFaces, setActiveNoteFaces] = React.useState<NoteFaceId[]>(['text'])
  const [activeNoteAddFaceSelectorVisible, setActiveNoteAddFaceSelectorVisible] = React.useState(false)
  const [activeNotePendingAddFace, setActiveNotePendingAddFace] = React.useState<NoteFaceId | null>(null)
  const noteEditSessionsRef = React.useRef<Record<string, NoteEditSession>>({})
  const [closeTabPrompt, setCloseTabPrompt] = React.useState<{ noteId: string } | null>(null)
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
  const textRenderRef = React.useRef<HTMLDivElement>(null)
  const [refIndex, setRefIndex] = React.useState<NoteRefIndex>({})

  const stashActiveNoteEditSession = React.useCallback(() => {
    const noteId = String(activeNote?.id || '').trim()
    if (!noteId) return
    const prev = noteEditSessionsRef.current[noteId]
    const draft: NoteContent = {
      title: activeNoteEditTitle,
      body: activeNoteEditBody,
      tags: activeNoteEditTags,
      html: activeNoteEditHtml,
    }
    noteEditSessionsRef.current[noteId] = {
      mode: activeNoteEditing ? 'edit' : 'read',
      face: activeNoteFace,
      faces: activeNoteFaces,
      textEditorMode: activeNoteTextEditorMode,
      base: prev?.base || draft,
      draft,
    }
  }, [
    activeNote?.id,
    activeNoteEditing,
    activeNoteEditBody,
    activeNoteEditHtml,
    activeNoteEditTags,
    activeNoteEditTitle,
    activeNoteFace,
    activeNoteFaces,
    activeNoteTextEditorMode,
  ])

  const restoreNoteEditSession = React.useCallback((noteId: string) => {
    const nid = String(noteId || '').trim()
    const session = nid ? noteEditSessionsRef.current[nid] : undefined
    if (!session) {
      setActiveNoteEditing(false)
      setActiveNoteTextEditorMode('live')
      setActiveNoteEditTitle('')
      setActiveNoteEditBody('')
      setActiveNoteEditTags([])
      setActiveNoteTagInput('')
      setActiveNoteEditHtml('')
      setActiveNoteFace('text')
      setActiveNoteFaces(['text'])
      setActiveNoteAddFaceSelectorVisible(false)
      setActiveNotePendingAddFace(null)
      return
    }

    setActiveNoteEditing(session.mode === 'edit')
    setActiveNoteTextEditorMode(session.textEditorMode)
    setActiveNoteEditTitle(session.draft.title)
    setActiveNoteEditBody(session.draft.body)
    setActiveNoteEditTags(session.draft.tags)
    setActiveNoteTagInput('')
    setActiveNoteEditHtml(session.draft.html)
    setActiveNoteFace(session.face)
    setActiveNoteFaces(session.faces)
    setActiveNoteAddFaceSelectorVisible(false)
    setActiveNotePendingAddFace(null)
  }, [])

  const ensureNoteEditSessionFromLoaded = React.useCallback(
    (note: NoteMeta, doc: HyperCortexNoteDoc, htmlFace: HyperCortexHtmlFaceDoc | null) => {
      const noteId = String(note.id || '').trim()
      if (!noteId) return

      const existing = noteEditSessionsRef.current[noteId]
      const loadedContent: NoteContent = {
        title: doc.title || note.title || '未命名',
        body: doc.body || '',
        tags: doc.tags || [],
        html: htmlFace?.html || '',
      }

      const allowHtml = !!htmlFace?.exists || !!existing?.faces?.includes('html') || existing?.face === 'html'
      const faces: NoteFaceId[] = allowHtml ? ['text', 'html'] : ['text']

      if (!existing) {
        noteEditSessionsRef.current[noteId] = {
          mode: 'read',
          face: 'text',
          faces,
          textEditorMode: 'live',
          base: loadedContent,
          draft: loadedContent,
        }
        return
      }

      const wasPristine = isNoteContentEqual(existing.base, existing.draft)
      existing.faces = faces
      if (existing.face === 'html' && !allowHtml) existing.face = 'text'

      if (!existing.base) existing.base = loadedContent
      if (!existing.draft) existing.draft = loadedContent

      if (wasPristine && !isNoteContentEqual(existing.base, loadedContent)) {
        existing.base = loadedContent
        existing.draft = loadedContent
      }
    },
    [],
  )

  const persistMetadataPatch = React.useCallback(
    async (patch: Partial<HyperCortexMetadataV1>) => {
      const current = metaRef.current || { version: 1 }
      const next: HyperCortexMetadataV1 = { ...current, ...patch, version: 1 }
      metaRef.current = next
      await saveMetadata(api, next)
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

  React.useLayoutEffect(() => {
    if (activeNoteFace !== 'text' || activeNoteEditing || !textRenderRef.current) return
    renderEngineRef.current.renderInto(textRenderRef.current, activeNoteEditBody || '')
  }, [activeNoteEditBody, activeNoteEditing, activeNoteFace])

  /** 编辑器覆盖层渲染完 block 后：等待异步媒体就绪，完成后请求重新布局 */
  const handleBlockRendered = React.useCallback((el: HTMLElement, requestUpdate: () => void) => {
    const pending: { el: HTMLElement; event: string }[] = []
    el.querySelectorAll('img').forEach(img => {
      if (!img.complete) pending.push({ el: img, event: 'load' })
    })
    el.querySelectorAll('video').forEach(vid => {
      if (vid.readyState < 1) pending.push({ el: vid, event: 'loadedmetadata' })
    })
    if (!pending.length) return

    let remaining = pending.length
    const done = () => { if (--remaining <= 0) requestUpdate() }
    pending.forEach(({ el: m, event }) => {
      m.addEventListener(event, done, { once: true })
      m.addEventListener('error', done, { once: true })
    })
  }, [])

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

  const sortNotes = React.useCallback((list: NoteMeta[]) => {
    return list.slice().sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0))
  }, [])

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
            const tabs = openIds.map(id => idx.notes?.[id]).filter(Boolean) as NoteMeta[]
            if (workspaceSwitchSeqRef.current !== seq) return
            setOpenNoteTabs(tabs)
          } catch {
            if (workspaceSwitchSeqRef.current !== seq) return
            setOpenNoteTabs([])
          }
        })()
      }

      const currentActiveId = activeNote?.id || ''
      if (currentActiveId && !openIds.includes(currentActiveId)) {
        stashActiveNoteEditSession()
        setActiveNote(null)
        setActiveNoteDoc(null)
        setActiveNoteLoadError(null)
        setActiveNoteLoading(false)
        setActiveNoteEditing(false)
        setPage('home')
      }
    },
    [activeNote?.id, api, stashActiveNoteEditSession],
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
      const scope = 'library' as const
      const idx = await loadNoteIndex(api, scope)
      const notes = sortNotes(Object.values(idx.notes || {}))
      setAllNotes(notes)

      const noteIndexMap: Record<string, { title: string }> = {}
      for (const n of notes) noteIndexMap[n.id] = { title: n.title }
      renderEngineRef.current.noteIndex = noteIndexMap

      loadRefIndex(api, scope).then(ri => setRefIndex(ri)).catch(() => {})
    } catch (e: any) {
      setAllNotesLoadError(String(e?.message || e || '加载全部笔记失败'))
    } finally {
      setAllNotesLoading(false)
    }
  }, [api, sortNotes])

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
            const idx = await loadNoteIndex(api, 'library')
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

  const handleOpenNote = React.useCallback(
    async (note: NoteMeta) => {
      stashActiveNoteEditSession()
      restoreNoteEditSession(note.id)
      setOpenNoteTabs(prev => {
        const next = prev.some(t => t.id === note.id) ? prev : [...prev, note]
        commitActiveWorkspacePatch({ openNoteIds: next.map(t => t.id) })
        if (metaReady) void persistMetadataPatch({ activeNoteId: note.id }).catch(() => {})
        return next
      })
      setActiveNote(note)
      setActiveNoteDoc(null)
      setActiveNoteLoadError(null)
      setActiveNoteLoading(true)
      setPage('note-detail')
      try {
        const [doc, htmlFace] = await Promise.all([
          loadNotePackage(api, 'library', note.dir),
          loadHtmlFace(api, 'library', note.dir).catch(() => null),
        ])
        setActiveNoteDoc(doc)
        ensureNoteEditSessionFromLoaded(note, doc, htmlFace)
        restoreNoteEditSession(note.id)
      } catch (e: any) {
        const message = String(e?.message || e || '加载笔记失败')
        setActiveNoteLoadError(message)
        await api.ui.showToast(message)
      } finally {
        setActiveNoteLoading(false)
      }
    },
    [api, commitActiveWorkspacePatch, ensureNoteEditSessionFromLoaded, metaReady, persistMetadataPatch, restoreNoteEditSession, stashActiveNoteEditSession],
  )

  React.useEffect(() => {
    if (!metaReady || !tabsInitReady) return
    const targetId = restoreActiveNoteIdRef.current
    if (!targetId) return
    const meta = openNoteTabs.find(t => t.id === targetId)
    restoreActiveNoteIdRef.current = ''
    if (meta) void handleOpenNote(meta)
  }, [handleOpenNote, metaReady, openNoteTabs, tabsInitReady])

  const handleCloseTabs = React.useCallback(
    (noteIds: string[]) => {
      const closing = new Set(noteIds.map(s => String(s || '').trim()).filter(Boolean))
      if (!closing.size) return
      setOpenNoteTabs(prev => {
        const hasAny = prev.some(t => closing.has(t.id))
        if (!hasAny) return prev
        const next = prev.filter(t => !closing.has(t.id))

        const currentActiveId = activeNote?.id || ''
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
        if (metaReady) void persistMetadataPatch({ activeNoteId: nextActiveId }).catch(() => {})

        if (!closingActive) return next
        if (fallback) void handleOpenNote(fallback)
        else {
          stashActiveNoteEditSession()
          setActiveNote(null)
          setActiveNoteDoc(null)
          setActiveNoteLoadError(null)
          setActiveNoteLoading(false)
          setActiveNoteEditing(false)
          setPage('home')
        }
        return next
      })
    },
    [activeNote?.id, commitActiveWorkspacePatch, handleOpenNote, metaReady, persistMetadataPatch, stashActiveNoteEditSession],
  )

  const isNoteDirtyById = React.useCallback(
    (noteId: string) => {
      const nid = String(noteId || '').trim()
      if (!nid) return false
      const session = noteEditSessionsRef.current[nid]
      if (!session) return false
      if (activeNote?.id === nid) {
        const activeDraft: NoteContent = {
          title: activeNoteEditTitle,
          body: activeNoteEditBody,
          tags: activeNoteEditTags,
          html: activeNoteEditHtml,
        }
        return !isNoteContentEqual(activeDraft, session.base)
      }
      return !isNoteContentEqual(session.draft, session.base)
    },
    [activeNote?.id, activeNoteEditBody, activeNoteEditHtml, activeNoteEditTags, activeNoteEditTitle],
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

  React.useEffect(() => {
    const el = textRenderRef.current
    if (!el) return
    const handler = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null
      const link = target?.closest?.('.hc-note-ref') as HTMLElement | null
      if (!link) return
      const noteId = link.getAttribute('data-note-id')
      if (!noteId) return
      e.preventDefault()
      const meta = allNotes.find(n => n.id === noteId)
      if (meta) handleOpenNote(meta)
    }
    el.addEventListener('click', handler)
    return () => el.removeEventListener('click', handler)
  }, [allNotes, handleOpenNote])

  React.useEffect(() => {
    const noteId = String(activeNote?.id || '').trim()
    if (!noteId) return
    const session = noteEditSessionsRef.current[noteId]
    if (!session) return
    const draft: NoteContent = {
      title: activeNoteEditTitle,
      body: activeNoteEditBody,
      tags: activeNoteEditTags,
      html: activeNoteEditHtml,
    }
    session.mode = activeNoteEditing ? 'edit' : 'read'
    session.face = activeNoteFace
    session.faces = activeNoteFaces
    session.textEditorMode = activeNoteTextEditorMode
    session.base = session.base || draft
    session.draft = draft
  }, [
    activeNote?.id,
    activeNoteEditBody,
    activeNoteEditHtml,
    activeNoteEditTags,
    activeNoteEditTitle,
    activeNoteEditing,
    activeNoteFace,
    activeNoteFaces,
    activeNoteTextEditorMode,
  ])

  const discardNoteDraft = React.useCallback(
    (noteId: string) => {
      const nid = String(noteId || '').trim()
      if (!nid) return
      const session = noteEditSessionsRef.current[nid]
      if (!session) return
      const nextDraft: NoteContent = {
        title: session.base.title,
        body: session.base.body,
        tags: session.base.tags.slice(),
        html: session.base.html,
      }
      session.draft = nextDraft
      session.mode = 'read'
      if (activeNote?.id === nid) {
        setActiveNoteEditTitle(nextDraft.title)
        setActiveNoteEditBody(nextDraft.body)
        setActiveNoteEditTags(nextDraft.tags)
        setActiveNoteEditHtml(nextDraft.html)
        setActiveNoteTagInput('')
        setActiveNoteAddFaceSelectorVisible(false)
        setActiveNotePendingAddFace(null)
        setActiveNoteTextEditorMode('live')
        setActiveNoteEditing(false)
      }
    },
    [activeNote?.id],
  )

  const toggleActiveNoteTextEditorMode = React.useCallback(() => {
    setActiveNoteTextEditorMode(prev => (prev === 'source' ? 'live' : 'source'))
  }, [])

  const handleToggleActiveNoteMode = React.useCallback(() => {
    if (!activeNoteDoc || !activeNote) return
    setActiveNoteEditing(prev => !prev)
  }, [activeNote, activeNoteDoc])

  const handleCancelEditingActiveNote = React.useCallback(() => {
    if (activeNoteSaving) return
    const noteId = String(activeNote?.id || '').trim()
    if (!noteId) return
    discardNoteDraft(noteId)
  }, [activeNote?.id, activeNoteSaving, discardNoteDraft])

  const handleSaveActiveNote = React.useCallback(async () => {
    if (!activeNote || activeNoteSaving) return
    setActiveNoteSaving(true)
    try {
      const scope = 'library' as const
      const title = String(activeNoteEditTitle || '').trim() || '未命名'
      const body = String(activeNoteEditBody || '').replace(/\r\n/g, '\n')
      const tags = activeNoteEditTags.map(normalizeTagText).filter(Boolean)

      let meta: NoteMeta
      let toastMsg: string

      if (activeNoteFace === 'html') {
        const result = await saveHtmlFace(api, scope, {
          id: activeNote.id,
          packageDir: activeNote.dir,
          title,
          body: activeNoteDoc?.body || '',
          tags,
          createdAtMs: activeNote.createdAtMs,
          resources: activeNoteDoc?.resources || [],
          html: activeNoteEditHtml,
        })
        meta = result.meta
        setActiveNoteDoc(prev => prev ? { ...prev, title, tags } : prev)
        setActiveNoteFaces(prev => (prev.includes('html') ? prev : [...prev, 'html']))
        toastMsg = 'HTML 面已保存'
      } else {
        const result = await saveNotePackage(api, scope, {
          id: activeNote.id,
          title,
          body,
          tags,
          createdAtMs: activeNote.createdAtMs,
          resources: activeNoteDoc?.resources || [],
          saveTextFace: true,
        })
        meta = result.meta
        setActiveNoteDoc(result.doc)
        setActiveNoteEditBody(result.doc.body)
        toastMsg = '笔记已保存'
      }

      setAllNotes(prev => sortNotes([meta, ...prev.filter(item => item.id !== activeNote.id)]))
      setActiveNote(meta)
      setOpenNoteTabs(prev => prev.map(t => (t.id === meta.id ? meta : t)))
      setActiveNoteEditTitle(title)
      setActiveNoteEditTags(tags)
      setActiveNoteTagInput('')
      const session = noteEditSessionsRef.current[meta.id]
      if (session) {
        const nextBase: NoteContent = {
          title,
          body: session.base.body,
          tags: tags.slice(),
          html: session.base.html,
        }
        if (activeNoteFace === 'text') nextBase.body = body
        if (activeNoteFace === 'html') nextBase.html = activeNoteEditHtml
        session.base = nextBase
      }
      await api.ui.showToast(toastMsg)
    } catch (e: any) {
      await api.ui.showToast(String(e?.message || e || '保存失败'))
    } finally {
      setActiveNoteSaving(false)
    }
  }, [
    activeNote,
    activeNoteDoc?.body,
    activeNoteDoc?.resources,
    activeNoteEditBody,
    activeNoteEditHtml,
    activeNoteEditTags,
    activeNoteEditTitle,
    activeNoteFace,
    activeNoteFaces,
    activeNoteSaving,
    activeNoteTextEditorMode,
    api,
    sortNotes,
  ])

  const handleAddActiveNoteTag = React.useCallback(() => {
    setActiveNoteEditTags(prev => appendTag(prev, activeNoteTagInput))
    setActiveNoteTagInput('')
  }, [activeNoteTagInput])

  const handleRemoveActiveNoteTag = React.useCallback((tag: string) => {
    setActiveNoteEditTags(prev => prev.filter(item => item !== tag))
  }, [])

  const handleAddActiveNoteFace = React.useCallback(async () => {
    if (!activeNotePendingAddFace) return
    if (activeNotePendingAddFace === 'html' && activeNote) {
      if (!activeNoteDoc) return
      try {
        const htmlFace = await loadHtmlFace(api, 'library', activeNote.dir)
        setActiveNoteEditHtml(htmlFace.html || '')
      } catch {
        setActiveNoteEditHtml('')
      }
      setActiveNoteFaces(prev => (prev.includes('html') ? prev : [...prev, 'html']))
      setActiveNoteFace('html')
      setActiveNoteEditing(true)
    }
    setActiveNoteAddFaceSelectorVisible(false)
    setActiveNotePendingAddFace(null)
  }, [activeNote, activeNoteDoc, activeNotePendingAddFace, api])

  const handleCloseActiveNote = React.useCallback(() => {
    stashActiveNoteEditSession()
    setPage('all-notes')
    setActiveNote(null)
    setActiveNoteDoc(null)
    setActiveNoteLoadError(null)
    setActiveNoteLoading(false)
    setActiveNoteEditing(false)
    setActiveNoteEditTitle('')
    setActiveNoteEditBody('')
    setActiveNoteEditTags([])
    setActiveNoteTagInput('')
    setActiveNoteEditHtml('')
    setActiveNoteSaving(false)
    setActiveNoteFace('text')
    setActiveNoteFaces(['text'])
    setActiveNoteAddFaceSelectorVisible(false)
    setActiveNotePendingAddFace(null)
  }, [stashActiveNoteEditSession])

  const activeNoteDirty = !!activeNote && isNoteDirtyById(activeNote.id)
  const closeTabPromptTargetSaving = !!closeTabPrompt && !!activeNoteSaving && activeNote?.id === closeTabPrompt.noteId

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
    const session = noteEditSessionsRef.current[nid]
    if (session) session.mode = 'edit'
    if (activeNote?.id === nid) return setActiveNoteEditing(true)
    const meta = openNoteTabs.find(t => t.id === nid) || allNotes.find(n => n.id === nid)
    if (meta) void handleOpenNote(meta)
  }, [activeNote?.id, allNotes, closeTabPrompt?.noteId, handleOpenNote, openNoteTabs])

  const handleCloseTabPromptDiscardAndClose = React.useCallback(() => {
    const nid = String(closeTabPrompt?.noteId || '').trim()
    if (!nid) return
    setCloseTabPrompt(null)
    discardNoteDraft(nid)
    handleCloseTabs([nid])
  }, [closeTabPrompt?.noteId, discardNoteDraft, handleCloseTabs])

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
                activeNoteId={activeNote?.id || ''}
                isNoteDirty={isNoteDirtyById}
                workspaces={workspaces.map(w => ({ id: w.id, title: w.title }))}
                activeWorkspaceId={activeWorkspaceId}
                tabGroups={tabGrouping.groups}
                tabGroupByNoteId={tabGrouping.byNoteId}
                onToggleTabsCollapsed={toggleTabsCollapsed}
                onToggleTabsMode={toggleTabsMode}
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

          <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' }}>
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
                              void api.clipboard.writeText(`[[${note.id}|${note.title}]]`)
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
                              void api.clipboard.writeText(`[[${note.id}|${note.title}]]`)
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
                                void api.clipboard.writeText(`[[${note.id}|${note.title}]]`)
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
              {page === 'note-detail' ? (
                <Box sx={{ display: 'flex', minHeight: '100%', flexDirection: 'column', alignItems: 'flex-start', gap: 2.5 }}>
                  <Box sx={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      {!activeNoteLoading && !activeNoteLoadError && activeNoteDoc ? (
                        <Tooltip title={activeNoteEditing ? '切到阅读模式' : '切到编辑模式'} placement="bottom-start">
                          <IconButton
                            size="small"
                            aria-label={activeNoteEditing ? '切换到阅读模式' : '切换到编辑模式'}
                            onClick={handleToggleActiveNoteMode}
                            disabled={activeNoteSaving}
                            sx={{
                              color: 'rgba(0,0,0,.58)',
                              bgcolor: 'transparent',
                              boxShadow: 'none',
                              border: 0,
                              flex: '0 0 auto',
                              '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
                              '&.Mui-disabled': { color: 'rgba(0,0,0,.28)' },
                            }}
                          >
                            {activeNoteEditing ? <WysiwygRoundedIcon fontSize="small" /> : <EditRoundedIcon fontSize="small" />}
                          </IconButton>
                        </Tooltip>
                      ) : null}
                      {!activeNoteLoading && !activeNoteLoadError && activeNoteDoc ? (
                        <Tooltip title="保存" placement="bottom-start">
                          <IconButton
                            size="small"
                            aria-label="保存笔记"
                            onClick={() => void handleSaveActiveNote()}
                            disabled={activeNoteSaving || !activeNoteDirty}
                            sx={{
                              color: 'rgba(0,0,0,.58)',
                              bgcolor: 'transparent',
                              boxShadow: 'none',
                              border: 0,
                              flex: '0 0 auto',
                              '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
                              '&.Mui-disabled': { color: 'rgba(0,0,0,.28)' },
                            }}
                          >
                            <SaveRoundedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      ) : null}
                      {!activeNoteLoading && !activeNoteLoadError && activeNoteDoc && activeNoteDirty ? (
                        <Tooltip title="放弃改动（回到已保存状态）" placement="bottom-start">
                          <IconButton
                            size="small"
                            aria-label="放弃未保存改动"
                            onClick={handleCancelEditingActiveNote}
                            disabled={activeNoteSaving}
                            sx={{
                              color: 'rgba(0,0,0,.58)',
                              bgcolor: 'transparent',
                              boxShadow: 'none',
                              border: 0,
                              flex: '0 0 auto',
                              '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
                              '&.Mui-disabled': { color: 'rgba(0,0,0,.28)' },
                            }}
                          >
                            <CloseRoundedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      ) : null}
                      {!activeNoteLoading && !activeNoteLoadError && activeNoteDoc && activeNoteEditing && activeNoteFace === 'text' ? (
                        <Tooltip title={activeNoteTextEditorMode === 'source' ? '切换到 Live 编辑' : '切换到 源码编辑'} placement="bottom-start">
                          <IconButton
                            size="small"
                            aria-label={activeNoteTextEditorMode === 'source' ? '切换到 Live 编辑' : '切换到 源码编辑'}
                            onClick={toggleActiveNoteTextEditorMode}
                            disabled={activeNoteSaving}
                            sx={{
                              color: 'rgba(0,0,0,.58)',
                              bgcolor: 'transparent',
                              boxShadow: 'none',
                              border: 0,
                              flex: '0 0 auto',
                              '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
                              '&.Mui-disabled': { color: 'rgba(0,0,0,.28)' },
                            }}
                          >
                            {activeNoteTextEditorMode === 'source' ? <WysiwygRoundedIcon fontSize="small" /> : <CodeRoundedIcon fontSize="small" />}
                          </IconButton>
                        </Tooltip>
                      ) : null}
                      {activeNoteDirty ? (
                        <Tooltip title="有未保存改动" placement="bottom-start">
                          <Box
                            aria-label="有未保存改动"
                            sx={{
                              ml: 0.25,
                              width: 8,
                              height: 8,
                              borderRadius: 999,
                              bgcolor: '#f59e0b',
                              boxShadow: '0 0 0 2px #fff',
                              flex: '0 0 auto',
                            }}
                          />
                        </Tooltip>
                      ) : null}
                    </Box>

                    {!activeNoteLoading && !activeNoteLoadError && activeNoteDoc ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Tooltip title="新增面" placement="bottom-end">
                          <IconButton
                            size="small"
                            aria-label="新增面"
                            onClick={() => setActiveNoteAddFaceSelectorVisible(prev => !prev)}
                            sx={{
                              color: 'rgba(0,0,0,.58)',
                              bgcolor: 'transparent',
                              '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
                            }}
                          >
                            <AddRoundedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>

                        {activeNoteAddFaceSelectorVisible ? (
                          <Box
                            sx={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              p: 0.5,
                              borderRadius: 999,
                              bgcolor: 'rgba(0,0,0,.05)',
                              gap: 0.5,
                            }}
                          >
                            {!activeNoteFaces.includes('html') ? (
                              <Box
                                role="button"
                                tabIndex={0}
                                onClick={() => setActiveNotePendingAddFace('html')}
                                onKeyDown={e => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    setActiveNotePendingAddFace('html')
                                  }
                                }}
                                sx={{
                                  minWidth: 56,
                                  px: 1.5,
                                  py: 0.75,
                                  borderRadius: 999,
                                  bgcolor: activeNotePendingAddFace === 'html' ? '#111' : 'transparent',
                                  color: activeNotePendingAddFace === 'html' ? '#fff' : '#374151',
                                  fontSize: 12,
                                  lineHeight: 1,
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  userSelect: 'none',
                                }}
                              >
                                HTML
                              </Box>
                            ) : null}
                            <Box
                              role="button"
                              tabIndex={0}
                              onClick={handleAddActiveNoteFace}
                              onKeyDown={e => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  handleAddActiveNoteFace()
                                }
                              }}
                              sx={{
                                minWidth: 56,
                                px: 1.5,
                                py: 0.75,
                                borderRadius: 999,
                                bgcolor: '#fff',
                                color: activeNotePendingAddFace ? '#111' : 'rgba(0,0,0,.32)',
                                fontSize: 12,
                                lineHeight: 1,
                                fontWeight: 700,
                                cursor: activeNotePendingAddFace ? 'pointer' : 'default',
                                userSelect: 'none',
                              }}
                            >
                              添加
                            </Box>
                          </Box>
                        ) : null}

                        <Box
                          sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            p: 0.5,
                            borderRadius: 999,
                            bgcolor: 'rgba(0,0,0,.05)',
                            gap: 0.5,
                          }}
                        >
                          {activeNoteFaces.map(face => (
                            <Box
                              key={face}
                              role="button"
                              tabIndex={0}
                              onClick={() => setActiveNoteFace(face)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  setActiveNoteFace(face)
                                }
                              }}
                              sx={{
                                minWidth: 56,
                                px: 1.5,
                                py: 0.75,
                                borderRadius: 999,
                                bgcolor: activeNoteFace === face ? '#111' : 'transparent',
                                color: activeNoteFace === face ? '#fff' : '#374151',
                                fontSize: 12,
                                lineHeight: 1,
                                fontWeight: 700,
                                cursor: 'pointer',
                                userSelect: 'none',
                              }}
                            >
                              {face === 'text' ? '文本' : 'HTML'}
                            </Box>
                          ))}
                        </Box>
                      </Box>
                    ) : null}
                  </Box>

                  {activeNoteLoading ? <Typography color="text.secondary">正在加载笔记...</Typography> : null}
                  {!activeNoteLoading && activeNoteLoadError ? <Typography color="error">{activeNoteLoadError}</Typography> : null}
                  {!activeNoteLoading && !activeNoteLoadError && activeNoteDoc ? (
                    <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {activeNoteEditing ? (
                        <Box
                          sx={{
                            minWidth: 0,
                            width: '100%',
                            mt: 0.5,
                            pb: 0.5,
                            borderBottom: '1px solid',
                            borderColor: 'rgba(0,0,0,.16)',
                          }}
                        >
                          <InputBase
                            value={activeNoteEditTitle}
                            onChange={e => setActiveNoteEditTitle(e.target.value)}
                            placeholder="输入标题"
                            fullWidth
                            inputProps={{ 'aria-label': '编辑笔记标题' }}
                            sx={{
                              fontSize: 28,
                              lineHeight: 1.2,
                              fontWeight: 900,
                              color: '#111',
                              '& input': { p: 0 },
                            }}
                          />
                        </Box>
                      ) : (
                        <Typography sx={{ minWidth: 0, width: '100%', mt: 0.5, fontSize: 28, lineHeight: 1.2, fontWeight: 900, color: '#111' }}>
                          {activeNoteEditTitle || activeNoteDoc?.title || activeNote?.title || '未命名'}
                        </Typography>
                      )}

                      <Box sx={{ width: '100%', display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                        {activeNoteEditing ? (
                          <>
                            {activeNoteEditTags.map(tag => (
                              <Box
                                key={tag}
                                sx={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  minHeight: 30,
                                  pl: 1.25,
                                  pr: 0.5,
                                  borderRadius: 999,
                                  bgcolor: 'rgba(0,0,0,.05)',
                                  color: '#374151',
                                  fontSize: 12,
                                  lineHeight: 1,
                                  fontWeight: 600,
                                  gap: 0.25,
                                }}
                              >
                                <Box component="span">{tag}</Box>
                                <IconButton
                                  size="small"
                                  aria-label={`删除标签 ${tag}`}
                                  onClick={() => handleRemoveActiveNoteTag(tag)}
                                  sx={{
                                    color: 'rgba(0,0,0,.48)',
                                    p: 0.35,
                                    '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
                                  }}
                                >
                                  ×
                                </IconButton>
                              </Box>
                            ))}

                            <Box
                              sx={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                minHeight: 30,
                                pl: 1.25,
                                pr: 0.5,
                                borderRadius: 999,
                                border: '1px solid rgba(0,0,0,.12)',
                                bgcolor: '#fff',
                                gap: 0.25,
                              }}
                            >
                              <InputBase
                                value={activeNoteTagInput}
                                onChange={e => setActiveNoteTagInput(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    handleAddActiveNoteTag()
                                  }
                                }}
                                placeholder="输入标签"
                                inputProps={{ 'aria-label': '输入标签' }}
                                sx={{
                                  minWidth: 88,
                                  fontSize: 12,
                                  lineHeight: 1,
                                  color: '#374151',
                                  '& input': { p: 0 },
                                }}
                              />
                              <IconButton
                                size="small"
                                aria-label="添加标签"
                                onClick={handleAddActiveNoteTag}
                                sx={{
                                  color: 'rgba(0,0,0,.58)',
                                  p: 0.35,
                                  '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
                                }}
                              >
                                <AddRoundedIcon fontSize="inherit" />
                              </IconButton>
                            </Box>
                          </>
                        ) : (activeNoteEditTags || []).length > 0 ? (
                          activeNoteEditTags.map(tag => (
                            <Box
                              key={tag}
                              sx={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                minHeight: 28,
                                px: 1.25,
                                borderRadius: 999,
                                bgcolor: 'rgba(0,0,0,.05)',
                                color: '#374151',
                                fontSize: 12,
                                lineHeight: 1,
                                fontWeight: 600,
                              }}
                            >
                              {tag}
                            </Box>
                          ))
                        ) : (
                          <Typography sx={{ fontSize: 13, lineHeight: 1.5, color: 'rgba(0,0,0,.38)' }}>暂无标签</Typography>
                        )}
                      </Box>

                      {activeNoteFace === 'html' ? activeNoteEditing ? (
                        <InputBase
                          value={activeNoteEditHtml}
                          onChange={e => setActiveNoteEditHtml(e.target.value)}
                          placeholder="输入 HTML 代码..."
                          fullWidth
                          multiline
                          minRows={18}
                          inputProps={{ 'aria-label': '编辑 HTML 正文代码' }}
                          sx={{
                            width: '100%',
                            alignItems: 'flex-start',
                            fontSize: 14,
                            lineHeight: 1.7,
                            color: '#1f2937',
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                            '& textarea': {
                              padding: 0,
                              resize: 'none',
                            },
                          }}
                        />
                      ) : (
                        <AutoHeightHtmlIframe html={activeNoteEditHtml} minHeightPx={240} />
                      ) : activeNoteEditing ? activeNoteTextEditorMode === 'live' ? (
                        <BlockEditor value={activeNoteEditBody} onChange={setActiveNoteEditBody} placeholder="开始编辑正文..." minHeight={400} onBlockRendered={handleBlockRendered} />
                      ) : (
                        <InputBase
                          value={activeNoteEditBody}
                          onChange={e => setActiveNoteEditBody(e.target.value)}
                          placeholder="开始编辑正文..."
                          fullWidth
                          multiline
                          minRows={18}
                          inputProps={{ 'aria-label': '编辑 Markdown 正文源码', spellCheck: false }}
                          sx={{
                            width: '100%',
                            alignItems: 'flex-start',
                            fontSize: 14,
                            lineHeight: 1.7,
                            color: '#1f2937',
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                            '& textarea': { padding: 0, resize: 'none' },
                          }}
                        />
                      ) : (
                        <Box
                          ref={textRenderRef}
                          className="hc-render"
                          sx={{ width: '100%', minHeight: 120 }}
                        />
                      )}

                      {/* 反向链接区域 */}
                      {!activeNoteEditing && activeNote && (() => {
                        const bl = getBacklinksFor(refIndex, activeNote.id)
                        if (!bl.length) return null
                        return (
                          <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid rgba(0,0,0,.08)' }}>
                            <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.42)', mb: 1 }}>
                              被以下笔记引用
                            </Typography>
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                              {bl.map(bid => {
                                const meta = allNotes.find(n => n.id === bid)
                                return (
                                  <Box
                                    key={bid}
                                    component="span"
                                    onClick={() => meta && handleOpenNote(meta)}
                                    sx={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      px: 1.25,
                                      py: 0.5,
                                      borderRadius: 999,
                                      fontSize: 12,
                                      color: '#1976d2',
                                      bgcolor: 'rgba(25,118,210,.06)',
                                      cursor: meta ? 'pointer' : 'default',
                                      transition: 'background 120ms',
                                      '&:hover': meta ? { bgcolor: 'rgba(25,118,210,.12)' } : {},
                                    }}
                                  >
                                    {meta?.title || bid.slice(0, 12) + '…'}
                                  </Box>
                                )
                              })}
                            </Box>
                          </Box>
                        )
                      })()}
                    </Box>
                  ) : null}
                </Box>
              ) : null}
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
