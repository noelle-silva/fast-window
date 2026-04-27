import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, InputBase, Menu, MenuItem, Tooltip, Typography } from '@mui/material'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import FullscreenRoundedIcon from '@mui/icons-material/FullscreenRounded'
import CodeRoundedIcon from '@mui/icons-material/CodeRounded'
import WysiwygRoundedIcon from '@mui/icons-material/WysiwygRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import InfoRoundedIcon from '@mui/icons-material/InfoRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import TuneRoundedIcon from '@mui/icons-material/TuneRounded'

import { createMarkdownRenderEngine } from '../render/engine'
import { HYPERCORTEX_NOTE_SCHEMA_VERSION } from '../noteSchema'
import { renderNoteDisplayHtml } from '../noteRender'
import { extractNoteRefs, getBacklinksFor, type NoteRefIndex } from '../noteRefs'
import { buildNotePlaceholderForCopy } from '../notePlaceholder'
import type { NoteMeta, VaultScope, HyperCortexNoteDoc, HyperCortexHtmlFaceDisplayModeV1 } from '../core'
import type { HyperCortexGateway, HyperCortexHtmlFaceDoc } from '../gateway'
import { HTML_FACE_KIND, createDefaultFaceManifest, isHtmlFace, labelForFaceKind, type HyperCortexNoteFaceManifestV2 } from '../noteFaces'
import { isDraftNoteId } from '../drafts'
import { NoteInfoSidebar } from './NoteInfoSidebar'
import { HtmlFaceIframe } from './HtmlFaceIframe'
import { CodeMirrorCodeEditor } from '../editor/CodeMirrorCodeEditor'
import { HyperCodeMirrorEditor as BlockEditor } from '../editor/HyperCodeMirrorEditor'
import { ImageDialog } from './preview/ImageDialog'
import { MermaidDialog } from './preview/MermaidDialog'
import { HtmlFaceFullscreenDialog } from './preview/HtmlFaceFullscreenDialog'
import { ensurePreviewClickHandlerOnce } from './preview/ensurePreviewClickHandlerOnce'
import { ensureLiveEditorPreviewButton } from './preview/ensureLiveEditorPreviewButton'
import { usePreviewController } from './preview/usePreviewController'

type NoteFaceId = string
type TextEditorMode = 'source' | 'live'

type NoteContent = {
  title: string
  description: string
  body: string
  tags: string[]
  html: string
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
  return a.title === b.title && a.description === b.description && a.body === b.body && a.html === b.html && areStringListsEqual(a.tags, b.tags)
}

function isHtmlFaceId(faceId: string, faces: Record<string, HyperCortexNoteFaceManifestV2>): boolean {
  return isHtmlFace(faces[String(faceId || '').trim()])
}

function isTextFaceId(faceId: string, faces: Record<string, HyperCortexNoteFaceManifestV2>): boolean {
  return faces[String(faceId || '').trim()]?.kind === 'markdown'
}

function faceLabel(faceId: string, faces: Record<string, HyperCortexNoteFaceManifestV2>): string {
  const manifest = faces[String(faceId || '').trim()]
  if (!manifest) return String(faceId || '').trim() || '未知'
  return String(manifest.title || '').trim() || labelForFaceKind(manifest.kind)
}

function normalizeFaceOrder(faceOrder: string[], faces: Record<string, HyperCortexNoteFaceManifestV2>): string[] {
  const out: string[] = []
  for (const id of faceOrder || []) {
    const faceId = String(id || '').trim()
    if (!faceId || !faces[faceId] || out.includes(faceId)) continue
    out.push(faceId)
  }
  for (const faceId of Object.keys(faces)) {
    if (out.includes(faceId)) continue
    out.push(faceId)
  }
  return out
}

export type NoteDetailSnapshotV1 = {
  doc: HyperCortexNoteDoc | null
  htmlFace: HyperCortexHtmlFaceDoc | null
  faceManifests: Record<string, HyperCortexNoteFaceManifestV2>
  base: NoteContent
  editing: boolean
  textEditorMode: TextEditorMode
  face: NoteFaceId
  faces: NoteFaceId[]
  editTitle: string
  editDescription: string
  editBody: string
  editTags: string[]
  editHtml: string
  infoSidebarVisible: boolean
}

