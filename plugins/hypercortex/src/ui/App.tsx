import * as React from 'react'
import { AppBar, Box, CssBaseline, GlobalStyles, IconButton, InputBase, ThemeProvider, Toolbar, Tooltip, Typography, createTheme } from '@mui/material'
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
import { ensureMetadata, getApi, saveMetadata, tryLoadMetadata, type HyperCortexNoteDoc, type NoteMeta } from '../core'
import { loadHtmlFace, loadNoteIndex, loadNotePackage, saveHtmlFace, saveNotePackage } from '../notePackage'
import { loadRefIndex, getBacklinksFor, type NoteRefIndex } from '../noteRefs'
import { createMarkdownRenderEngine } from '../render/engine'
import { AutoHeightHtmlIframe } from './AutoHeightHtmlIframe'
import { AssetPoolPanel } from './AssetPoolPanel'

type PageId = 'home' | 'new-note' | 'attachments' | 'all-notes' | 'note-detail' | 'index' | 'settings'

type AllNotesLayout = 'list' | 'grid' | 'icon'
type NoteFaceId = 'text' | 'html'
type TextEditorMode = 'source' | 'live'

type ActiveNoteEditSnapshot = {
  face: NoteFaceId
  faces: NoteFaceId[]
  title: string
  body: string
  tags: string[]
  html: string
}

