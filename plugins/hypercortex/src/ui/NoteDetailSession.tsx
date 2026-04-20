import * as React from 'react'
import { Box, IconButton, InputBase, Tooltip, Typography } from '@mui/material'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import CodeRoundedIcon from '@mui/icons-material/CodeRounded'
import WysiwygRoundedIcon from '@mui/icons-material/WysiwygRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import InfoRoundedIcon from '@mui/icons-material/InfoRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'

import { createMarkdownRenderEngine } from '../render/engine'
import { HYPERCORTEX_NOTE_SCHEMA_VERSION } from '../noteSchema'
import { renderNoteDisplayHtml } from '../noteRender'
import { extractNoteRefs, getBacklinksFor, type NoteRefIndex } from '../noteRefs'
import { loadHtmlFace, loadNotePackage, saveHtmlFace, saveNotePackage, type HyperCortexHtmlFaceDoc } from '../notePackage'
import { buildNotePlaceholderForCopy } from '../notePlaceholder'
import type { Api, NoteMeta, VaultScope, HyperCortexNoteDoc } from '../core'
import { NoteInfoSidebar } from './NoteInfoSidebar'
import { AutoHeightHtmlIframe } from './AutoHeightHtmlIframe'
import { CodeMirrorCodeEditor } from '../editor/CodeMirrorCodeEditor'
import { HyperCodeMirrorEditor as BlockEditor } from '../editor/HyperCodeMirrorEditor'

type NoteFaceId = 'text' | 'html'
type TextEditorMode = 'source' | 'live'

type NoteContent = {
  title: string
  body: string
  tags: string[]
  html: string
}