export type NoteDetailSessionHandle = {
  isDirty: () => boolean
  isSaving: () => boolean
  enterEditMode: () => void
  toggleMode: () => void
  cycleFace: () => void
  save: () => Promise<void>
  discardChanges: () => void
}

export type NoteDetailSessionProps = {
  gateway: HyperCortexGateway
  scope: VaultScope
  note: NoteMeta
  visible: boolean
  bodyScrollRef?: React.Ref<HTMLDivElement>
  noteIndexMap: Record<string, { title: string }>
  allNotesById: Record<string, NoteMeta>
  refIndex: NoteRefIndex
  consumeInitSnapshot: (noteId: string) => NoteDetailSnapshotV1 | null
  onOpenNote: (note: NoteMeta) => void
  onDirtyChange?: (payload: { noteId: string; dirty: boolean }) => void
  onSaved: (payload: {
    originalId: string
    meta: NoteMeta
    snapshotForNewId?: NoteDetailSnapshotV1
    refsForIndex?: string[]
  }) => void
  trashEnabled: boolean
  onRequestDeleteNote: (payload: { note: NoteMeta; mode: 'trash' | 'permanent' }) => Promise<void> | void
  htmlFaceDisplayMode?: HyperCortexHtmlFaceDisplayModeV1
  htmlFaceGlobalDefaultScale?: number
}