function normalizeAllNotesLayout(value: unknown): AllNotesLayout {
  return value === 'grid' || value === 'icon' ? value : 'list'
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

export function HyperCortexApp() {
  const api = React.useMemo(() => getApi(), [])
  const [page, setPage] = React.useState<PageId>('home')
  const [newNoteTitle, setNewNoteTitle] = React.useState('新建笔记')
  const [newNoteContent, setNewNoteContent] = React.useState('')
  const [newNoteSaving, setNewNoteSaving] = React.useState(false)
  const [savedNote, setSavedNote] = React.useState<{ id: string; dir: string; createdAtMs: number } | null>(null)
  const [allNotesLayout, setAllNotesLayout] = React.useState<AllNotesLayout>('list')
  const [allNotes, setAllNotes] = React.useState<NoteMeta[]>([])
  const [allNotesLoading, setAllNotesLoading] = React.useState(false)
  const [allNotesLoadError, setAllNotesLoadError] = React.useState<string | null>(null)
  const [allNotesLayoutReady, setAllNotesLayoutReady] = React.useState(false)
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
  const activeNoteEditSnapshotRef = React.useRef<ActiveNoteEditSnapshot | null>(null)

  const renderEngineRef = React.useRef(createMarkdownRenderEngine({ api, scope: 'library' }))
  ;(window as any).__hcRenderEngine = renderEngineRef.current
  const textRenderRef = React.useRef<HTMLDivElement>(null)
  const [refIndex, setRefIndex] = React.useState<NoteRefIndex>({})

  React.useLayoutEffect(() => {
    if (activeNoteFace !== 'text' || activeNoteEditing || !textRenderRef.current || !activeNoteDoc) return
    renderEngineRef.current.renderInto(textRenderRef.current, activeNoteDoc.body)
  }, [activeNoteFace, activeNoteEditing, activeNoteDoc])

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
    setAllNotesLayout(prev => (prev === 'list' ? 'grid' : prev === 'grid' ? 'icon' : 'list'))
  }, [])

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
        setAllNotesLayout(normalizeAllNotesLayout(meta.allNotesLayout))
      } catch {
      } finally {
        setAllNotesLayoutReady(true)
      }
    })()
  }, [api])

  React.useEffect(() => {
    if (!allNotesLayoutReady) return
    void saveMetadata(api, { version: 1, allNotesLayout }).catch(() => {})
  }, [api, allNotesLayout, allNotesLayoutReady])

  React.useEffect(() => {
    if (page !== 'all-notes') return
    void loadAllNotes()
  }, [loadAllNotes, page])

  const handleSaveNewNote = React.useCallback(async () => {
    if (newNoteSaving) return
    setNewNoteSaving(true)
    try {
      const scope = 'library' as const
      const title = String(newNoteTitle || '').trim() || '未命名'
      const body = String(newNoteContent || '').replace(/\r\n/g, '\n')
      const existing = savedNote
      const result = await saveNotePackage(api, scope, {
        id: existing?.id,
        title,
        body,
        tags: [],
        createdAtMs: existing?.createdAtMs,
        saveTextFace: true,
      })

      setSavedNote({ id: result.meta.id, dir: result.meta.dir, createdAtMs: result.meta.createdAtMs })
      setAllNotes(prev => sortNotes([result.meta, ...prev.filter(item => item.id !== result.meta.id)]))
      await api.ui.showToast('笔记已保存')
    } catch (e: any) {
      await api.ui.showToast(String(e?.message || e || '保存失败'))
    } finally {
      setNewNoteSaving(false)
    }
  }, [api, newNoteContent, newNoteSaving, newNoteTitle, savedNote, sortNotes])

  const handleOpenNote = React.useCallback(
    async (note: NoteMeta) => {
      setActiveNote(note)
      setActiveNoteDoc(null)
      setActiveNoteLoadError(null)
      setActiveNoteLoading(true)
      setActiveNoteFace('text')
      setActiveNoteFaces(['text'])
      setActiveNoteAddFaceSelectorVisible(false)
      setActiveNotePendingAddFace(null)
      setPage('note-detail')
      try {
        const [doc, htmlFace] = await Promise.all([
          loadNotePackage(api, 'library', note.dir),
          loadHtmlFace(api, 'library', note.dir).catch(() => null),
        ])
        setActiveNoteDoc(doc)
        setActiveNoteEditHtml(htmlFace?.html || '')
        setActiveNoteFaces(htmlFace?.exists ? ['text', 'html'] : ['text'])
      } catch (e: any) {
        const message = String(e?.message || e || '加载笔记失败')
        setActiveNoteLoadError(message)
        await api.ui.showToast(message)
      } finally {
        setActiveNoteLoading(false)
      }
    },
    [api],
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

  const prepareEditFields = React.useCallback((): boolean => {
    if (!activeNoteDoc || !activeNote) return false
    setActiveNoteEditTitle(activeNoteDoc.title || activeNote.title || '未命名')
    setActiveNoteEditBody(activeNoteDoc.body || '')
    setActiveNoteEditTags(activeNoteDoc.tags || [])
    setActiveNoteTagInput('')
    return true
  }, [activeNote, activeNoteDoc])

  const handleStartEditingActiveNote = React.useCallback(async () => {
    if (!activeNoteDoc || !activeNote) return

    const title = activeNoteDoc.title || activeNote.title || '未命名'
    const body = activeNoteDoc.body || ''
    const tags = activeNoteDoc.tags || []

    let html = activeNoteEditHtml
    if (activeNoteFace === 'html') {
      try {
        const htmlFace = await loadHtmlFace(api, 'library', activeNote.dir)
        html = htmlFace.html || ''
      } catch {
        // keep current html (preview state) on failure
      }
    }

    activeNoteEditSnapshotRef.current = { face: activeNoteFace, faces: activeNoteFaces, title, body, tags, html }
    setActiveNoteEditTitle(title)
    setActiveNoteEditBody(body)
    setActiveNoteEditTags(tags)
    setActiveNoteTagInput('')
    if (activeNoteFaces.includes('html')) setActiveNoteEditHtml(html)
    setActiveNoteTextEditorMode('live')
    setActiveNoteEditing(true)
  }, [activeNote, activeNoteDoc, activeNoteEditHtml, activeNoteFace, activeNoteFaces, api])

  const toggleActiveNoteTextEditorMode = React.useCallback(() => {
    setActiveNoteTextEditorMode(prev => (prev === 'source' ? 'live' : 'source'))
  }, [])

  const handleCancelEditingActiveNote = React.useCallback(() => {
    if (activeNoteSaving) return
    const snapshot = activeNoteEditSnapshotRef.current
    if (snapshot) {
      setActiveNoteFace(snapshot.face)
      setActiveNoteFaces(snapshot.faces)
      setActiveNoteEditTitle(snapshot.title)
      setActiveNoteEditBody(snapshot.body)
      setActiveNoteEditTags(snapshot.tags)
      setActiveNoteEditHtml(snapshot.html)
      setActiveNoteTagInput('')
      setActiveNoteAddFaceSelectorVisible(false)
      setActiveNotePendingAddFace(null)
    } else {
      prepareEditFields()
    }
    activeNoteEditSnapshotRef.current = null
    setActiveNoteEditing(false)
  }, [activeNoteSaving, prepareEditFields])

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
      setActiveNoteEditTitle(title)
      setActiveNoteEditTags(tags)
      setActiveNoteTagInput('')
      setActiveNoteEditing(false)
      activeNoteEditSnapshotRef.current = null
      await api.ui.showToast(toastMsg)
    } catch (e: any) {
      await api.ui.showToast(String(e?.message || e || '保存失败'))
    } finally {
      setActiveNoteSaving(false)
    }
  }, [activeNote, activeNoteDoc?.body, activeNoteDoc?.resources, activeNoteEditBody, activeNoteEditHtml, activeNoteEditTags, activeNoteEditTitle, activeNoteFace, activeNoteSaving, api, sortNotes])

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

      const snapTitle = activeNoteDoc.title || activeNote.title || '未命名'
      const snapBody = activeNoteDoc.body || ''
      const snapTags = activeNoteDoc.tags || []
      activeNoteEditSnapshotRef.current = {
        face: activeNoteFace,
        faces: activeNoteFaces,
        title: snapTitle,
        body: snapBody,
        tags: snapTags,
        html: activeNoteEditHtml,
      }

      if (!prepareEditFields()) return
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
  }, [activeNote, activeNoteDoc, activeNoteEditHtml, activeNoteFace, activeNoteFaces, activeNotePendingAddFace, api, prepareEditFields])

  const handleCloseActiveNote = React.useCallback(() => {
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
    activeNoteEditSnapshotRef.current = null
  }, [])

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
              pr: 1,
              '&.MuiToolbar-root': { minHeight: 40, paddingLeft: 0, paddingRight: 8 },
              WebkitAppRegion: 'drag',
            }}
            onPointerDown={onTopbarPointerDown}
          >
            <IconButton
              onClick={backToHost}
              size="small"
              aria-label="返回主界面"
              data-tauri-drag-region="false"
              sx={{ WebkitAppRegion: 'no-drag', ml: 0.25 }}
            >
              <ArrowBackRoundedIcon fontSize="small" />
            </IconButton>

            <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
              HyperCortex
            </Typography>

            <Box sx={{ flex: 1 }} />
          </Toolbar>
        </AppBar>

        <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <Box
            sx={{
              width: 52,
              py: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 0.5,
            }}
          >
            <Tooltip title="主页" placement="right">
              <IconButton
                size="small"
                aria-label="主页"
                onClick={() => setPage('home')}
                sx={{
                  borderRadius: 2,
                  bgcolor: page === 'home' ? 'rgba(25,118,210,.10)' : 'transparent',
                  '&:hover': { bgcolor: page === 'home' ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
                }}
              >
                <HomeRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title="新建笔记" placement="right">
              <IconButton
                size="small"
                aria-label="新建笔记"
                onClick={() => {
                  setActiveNoteTextEditorMode('live')
                  setPage('new-note')
                }}
                sx={{
                  borderRadius: 2,
                  bgcolor: page === 'new-note' ? 'rgba(25,118,210,.10)' : 'transparent',
                  '&:hover': { bgcolor: page === 'new-note' ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
                }}
              >
                <AddRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title="索引" placement="right">
              <IconButton
                size="small"
                aria-label="索引"
                onClick={() => setPage('index')}
                sx={{
                  borderRadius: 2,
                  bgcolor: page === 'index' ? 'rgba(25,118,210,.10)' : 'transparent',
                  '&:hover': { bgcolor: page === 'index' ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
                }}
              >
                <AccountTreeRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title="附件" placement="right">
              <IconButton
                size="small"
                aria-label="附件"
                onClick={() => setPage('attachments')}
                sx={{
                  borderRadius: 2,
                  bgcolor: page === 'attachments' ? 'rgba(25,118,210,.10)' : 'transparent',
                  '&:hover': { bgcolor: page === 'attachments' ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
                }}
              >
                <AttachFileRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title="全部笔记" placement="right">
              <IconButton
                size="small"
                aria-label="全部笔记"
                onClick={() => setPage('all-notes')}
                sx={{
                  borderRadius: 2,
                  bgcolor: page === 'all-notes' ? 'rgba(25,118,210,.10)' : 'transparent',
                  '&:hover': { bgcolor: page === 'all-notes' ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
                }}
              >
                <NotesRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title="设置" placement="right">
              <IconButton
                size="small"
                aria-label="设置"
                onClick={() => setPage('settings')}
                sx={{
                  borderRadius: 2,
                  bgcolor: page === 'settings' ? 'rgba(25,118,210,.10)' : 'transparent',
                  '&:hover': { bgcolor: page === 'settings' ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
                }}
              >
                <SettingsRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Box sx={{ flex: 1 }} />
          </Box>

          <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' }}>
            <Box sx={{ minHeight: '100%', p: 2 }}>
              {page === 'home' ? <Typography color="text.secondary">这是主页页面。</Typography> : null}
              {page === 'new-note' ? (
                <Box sx={{ minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                    <Box
                      sx={{
                        width: '100%',
                        maxWidth: 240,
                        pb: 0.5,
                        borderBottom: '1px solid',
                        borderColor: 'rgba(0,0,0,.16)',
                      }}
                    >
                      <InputBase
                        value={newNoteTitle}
                        onChange={e => setNewNoteTitle(e.target.value)}
                        placeholder="输入标题"
                        fullWidth
                        inputProps={{ 'aria-label': '笔记标题' }}
                        sx={{
                          fontSize: 28,
                          lineHeight: 1.2,
                          fontWeight: 900,
                          color: '#111',
                          '& input': {
                            p: 0,
                          },
                        }}
                      />
                    </Box>

                    <Tooltip title="保存" placement="right">
                      <IconButton
                        size="small"
                        aria-label="保存笔记"
                        onClick={() => void handleSaveNewNote()}
                        disabled={newNoteSaving}
                        sx={{
                          color: 'rgba(0,0,0,.58)',
                          bgcolor: 'transparent',
                          boxShadow: 'none',
                          border: 0,
                          transition: 'background-color .16s ease, color .16s ease',
                          '&:hover': {
                            bgcolor: 'rgba(0,0,0,.06)',
                            color: '#111',
                          },
                          '&.Mui-disabled': {
                            color: 'rgba(0,0,0,.28)',
                          },
                        }}
                      >
                        <SaveRoundedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={activeNoteTextEditorMode === 'source' ? '切换到 Live 编辑' : '切换到 源码编辑'} placement="right">
                      <IconButton
                        size="small"
                        aria-label={activeNoteTextEditorMode === 'source' ? '切换到 Live 编辑' : '切换到 源码编辑'}
                        onClick={toggleActiveNoteTextEditorMode}
                        disabled={newNoteSaving}
                        sx={{
                          color: 'rgba(0,0,0,.58)',
                          bgcolor: 'transparent',
                          boxShadow: 'none',
                          border: 0,
                          transition: 'background-color .16s ease, color .16s ease',
                          '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
                          '&.Mui-disabled': { color: 'rgba(0,0,0,.28)' },
                        }}
                      >
                        {activeNoteTextEditorMode === 'source' ? <WysiwygRoundedIcon fontSize="small" /> : <CodeRoundedIcon fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                  </Box>

                  <Box sx={{ mt: 2, width: '100%', flex: 1 }}>
                    {activeNoteTextEditorMode === 'live' ? (
                      <BlockEditor value={newNoteContent} onChange={setNewNoteContent} placeholder="开始输入正文..." minHeight={280} />
                    ) : (
                      <InputBase
                        value={newNoteContent}
                        onChange={e => setNewNoteContent(e.target.value)}
                        placeholder="开始输入正文..."
                        fullWidth
                        multiline
                        minRows={14}
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
                    )}
                  </Box>
                </Box>
              ) : null}
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
                      <IconButton
                        size="small"
                        aria-label="返回全部笔记"
                        onClick={handleCloseActiveNote}
                        sx={{
                          color: '#111',
                          flex: '0 0 auto',
                          ml: -0.75,
                          '&:hover': { bgcolor: 'rgba(0,0,0,.06)' },
                        }}
                      >
                        <ArrowBackRoundedIcon fontSize="small" />
                      </IconButton>

                      {!activeNoteLoading && !activeNoteLoadError && activeNoteDoc ? (
                        <Tooltip title={activeNoteEditing ? '保存' : '编辑'} placement="bottom-start">
                          <IconButton
                            size="small"
                            aria-label={activeNoteEditing ? '保存笔记' : '编辑笔记'}
                            onClick={() => void (activeNoteEditing ? handleSaveActiveNote() : handleStartEditingActiveNote())}
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
                            {activeNoteEditing ? <SaveRoundedIcon fontSize="small" /> : <EditRoundedIcon fontSize="small" />}
                          </IconButton>
                        </Tooltip>
                      ) : null}
                      {!activeNoteLoading && !activeNoteLoadError && activeNoteDoc && activeNoteEditing ? (
                        <Tooltip title="取消" placement="bottom-start">
                          <IconButton
                            size="small"
                            aria-label="取消编辑并返回预览"
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
                          {activeNoteDoc?.title || activeNote?.title || '未命名'}
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
                        ) : (activeNoteDoc.tags || []).length > 0 ? (
                          activeNoteDoc.tags.map(tag => (
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
    </ThemeProvider>
  )
}