function isDraftNoteId(noteId: string): boolean {
  return String(noteId || '').startsWith('draft_')
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

export type NoteDetailSnapshotV1 = {
  doc: HyperCortexNoteDoc | null
  htmlFace: HyperCortexHtmlFaceDoc | null
  base: NoteContent
  editing: boolean
  textEditorMode: TextEditorMode
  face: NoteFaceId
  faces: NoteFaceId[]
  editTitle: string
  editBody: string
  editTags: string[]
  editHtml: string
  infoSidebarVisible: boolean
}

export type NoteDetailSessionHandle = {
  isDirty: () => boolean
  isSaving: () => boolean
  enterEditMode: () => void
  discardChanges: () => void
}

export type NoteDetailSessionProps = {
  api: Api
  scope: VaultScope
  note: NoteMeta
  visible: boolean
  bodyScrollRef?: React.Ref<HTMLDivElement>
  noteIndexMap: Record<string, { title: string }>
  allNotesById: Record<string, NoteMeta>
  refIndex: NoteRefIndex
  consumeInitSnapshot: (noteId: string) => NoteDetailSnapshotV1 | null
  onOpenNote: (note: NoteMeta) => void
  onSaved: (payload: {
    originalId: string
    meta: NoteMeta
    snapshotForNewId?: NoteDetailSnapshotV1
  }) => void
}

export const NoteDetailSession = React.forwardRef<NoteDetailSessionHandle, NoteDetailSessionProps>(function NoteDetailSession(props, ref) {
  const {
    api,
    scope,
    note,
    visible,
    bodyScrollRef,
    noteIndexMap,
    allNotesById,
    refIndex,
    consumeInitSnapshot,
    onOpenNote,
    onSaved,
  } = props

  const noteId = String(note.id || '').trim()
  const isDraft = isDraftNoteId(noteId) || !String(note.dir || '').trim()

  const initRef = React.useRef<NoteDetailSnapshotV1 | null | undefined>(undefined)
  if (initRef.current === undefined) initRef.current = consumeInitSnapshot(noteId)
  const init = initRef.current

  const [doc, setDoc] = React.useState<HyperCortexNoteDoc | null>(init?.doc ?? null)
  const [htmlFace, setHtmlFace] = React.useState<HyperCortexHtmlFaceDoc | null>(init?.htmlFace ?? null)
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  const [editing, setEditing] = React.useState(init?.editing ?? (isDraft ? true : false))
  const [textEditorMode, setTextEditorMode] = React.useState<TextEditorMode>(init?.textEditorMode ?? 'live')
  const [face, setFace] = React.useState<NoteFaceId>(init?.face ?? 'text')
  const [faces, setFaces] = React.useState<NoteFaceId[]>(init?.faces ?? ['text'])
  const [infoSidebarVisible, setInfoSidebarVisible] = React.useState(init?.infoSidebarVisible ?? false)

  const [editTitle, setEditTitle] = React.useState(init?.editTitle ?? (note.title || ''))
  const [editBody, setEditBody] = React.useState(init?.editBody ?? '')
  const [editTags, setEditTags] = React.useState<string[]>(init?.editTags ?? [])
  const [tagInput, setTagInput] = React.useState('')
  const [editHtml, setEditHtml] = React.useState(init?.editHtml ?? '')

  const [addFaceSelectorVisible, setAddFaceSelectorVisible] = React.useState(false)
  const [pendingAddFace, setPendingAddFace] = React.useState<NoteFaceId | null>(null)

  const [base, setBase] = React.useState<NoteContent>(
    init?.base ?? {
      title: note.title || '未命名',
      body: '',
      tags: [],
      html: '',
    },
  )

  const renderEngineRef = React.useRef(createMarkdownRenderEngine({ api, scope }))
  React.useEffect(() => {
    renderEngineRef.current.noteIndex = noteIndexMap
  }, [noteIndexMap])

  const textRenderRef = React.useRef<HTMLDivElement>(null)

  const draftNowRef = React.useMemo<NoteContent>(() => {
    return {
      title: editTitle,
      body: editBody,
      tags: editTags,
      html: editHtml,
    }
  }, [editBody, editHtml, editTags, editTitle])

  const dirty = React.useMemo(() => !isNoteContentEqual(draftNowRef, base), [base, draftNowRef])

  React.useImperativeHandle(ref, () => ({
    isDirty: () => dirty,
    isSaving: () => saving,
    enterEditMode: () => setEditing(true),
    discardChanges: () => {
      setEditTitle(base.title)
      setEditBody(base.body)
      setEditTags(base.tags.slice())
      setEditHtml(base.html)
      setTagInput('')
      setAddFaceSelectorVisible(false)
      setPendingAddFace(null)
      setEditing(false)
    },
  }), [base, dirty, saving])

  const ensureDraftDocIfNeeded = React.useCallback(() => {
    if (!isDraft) return
    if (doc) return
    const now = Date.now()
    const title = String(editTitle || '').trim() || note.title || '未命名'
    const tags = editTags.slice()
    const body = editBody || ''
    setDoc({
      id: noteId,
      packageDir: '',
      title,
      body,
      tags,
      createdAtMs: Number(note.createdAtMs) > 0 ? Number(note.createdAtMs) : now,
      updatedAtMs: Number(note.updatedAtMs) > 0 ? Number(note.updatedAtMs) : now,
      schemaVersion: HYPERCORTEX_NOTE_SCHEMA_VERSION,
      resources: [],
      displayHtml: renderNoteDisplayHtml({ title, body, tags }),
    })
  }, [doc, editBody, editTags, editTitle, isDraft, note.createdAtMs, note.title, note.updatedAtMs, noteId])

  const hasEverActivatedRef = React.useRef(false)
  React.useEffect(() => {
    if (visible) hasEverActivatedRef.current = true
  }, [visible])

  const loadNoteIfNeeded = React.useCallback(async () => {
    if (!noteId) return
    if (isDraft) return ensureDraftDocIfNeeded()
    if (doc) return
    if (!String(note.dir || '').trim()) return

    setLoading(true)
    setLoadError(null)
    try {
      const [loadedDoc, loadedHtml] = await Promise.all([
        loadNotePackage(api, scope, note.dir),
        loadHtmlFace(api, scope, note.dir).catch(() => null),
      ])
      setDoc(loadedDoc)
      setHtmlFace(loadedHtml)

      const nextFaces: NoteFaceId[] = ['text']
      if (loadedHtml && loadedHtml.exists) nextFaces.push('html')
      setFaces(nextFaces)

      const nextBase: NoteContent = {
        title: loadedDoc.title || note.title || '未命名',
        body: loadedDoc.body || '',
        tags: (loadedDoc.tags || []).slice(),
        html: loadedHtml?.html || '',
      }
      setBase(nextBase)

      setEditTitle(nextBase.title)
      setEditBody(nextBase.body)
      setEditTags(nextBase.tags.slice())
      setEditHtml(nextBase.html)
      setTagInput('')
    } catch (e: any) {
      setLoadError(String(e?.message || e || '加载笔记失败'))
    } finally {
      setLoading(false)
    }
  }, [api, doc, ensureDraftDocIfNeeded, isDraft, note.dir, note.title, noteId, scope])

  React.useEffect(() => {
    if (!hasEverActivatedRef.current) return
    void loadNoteIfNeeded()
  }, [loadNoteIfNeeded])

  React.useEffect(() => {
    if (!visible) return
    void loadNoteIfNeeded()
  }, [loadNoteIfNeeded, visible])

  React.useLayoutEffect(() => {
    if (!visible) return
    if (face !== 'text' || editing || !textRenderRef.current) return
    renderEngineRef.current.renderInto(textRenderRef.current, editBody || '')
  }, [editBody, editing, face, noteIndexMap, visible])

  React.useEffect(() => {
    const el = textRenderRef.current
    if (!el) return
    const handler = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null
      const link = target?.closest?.('.hc-note-ref') as HTMLElement | null
      if (!link) return
      const targetId = String(link.getAttribute('data-note-id') || '').trim()
      if (!targetId) return
      e.preventDefault()
      const meta = allNotesById[targetId]
      if (meta) onOpenNote(meta)
    }
    el.addEventListener('click', handler)
    return () => el.removeEventListener('click', handler)
  }, [allNotesById, onOpenNote])

  const outgoingIds = React.useMemo(() => {
    if (!infoSidebarVisible) return []
    const body = face === 'text' ? editBody : (doc?.body || editBody || '')
    return extractNoteRefs(body)
  }, [doc?.body, editBody, face, infoSidebarVisible])

  const backlinkIds = React.useMemo(() => {
    if (!noteId) return []
    return getBacklinksFor(refIndex, noteId)
  }, [noteId, refIndex])

  const toggleTextEditorMode = React.useCallback(() => {
    setTextEditorMode(prev => (prev === 'source' ? 'live' : 'source'))
  }, [])

  const handleAddTag = React.useCallback(() => {
    setEditTags(prev => appendTag(prev, tagInput))
    setTagInput('')
  }, [tagInput])

  const handleRemoveTag = React.useCallback((tag: string) => {
    setEditTags(prev => prev.filter(item => item !== tag))
  }, [])

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

  const handleToggleMode = React.useCallback(() => {
    if (!doc) return
    setEditing(prev => !prev)
  }, [doc])

  const handleDiscard = React.useCallback(() => {
    if (saving) return
    setEditTitle(base.title)
    setEditBody(base.body)
    setEditTags(base.tags.slice())
    setEditHtml(base.html)
    setTagInput('')
    setAddFaceSelectorVisible(false)
    setPendingAddFace(null)
    setTextEditorMode('live')
    setEditing(false)
  }, [base, saving])

  const handleSave = React.useCallback(async () => {
    if (!noteId) return
    if (saving) return
    setSaving(true)
    try {
      const originalId = noteId
      const title = String(editTitle || '').trim() || '未命名'
      const body = String(editBody || '').replace(/\r\n/g, '\n')
      const tags = editTags.map(normalizeTagText).filter(Boolean)

      let nextMeta: NoteMeta
      let nextDoc: HyperCortexNoteDoc | null = doc
      let nextHtmlFace: HyperCortexHtmlFaceDoc | null = htmlFace
      let toastMsg: string

      if (face === 'html') {
        const result = await saveHtmlFace(api, scope, {
          id: isDraft ? undefined : originalId,
          packageDir: isDraft ? undefined : note.dir,
          title,
          body: doc?.body || '',
          tags,
          createdAtMs: note.createdAtMs,
          resources: doc?.resources || [],
          html: editHtml,
        })
        nextMeta = result.meta
        nextHtmlFace = result.htmlFace
        setHtmlFace(nextHtmlFace)
        setFaces(prev => (prev.includes('html') ? prev : [...prev, 'html']))
        if (nextDoc) {
          nextDoc = { ...nextDoc, id: nextMeta.id, packageDir: nextMeta.dir, title, tags, updatedAtMs: nextMeta.updatedAtMs }
          setDoc(nextDoc)
        }
        toastMsg = 'HTML 面已保存'
      } else {
        const result = await saveNotePackage(api, scope, {
          id: isDraft ? undefined : originalId,
          title,
          body,
          tags,
          createdAtMs: note.createdAtMs,
          resources: doc?.resources || [],
          saveTextFace: true,
        })
        nextMeta = result.meta
        nextDoc = result.doc
        setDoc(nextDoc)
        setEditBody(nextDoc.body)
        toastMsg = '笔记已保存'
      }

      const nextBase: NoteContent = {
        title,
        body: base.body,
        tags: tags.slice(),
        html: base.html,
      }
      if (face === 'text') nextBase.body = body
      if (face === 'html') nextBase.html = editHtml
      setBase(nextBase)

      const didMigrateId = isDraft && nextMeta.id !== originalId
      const snapshotForNewId: NoteDetailSnapshotV1 | undefined = didMigrateId ? {
        doc: nextDoc ? { ...nextDoc, id: nextMeta.id, packageDir: nextMeta.dir } : null,
        htmlFace: nextHtmlFace ? { ...nextHtmlFace, id: nextMeta.id, packageDir: nextMeta.dir } : null,
        base: nextBase,
        editing,
        textEditorMode,
        face,
        faces: (faces.includes('html') || face === 'html') ? (faces.includes('html') ? faces : [...faces, 'html']) : faces,
        editTitle: title,
        editBody: face === 'text' ? body : editBody,
        editTags: tags.slice(),
        editHtml,
        infoSidebarVisible,
      } : undefined

      onSaved({ originalId, meta: nextMeta, snapshotForNewId })
      await api.ui.showToast(toastMsg)
    } catch (e: any) {
      await api.ui.showToast(String(e?.message || e || '保存失败'))
    } finally {
      setSaving(false)
    }
  }, [api, base.body, base.html, doc, editBody, editHtml, editTags, editTitle, editing, face, faces, htmlFace, infoSidebarVisible, isDraft, note.createdAtMs, note.dir, noteId, onSaved, saving, scope, textEditorMode])

  const handleAddFace = React.useCallback(async () => {
    if (!pendingAddFace) return
    if (pendingAddFace === 'html') {
      if (!doc) return
      let nextHtml = ''
      if (!isDraft && String(note.dir || '').trim()) {
        try {
          const loaded = await loadHtmlFace(api, scope, note.dir)
          nextHtml = loaded.html || ''
          setHtmlFace(loaded)
        } catch {
          nextHtml = ''
        }
      }
      setEditHtml(nextHtml)
      setFaces(prev => (prev.includes('html') ? prev : [...prev, 'html']))
      setFace('html')
      setEditing(true)
    }
    setAddFaceSelectorVisible(false)
    setPendingAddFace(null)
  }, [api, doc, isDraft, note.dir, pendingAddFace, scope])

  if (!noteId) return null

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        display: visible ? 'flex' : 'none',
        flexDirection: 'column',
        gap: 2.5,
        p: 2,
        boxSizing: 'border-box',
      }}
    >
      <Box sx={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flex: '0 0 auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {!loading && !loadError && doc ? (
            <Tooltip title={editing ? '切到阅读模式' : '切到编辑模式'} placement="bottom-start">
              <IconButton
                size="small"
                aria-label={editing ? '切换到阅读模式' : '切换到编辑模式'}
                onClick={handleToggleMode}
                disabled={saving}
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
                {editing ? <WysiwygRoundedIcon fontSize="small" /> : <EditRoundedIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          ) : null}

          {!loading && !loadError && doc ? (
            <Tooltip title="保存" placement="bottom-start">
              <IconButton
                size="small"
                aria-label="保存笔记"
                onClick={() => void handleSave()}
                disabled={saving || (!dirty && !isDraft)}
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

          {!loading && !loadError && doc && dirty ? (
            <Tooltip title="放弃改动（回到已保存状态）" placement="bottom-start">
              <IconButton
                size="small"
                aria-label="放弃未保存改动"
                onClick={handleDiscard}
                disabled={saving}
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

          {!loading && !loadError && doc && editing && face === 'text' ? (
            <Tooltip title={textEditorMode === 'source' ? '切换到 Live 编辑' : '切换到 源码编辑'} placement="bottom-start">
              <IconButton
                size="small"
                aria-label={textEditorMode === 'source' ? '切换到 Live 编辑' : '切换到 源码编辑'}
                onClick={toggleTextEditorMode}
                disabled={saving}
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
                {textEditorMode === 'source' ? <WysiwygRoundedIcon fontSize="small" /> : <CodeRoundedIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          ) : null}

          {dirty ? (
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

        {!loading && !loadError && doc ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Tooltip title="复制引用占位符" placement="bottom-end">
              <IconButton
                size="small"
                aria-label="复制引用占位符"
                onClick={() => {
                  void api.clipboard.writeText(buildNotePlaceholderForCopy(doc.id, editTitle || doc.title || note.title || ''))
                  void api.ui.showToast('已复制引用占位符')
                }}
                sx={{
                  color: 'rgba(0,0,0,.58)',
                  bgcolor: 'transparent',
                  '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
                }}
              >
                <ContentCopyRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title={infoSidebarVisible ? '隐藏信息侧栏' : '显示信息侧栏'} placement="bottom-end">
              <IconButton
                size="small"
                aria-label="笔记信息"
                onClick={() => setInfoSidebarVisible(prev => !prev)}
                sx={{
                  color: infoSidebarVisible ? '#111' : 'rgba(0,0,0,.58)',
                  bgcolor: infoSidebarVisible ? 'rgba(0,0,0,.06)' : 'transparent',
                  '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
                }}
              >
                <InfoRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title="新增面" placement="bottom-end">
              <IconButton
                size="small"
                aria-label="新增面"
                onClick={() => setAddFaceSelectorVisible(prev => !prev)}
                sx={{
                  color: 'rgba(0,0,0,.58)',
                  bgcolor: 'transparent',
                  '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
                }}
              >
                <AddRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            {addFaceSelectorVisible ? (
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
                {!faces.includes('html') ? (
                  <Box
                    role="button"
                    tabIndex={0}
                    onClick={() => setPendingAddFace('html')}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setPendingAddFace('html')
                      }
                    }}
                    sx={{
                      minWidth: 56,
                      px: 1.5,
                      py: 0.75,
                      borderRadius: 999,
                      bgcolor: pendingAddFace === 'html' ? '#111' : 'transparent',
                      color: pendingAddFace === 'html' ? '#fff' : '#374151',
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
                  onClick={() => void handleAddFace()}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      void handleAddFace()
                    }
                  }}
                  sx={{
                    minWidth: 56,
                    px: 1.5,
                    py: 0.75,
                    borderRadius: 999,
                    bgcolor: '#fff',
                    color: pendingAddFace ? '#111' : 'rgba(0,0,0,.32)',
                    fontSize: 12,
                    lineHeight: 1,
                    fontWeight: 700,
                    cursor: pendingAddFace ? 'pointer' : 'default',
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
              {faces.map(f => (
                <Box
                  key={f}
                  role="button"
                  tabIndex={0}
                  onClick={() => setFace(f)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setFace(f)
                    }
                  }}
                  sx={{
                    minWidth: 56,
                    px: 1.5,
                    py: 0.75,
                    borderRadius: 999,
                    bgcolor: face === f ? '#111' : 'transparent',
                    color: face === f ? '#fff' : '#374151',
                    fontSize: 12,
                    lineHeight: 1,
                    fontWeight: 700,
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  {f === 'text' ? '文本' : 'HTML'}
                </Box>
              ))}
            </Box>
          </Box>
        ) : null}
      </Box>

      {loading ? <Typography color="text.secondary">正在加载笔记...</Typography> : null}
      {!loading && loadError ? <Typography color="error">{loadError}</Typography> : null}

      {!loading && !loadError && doc ? (
        <Box sx={{ width: '100%', flex: 1, minHeight: 0, display: 'flex', minWidth: 0, gap: 2, alignItems: 'stretch' }}>
          <Box ref={bodyScrollRef} sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', overscrollBehavior: 'contain' }}>
            <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {editing ? (
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
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
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
                {editTitle || doc?.title || note.title || '未命名'}
              </Typography>
            )}

            <Box sx={{ width: '100%', display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
              {editing ? (
                <>
                  {editTags.map(tag => (
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
                        onClick={() => handleRemoveTag(tag)}
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
                      value={tagInput}
                      onChange={e => setTagInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleAddTag()
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
                      onClick={handleAddTag}
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
              ) : (editTags || []).length > 0 ? (
                editTags.map(tag => (
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

            {face === 'html' ? editing ? (
              <CodeMirrorCodeEditor
                value={editHtml}
                onChange={setEditHtml}
                placeholder="输入 HTML 代码..."
                minHeight={420}
                active={visible}
                ariaLabel="编辑 HTML 正文代码"
                lineWrapping
                mode="html"
              />
            ) : (
              <AutoHeightHtmlIframe html={editHtml} minHeightPx={240} />
            ) : editing ? textEditorMode === 'live' ? (
              <BlockEditor value={editBody} onChange={setEditBody} placeholder="开始编辑正文..." minHeight={400} onBlockRendered={handleBlockRendered} active={visible} />
            ) : (
              <InputBase
                value={editBody}
                onChange={e => setEditBody(e.target.value)}
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
              <Box ref={textRenderRef} className="hc-render" sx={{ width: '100%', minHeight: 120 }} />
            )}

            {!infoSidebarVisible && !editing && note && (() => {
              const bl = backlinkIds
              const entries = bl
                .map(bid => ({ bid, meta: allNotesById[bid] }))
                .filter(item => !!item.meta)
              if (!entries.length) return null
              return (
                <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid rgba(0,0,0,.08)' }}>
                  <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.42)', mb: 1 }}>
                    被以下笔记引用
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                    {entries.map(({ bid, meta }) => {
                      return (
                        <Box
                          key={bid}
                          component="span"
                          onClick={() => onOpenNote(meta as NoteMeta)}
                          sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            px: 1.25,
                            py: 0.5,
                            borderRadius: 999,
                            fontSize: 12,
                            color: '#1976d2',
                            bgcolor: 'rgba(25,118,210,.06)',
                            cursor: 'pointer',
                            transition: 'background 120ms',
                            '&:hover': { bgcolor: 'rgba(25,118,210,.12)' },
                          }}
                        >
                          {(meta as NoteMeta).title || bid.slice(0, 12) + '…'}
                        </Box>
                      )
                    })}
                  </Box>
                </Box>
              )
            })()}
            </Box>
          </Box>

          {infoSidebarVisible ? (
            <Box sx={{ flex: '0 0 280px', width: 280, minWidth: 280, minHeight: 0, overflow: 'auto', overscrollBehavior: 'contain' }}>
              <NoteInfoSidebar
                noteId={doc.id}
                createdAtMs={doc.createdAtMs}
                updatedAtMs={doc.updatedAtMs}
                outgoingIds={outgoingIds}
                backlinkIds={backlinkIds}
                resolveTitle={id => allNotesById[id]?.title}
                canOpenId={id => !!allNotesById[id]}
                onOpenId={id => {
                  const meta = allNotesById[id]
                  if (meta) onOpenNote(meta)
                }}
              />
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Box>
  )
})