export const NoteDetailSession = React.forwardRef<NoteDetailSessionHandle, NoteDetailSessionProps>(function NoteDetailSession(props, ref) {
  const {
    gateway,
    scope,
    note,
    visible,
    onDirtyChange,
    bodyScrollRef,
    noteIndexMap,
    allNotesById,
    refIndex,
    consumeInitSnapshot,
    onOpenNote,
    onSaved,
    trashEnabled,
    onRequestDeleteNote,
    htmlFaceDisplayMode = 'natural',
    htmlFaceGlobalDefaultScale = 0.95,
  } = props

  const noteId = String(note.id || '').trim()
  const isDraft = isDraftNoteId(noteId) || !String(note.dir || '').trim()

  const initRef = React.useRef<NoteDetailSnapshotV1 | null | undefined>(undefined)
  if (initRef.current === undefined) initRef.current = consumeInitSnapshot(noteId)
  const init = initRef.current

  const [doc, setDoc] = React.useState<HyperCortexNoteDoc | null>(init?.doc ?? null)
  const [htmlFace, setHtmlFace] = React.useState<HyperCortexHtmlFaceDoc | null>(init?.htmlFace ?? null)
  const [faceManifests, setFaceManifests] = React.useState<Record<string, HyperCortexNoteFaceManifestV2>>(init?.faceManifests ?? { text: createDefaultFaceManifest('markdown') })
  const [htmlFaceScaleSaving, setHtmlFaceScaleSaving] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  const [editing, setEditing] = React.useState(init?.editing ?? (isDraft ? true : false))
  const [textEditorMode, setTextEditorMode] = React.useState<TextEditorMode>(init?.textEditorMode ?? 'live')
  const [face, setFace] = React.useState<NoteFaceId>(init?.face ?? 'text')
  const [faces, setFaces] = React.useState<NoteFaceId[]>(init?.faces ?? ['text'])
  const [infoSidebarVisible, setInfoSidebarVisible] = React.useState(init?.infoSidebarVisible ?? false)
  const facesRef = React.useRef<NoteFaceId[]>(faces)
  React.useEffect(() => {
    facesRef.current = faces
  }, [faces])

  const [editTitle, setEditTitle] = React.useState(init?.editTitle ?? (note.title || ''))
  const [editDescription, setEditDescription] = React.useState(init?.editDescription ?? (note.description || ''))
  const [editBody, setEditBody] = React.useState(init?.editBody ?? '')
  const [editTags, setEditTags] = React.useState<string[]>(init?.editTags ?? [])
  const [tagInput, setTagInput] = React.useState('')
  const [editHtml, setEditHtml] = React.useState(init?.editHtml ?? '')

  const [addFaceSelectorVisible, setAddFaceSelectorVisible] = React.useState(false)
  const [pendingAddFace, setPendingAddFace] = React.useState<NoteFaceId | null>(null)

  const [moreMenuAnchorEl, setMoreMenuAnchorEl] = React.useState<HTMLElement | null>(null)
  const moreMenuOpen = !!moreMenuAnchorEl
  const [htmlScaleControlsVisible, setHtmlScaleControlsVisible] = React.useState(false)
  const [deleteFaceMenuAnchorEl, setDeleteFaceMenuAnchorEl] = React.useState<HTMLElement | null>(null)
  const deleteFaceMenuOpen = !!deleteFaceMenuAnchorEl
  const closeMoreMenu = React.useCallback(() => {
    setMoreMenuAnchorEl(null)
    setDeleteFaceMenuAnchorEl(null)
  }, [])

  const [deleteNoteConfirmOpen, setDeleteNoteConfirmOpen] = React.useState(false)
  const [deleteHtmlConfirmOpen, setDeleteHtmlConfirmOpen] = React.useState(false)
  const [htmlFullscreenOpen, setHtmlFullscreenOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState<'note' | 'html' | ''>('')

  const [base, setBase] = React.useState<NoteContent>(
    init?.base ?? {
      title: note.title || '未命名',
      description: note.description || '',
      body: '',
      tags: [],
      html: '',
    },
  )

  const renderEngineRef = React.useRef(createMarkdownRenderEngine({ clipboard: gateway.clipboard, host: gateway.host, assets: gateway.assets, scope }))
  React.useEffect(() => {
    renderEngineRef.current.noteIndex = noteIndexMap
  }, [noteIndexMap])

  const textRenderRef = React.useRef<HTMLDivElement>(null)
  const sanitizeSvg = React.useCallback((svg: unknown) => renderEngineRef.current.sanitizeSvg(svg, 'baseline'), [])
  const preview = usePreviewController({ toast: gateway.host.toast, sanitizeSvg })

  const draftNowRef = React.useMemo<NoteContent>(() => {
    return {
      title: editTitle,
      description: editDescription,
      body: editBody,
      tags: editTags,
      html: editHtml,
    }
  }, [editBody, editDescription, editHtml, editTags, editTitle])

  const dirty = React.useMemo(() => !isNoteContentEqual(draftNowRef, base), [base, draftNowRef])
  const noteTitleForPrompt = React.useMemo(() => {
    const s = String(editTitle || doc?.title || note.title || '').trim()
    return s || '未命名'
  }, [doc?.title, editTitle, note.title])
  const activeFaceManifest = faceManifests[face] || null
  const canDeleteCurrentFace = !!activeFaceManifest?.capabilities.deletable
  const lastDirtyRef = React.useRef<boolean | null>(null)
  React.useEffect(() => {
    if (lastDirtyRef.current === dirty) return
    lastDirtyRef.current = dirty
    onDirtyChange?.({ noteId, dirty })
  }, [dirty, noteId, onDirtyChange])

  const requestDeleteNote = React.useCallback(() => {
    closeMoreMenu()
    setDeleteNoteConfirmOpen(true)
  }, [closeMoreMenu])

  const confirmDeleteNote = React.useCallback(async () => {
    if (deleting) return
    setDeleting('note')
    try {
      const mode: 'trash' | 'permanent' = trashEnabled ? 'trash' : 'permanent'
      await onRequestDeleteNote({ note, mode })
      setDeleteNoteConfirmOpen(false)
    } catch (e: any) {
      void gateway.host.toast(String(e?.message || e || '删除失败'))
    } finally {
      setDeleting('')
    }
  }, [deleting, gateway, note, onRequestDeleteNote, trashEnabled])

  const requestDeleteHtmlFace = React.useCallback(() => {
    closeMoreMenu()
    setDeleteHtmlConfirmOpen(true)
  }, [closeMoreMenu])

  const confirmDeleteHtmlFace = React.useCallback(async () => {
    if (!String(note.dir || '').trim()) return
    if (deleting) return
    const deletingFaceId = face
    if (!canDeleteCurrentFace || !isHtmlFaceId(deletingFaceId, faceManifests)) return
    setDeleting('html')
    try {
      const next = await gateway.notes.deleteHtmlFace(scope, note.dir)
      setHtmlFace(next)
      setFaces(prev => prev.filter(f => f !== deletingFaceId))
      setFaceManifests(prev => {
        const out = { ...prev }
        delete out[deletingFaceId]
        return out
      })
      setFace(normalizeFaceOrder(['text'], faceManifests)[0] || 'text')
      setEditHtml(next.html)
      setBase(prev => ({ ...prev, html: next.html }))
      setAddFaceSelectorVisible(false)
      setPendingAddFace(null)
      setDeleteHtmlConfirmOpen(false)
      void gateway.host.toast('已删除 HTML 面')
    } catch (e: any) {
      void gateway.host.toast(String(e?.message || e || '删除 HTML 面失败'))
    } finally {
      setDeleting('')
    }
  }, [canDeleteCurrentFace, deleting, face, faceManifests, gateway, note.dir, scope])

  const handleSaveNoteFixedScale = React.useCallback(async (scale: number | null) => {
    const dir = String(note.dir || '').trim()
    if (!dir || htmlFaceScaleSaving) return
    setHtmlFaceScaleSaving(true)
    try {
      await gateway.notes.saveHtmlFaceFixedScale(scope, dir, scale)
      setHtmlFace(prev => prev ? { ...prev, fixedScale: scale ?? undefined } : prev)
      setFaceManifests(prev => {
      const htmlId = Object.keys(prev).find(id => isHtmlFace(prev[id])) || 'html'
        const htmlFaceManifest = prev[htmlId]
        if (!htmlFaceManifest) return prev
        return {
          ...prev,
          [htmlId]: {
            ...htmlFaceManifest,
            settings: scale !== null && Number.isFinite(scale) ? { ...htmlFaceManifest.settings, fixedScale: scale } : {},
          },
        }
      })
      void gateway.host.toast('已保存笔记缩放比例')
    } catch (e: any) {
      void gateway.host.toast(String(e?.message || e || '保存缩放比例失败'))
    } finally {
      setHtmlFaceScaleSaving(false)
    }
  }, [gateway, htmlFaceScaleSaving, note.dir, scope])

  const ensureDraftDocIfNeeded = React.useCallback(() => {
    if (!isDraft) return
    if (doc) return
    const now = Date.now()
    const title = String(editTitle || '').trim() || note.title || '未命名'
    const description = String(editDescription || '').trim()
    const tags = editTags.slice()
    const body = editBody || ''
    setDoc({
      id: noteId,
      packageDir: '',
      title,
      description,
      body,
      tags,
      createdAtMs: Number(note.createdAtMs) > 0 ? Number(note.createdAtMs) : now,
      updatedAtMs: Number(note.updatedAtMs) > 0 ? Number(note.updatedAtMs) : now,
      schemaVersion: HYPERCORTEX_NOTE_SCHEMA_VERSION,
      resources: [],
      displayHtml: renderNoteDisplayHtml({ title, description, body, tags }),
    })
    setFaceManifests({ text: createDefaultFaceManifest('markdown') })
    setFaces(['text'])
  }, [doc, editBody, editDescription, editTags, editTitle, isDraft, note.createdAtMs, note.title, note.updatedAtMs, noteId])

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
        gateway.notes.loadNotePackage(scope, note.dir),
        gateway.notes.loadHtmlFace(scope, note.dir).catch(() => null),
      ])
      const manifest = await gateway.notes.loadNoteManifest(scope, note.dir)
      setDoc(loadedDoc)
      setHtmlFace(loadedHtml)
      setFaceManifests(manifest.faces)

      const nextFaces: NoteFaceId[] = normalizeFaceOrder(manifest.faceOrder, manifest.faces)
      setFaces(nextFaces)

      const nextBase: NoteContent = {
        title: loadedDoc.title || note.title || '未命名',
        description: loadedDoc.description || note.description || '',
        body: loadedDoc.body || '',
        tags: (loadedDoc.tags || []).slice(),
        html: loadedHtml?.html || '',
      }
      setBase(nextBase)

      setEditTitle(nextBase.title)
      setEditDescription(nextBase.description)
      setEditBody(nextBase.body)
      setEditTags(nextBase.tags.slice())
      setEditHtml(nextBase.html)
      setTagInput('')
    } catch (e: any) {
      setLoadError(String(e?.message || e || '加载笔记失败'))
    } finally {
      setLoading(false)
    }
  }, [doc, ensureDraftDocIfNeeded, gateway, isDraft, note.description, note.dir, note.title, noteId, scope])

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
    if (!visible) return
    if (face !== 'text' || editing) return
    const el = textRenderRef.current
    if (!el) return
    ensurePreviewClickHandlerOnce(el, { controller: preview.controller, stopPropagation: true })
    // 首次进入笔记页时，正文节点可能尚未挂载（doc 还没加载出来），
    // 只依赖 visible/face/editing 会导致错过绑定，从而出现“切换页面回来才生效”。
  }, [doc, editing, face, preview.controller, visible])

  React.useEffect(() => {
    if (!visible) return
    if (face !== 'text' || editing) return
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
  }, [allNotesById, doc, editing, face, onOpenNote, visible])

  const outgoingIds = React.useMemo(() => {
    if (!infoSidebarVisible) return []
    const body = isTextFaceId(face, faceManifests) ? editBody : (doc?.body || editBody || '')
    return extractNoteRefs(body)
  }, [doc?.body, editBody, face, faceManifests, infoSidebarVisible])

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
    // Live 编辑态：点击预览内容本体用于“回到源码编辑”，预览弹窗改为右上角按钮触发。
    ensureLiveEditorPreviewButton(el, {
      controller: preview.controller,
      getRoot: (current) => current.closest('.cm-editor'),
    })

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
  }, [preview.controller])

  const handleToggleMode = React.useCallback(() => {
    if (!doc) return
    setEditing(prev => !prev)
  }, [doc])

  const handleDiscard = React.useCallback(() => {
    if (saving) return
    setEditTitle(base.title)
    setEditDescription(base.description)
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
      const description = String(editDescription || '').trim()
      const body = String(editBody || '').replace(/\r\n/g, '\n')
      const tags = editTags.map(normalizeTagText).filter(Boolean)

      let nextMeta: NoteMeta
      let nextDoc: HyperCortexNoteDoc | null = doc
      let nextHtmlFace: HyperCortexHtmlFaceDoc | null = htmlFace
      let toastMsg: string

      if (isHtmlFaceId(face, faceManifests)) {
        const result = await gateway.notes.saveHtmlFace(scope, {
          id: isDraft ? undefined : originalId,
          packageDir: isDraft ? undefined : note.dir,
          title,
          description,
          body: doc?.body || '',
          tags,
          createdAtMs: note.createdAtMs,
          resources: doc?.resources || [],
          html: editHtml,
        })
        nextMeta = result.meta
        nextHtmlFace = result.htmlFace
        setHtmlFace(nextHtmlFace)
        const savedManifest = await gateway.notes.loadNoteManifest(scope, result.meta.dir)
        setFaceManifests(savedManifest.faces)
        setFaces(normalizeFaceOrder(savedManifest.faceOrder, savedManifest.faces))
        if (nextDoc) {
          nextDoc = { ...nextDoc, id: nextMeta.id, packageDir: nextMeta.dir, title, description, tags, updatedAtMs: nextMeta.updatedAtMs }
          setDoc(nextDoc)
        }
        toastMsg = 'HTML 面已保存'
      } else {
        const result = await gateway.notes.saveNotePackage(scope, {
          id: isDraft ? undefined : originalId,
          packageDir: isDraft ? undefined : note.dir,
          title,
          description,
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
        description,
        body: base.body,
        tags: tags.slice(),
        html: base.html,
      }
      if (isTextFaceId(face, faceManifests)) nextBase.body = body
      if (isHtmlFaceId(face, faceManifests)) nextBase.html = editHtml
      setBase(nextBase)

      const didMigrateId = isDraft && nextMeta.id !== originalId
      const snapshotForNewId: NoteDetailSnapshotV1 | undefined = didMigrateId ? {
        doc: nextDoc ? { ...nextDoc, id: nextMeta.id, packageDir: nextMeta.dir } : null,
        htmlFace: nextHtmlFace ? { ...nextHtmlFace, id: nextMeta.id, packageDir: nextMeta.dir } : null,
        base: nextBase,
        editing,
        textEditorMode,
        face,
        faceManifests,
        faces,
        editTitle: title,
        editDescription: description,
        editBody: isTextFaceId(face, faceManifests) ? body : editBody,
        editTags: tags.slice(),
        editHtml,
        infoSidebarVisible,
      } : undefined

      const refsSourceBody = isTextFaceId(face, faceManifests) ? body : (doc?.body || '')
      const refsForIndex = extractNoteRefs(refsSourceBody).filter(id => !!allNotesById[id])
      onSaved({ originalId, meta: nextMeta, snapshotForNewId, refsForIndex })

      // 侧边栏未保存黄点：保存成功后应立即消失（不依赖上层重新渲染时机）。
      onDirtyChange?.({ noteId: originalId, dirty: false })
      if (nextMeta.id && nextMeta.id !== originalId) onDirtyChange?.({ noteId: nextMeta.id, dirty: false })
      await gateway.host.toast(toastMsg)
    } catch (e: any) {
      await gateway.host.toast(String(e?.message || e || '保存失败'))
    } finally {
      setSaving(false)
    }
  }, [allNotesById, base.body, base.html, doc, editBody, editDescription, editHtml, editTags, editTitle, editing, face, faceManifests, faces, gateway, htmlFace, infoSidebarVisible, isDraft, note.createdAtMs, note.dir, noteId, onSaved, saving, scope, textEditorMode])

  const handleCycleFace = React.useCallback(() => {
    setFace(prev => {
      const list = Array.isArray(facesRef.current) && facesRef.current.length ? facesRef.current : ['text']
      if (list.length <= 1) return prev
      const idx = list.indexOf(prev)
      const next = list[(idx >= 0 ? idx + 1 : 0) % list.length]
      return next
    })
  }, [])

  React.useImperativeHandle(ref, () => ({
    isDirty: () => dirty,
    isSaving: () => saving,
    enterEditMode: () => setEditing(true),
    toggleMode: () => handleToggleMode(),
    cycleFace: () => handleCycleFace(),
    save: () => handleSave(),
    discardChanges: () => handleDiscard(),
  }), [dirty, handleCycleFace, handleDiscard, handleSave, handleToggleMode, saving])

  const handleAddFace = React.useCallback(async () => {
    if (!pendingAddFace) return
    const pendingFace = faceManifests[pendingAddFace] || (pendingAddFace === 'html' ? createDefaultFaceManifest(HTML_FACE_KIND) : null)
    if (!pendingFace) return
    if (isHtmlFace(pendingFace)) {
      if (!doc) return
      let nextHtml = ''
      if (!isDraft && String(note.dir || '').trim()) {
        try {
          const loaded = await gateway.notes.loadHtmlFace(scope, note.dir)
          nextHtml = loaded.html || ''
          setHtmlFace(loaded)
        } catch {
          nextHtml = ''
        }
      }
      setEditHtml(nextHtml)
      setFaceManifests(prev => ({ ...prev, [pendingFace.id]: pendingFace }))
      setFaces(prev => (prev.includes(pendingFace.id) ? prev : [...prev, pendingFace.id]))
      setFace(pendingFace.id)
      setEditing(true)
    }
    setAddFaceSelectorVisible(false)
    setPendingAddFace(null)
  }, [doc, faceManifests, gateway, isDraft, note.dir, pendingAddFace, scope])

  if (!noteId) return null

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        display: visible ? 'flex' : 'none',
        flexDirection: 'column',
        p: 2,
        boxSizing: 'border-box',
        position: 'relative',
      }}
    >
      <Box sx={{ position: 'absolute', top: 16, left: 16, right: 16, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, bgcolor: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(8px)', borderRadius: 999, px: 0.5 }}>
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

          {!loading && !loadError && doc && isHtmlFaceId(face, faceManifests) && !editing ? (
            <Tooltip title="全屏预览" placement="bottom-start">
              <IconButton
                size="small"
                aria-label="全屏预览 HTML 面"
                onClick={() => setHtmlFullscreenOpen(true)}
                sx={{
                  color: 'rgba(0,0,0,.58)',
                  bgcolor: 'transparent',
                  boxShadow: 'none',
                  border: 0,
                  flex: '0 0 auto',
                  '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
                }}
              >
                <FullscreenRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null}

          {!loading && !loadError && doc && editing && isTextFaceId(face, faceManifests) ? (
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
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(8px)', borderRadius: 999, px: 0.5 }}>
            {isHtmlFaceId(face, faceManifests) && !editing && htmlFaceDisplayMode === 'fixed-fit' ? (
              <Tooltip title={htmlScaleControlsVisible ? '收起缩放调节' : '展开缩放调节'} placement="bottom-end">
                <IconButton
                  size="small"
                  aria-label={htmlScaleControlsVisible ? '收起缩放调节' : '展开缩放调节'}
                  onClick={() => setHtmlScaleControlsVisible(prev => !prev)}
                  sx={{
                    color: htmlScaleControlsVisible ? '#1976d2' : 'rgba(0,0,0,.58)',
                    bgcolor: 'transparent',
                    '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
                  }}
                >
                  <TuneRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}

            <Tooltip title="更多操作" placement="bottom-end">
              <IconButton
                size="small"
                aria-label="更多操作"
                onClick={e => setMoreMenuAnchorEl(e.currentTarget)}
                sx={{
                  color: 'rgba(0,0,0,.58)',
                  bgcolor: 'transparent',
                  '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
                }}
              >
                <MoreHorizRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Menu
              open={moreMenuOpen}
              onClose={closeMoreMenu}
              anchorEl={moreMenuAnchorEl}
              PaperProps={{ sx: { borderRadius: 7, overflow: 'hidden' } }}
            >
              <MenuItem
                onClick={() => requestDeleteNote()}
                sx={{ color: '#d32f2f' }}
              >
                删除当前整个笔记…
              </MenuItem>
              {canDeleteCurrentFace ? (
                <>
                  <Divider />
                  <MenuItem
                    onClick={e => setDeleteFaceMenuAnchorEl(e.currentTarget as HTMLElement)}
                  >
                    删除当前笔记的其中面…
                  </MenuItem>
                </>
              ) : null}
            </Menu>

            <Menu
              open={deleteFaceMenuOpen}
              onClose={() => setDeleteFaceMenuAnchorEl(null)}
              anchorEl={deleteFaceMenuAnchorEl}
              PaperProps={{ sx: { borderRadius: 7, overflow: 'hidden' } }}
            >
              <MenuItem onClick={() => requestDeleteHtmlFace()} sx={{ color: '#d32f2f' }}>
                HTML 面
              </MenuItem>
            </Menu>

            <Tooltip title="复制引用占位符" placement="bottom-end">
              <IconButton
                size="small"
                aria-label="复制引用占位符"
                onClick={() => {
                  void gateway.clipboard.writeText(buildNotePlaceholderForCopy(doc.id, editTitle || doc.title || note.title || ''))
                  void gateway.host.toast('已复制引用占位符')
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
                {!faces.some(f => isHtmlFaceId(f, faceManifests)) ? (
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
                  {faceLabel(f, faceManifests)}
                </Box>
              ))}
            </Box>
          </Box>
        ) : null}
      </Box>

      {loading ? <Typography sx={{ pt: 7 }} color="text.secondary">正在加载笔记...</Typography> : null}
      {!loading && loadError ? <Typography sx={{ pt: 7 }} color="error">{loadError}</Typography> : null}

      {!loading && !loadError && doc ? (
        <Box sx={{ width: '100%', flex: 1, minHeight: 0, display: 'flex', minWidth: 0, gap: 2, alignItems: 'stretch' }}>
          <Box ref={bodyScrollRef} sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', overscrollBehavior: 'contain', pt: 7 }}>
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

            {isHtmlFaceId(face, faceManifests) ? editing ? (
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
              <HtmlFaceIframe
                html={editHtml}
                mode={htmlFaceDisplayMode}
                minHeightPx={240}
                globalDefaultScale={htmlFaceGlobalDefaultScale}
                noteFixedScale={htmlFace?.fixedScale ?? null}
                onSaveNoteFixedScale={String(note.dir || '').trim() ? handleSaveNoteFixedScale : undefined}
                scaleControlsVisible={htmlScaleControlsVisible}
              />
            ) : editing ? textEditorMode === 'live' ? (
              <BlockEditor value={editBody} onChange={setEditBody} placeholder="开始编辑正文..." minHeight={400} onBlockRendered={handleBlockRendered} active={visible} refreshToken={noteIndexMap} writeClipboardText={gateway.clipboard.writeText} showToast={gateway.host.toast} />
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

            </Box>
          </Box>

          {infoSidebarVisible ? (
            <Box sx={{ flex: '0 0 280px', width: 280, minWidth: 280, minHeight: 0, overflow: 'auto', overscrollBehavior: 'contain' }}>
              <NoteInfoSidebar
                noteId={doc.id}
                description={editDescription}
                editing={editing}
                createdAtMs={doc.createdAtMs}
                updatedAtMs={doc.updatedAtMs}
                outgoingIds={outgoingIds}
                backlinkIds={backlinkIds}
                onDescriptionChange={setEditDescription}
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

      <Dialog open={deleteNoteConfirmOpen} onClose={() => setDeleteNoteConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{isDraft ? '删除草稿' : trashEnabled ? '移入回收站' : '永久删除'}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.72)' }}>
            {isDraft
              ? `确定删除草稿「${noteTitleForPrompt}」吗？这会丢弃当前内容。`
              : trashEnabled
                ? `确定将笔记「${noteTitleForPrompt}」移入回收站吗？`
                : `回收站当前未启用。确定永久删除笔记「${noteTitleForPrompt}」吗？此操作不可撤销。`}
          </Typography>
          {dirty ? (
            <Typography sx={{ mt: 1, fontSize: 12, lineHeight: 1.6, color: 'rgba(0,0,0,.56)' }}>
              提示：当前笔记有未保存改动。
            </Typography>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteNoteConfirmOpen(false)} disabled={deleting === 'note'}>取消</Button>
          <Button variant="contained" color="error" onClick={() => void confirmDeleteNote()} disabled={deleting === 'note'}>
            {deleting === 'note' ? '处理中…' : isDraft ? '删除' : trashEnabled ? '移入回收站' : '永久删除'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteHtmlConfirmOpen} onClose={() => setDeleteHtmlConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>删除面</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.72)' }}>
            确定删除当前笔记的 HTML 面吗？此操作不可撤销。
          </Typography>
          {dirty && isHtmlFaceId(face, faceManifests) ? (
            <Typography sx={{ mt: 1, fontSize: 12, lineHeight: 1.6, color: 'rgba(0,0,0,.56)' }}>
              提示：会丢弃 HTML 面的未保存改动。
            </Typography>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteHtmlConfirmOpen(false)} disabled={deleting === 'html'}>取消</Button>
          <Button variant="contained" color="error" onClick={() => void confirmDeleteHtmlFace()} disabled={deleting === 'html'}>
            {deleting === 'html' ? '删除中…' : '删除'}
          </Button>
        </DialogActions>
      </Dialog>

      <ImageDialog open={preview.modal === 'image'} controller={preview.controller} viewer={preview.imageViewer} />
      <MermaidDialog open={preview.modal === 'mermaid'} controller={preview.controller} mermaid={preview.mermaid} />
      <HtmlFaceFullscreenDialog
        open={htmlFullscreenOpen}
        html={editHtml}
        onClose={() => setHtmlFullscreenOpen(false)}
      />
    </Box>
  )
})
