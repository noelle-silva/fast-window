import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputBase, Menu, MenuItem, Tooltip, Typography } from '@mui/material'
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
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import PlaylistAddCheckRoundedIcon from '@mui/icons-material/PlaylistAddCheckRounded'

import { createMarkdownRenderEngine } from '../render/engine'
import { HYPERCORTEX_NOTE_SCHEMA_VERSION, type HyperCortexNoteManifestV1 } from '../noteSchema'
import { renderNoteDisplayHtml } from '../noteRender'
import { extractNoteRefs, getBacklinksFor, getFaceBacklinksFor, isBacklinkStaleFor, type NoteRefEntryMap, type NoteRefIndex } from '../noteRefs'
import { buildNotePlaceholderForCopy } from '../notePlaceholder'
import { buildAssetMarkerBlock, formatAssetMarkerInsertion } from '../assetMarker'
import { mergeNoteResources } from '../noteResources'
import { filesFromClipboardData, uploadPastedAssetFiles } from '../services/pastedAssetUpload'
import type { NoteMeta, VaultScope, HyperCortexNoteDoc, HyperCortexHtmlFaceDisplayModeV1 } from '../core'
import type { HyperCortexGateway, HyperCortexHtmlFaceDoc } from '../gateway'
import type { SaveNoteFaceContentInput } from '../gateway/types'
import { DEFAULT_HTML_FACE_DISPLAY_MODE, HTML_FACE_FIXED_SCALE } from '../htmlFaceDisplay'
import { DEFAULT_FACE_KIND_ORDER, resolveHtmlFacePreferences, resolveNoteFaceOrder } from '../facePreferences'
import { HTML_FACE_KIND, MARKDOWN_FACE_KIND, createDefaultFaceManifest, getHtmlFaceFixedScale, getNoteFaceAdapter, isHtmlFace, isKnownFaceKind, labelForFaceKind, listNoteFaceAdapters, type HyperCortexNoteFaceManifestV2 } from '../noteFaces'
import { isDraftNoteId } from '../drafts'
import type { HyperCortexFavoritesDocV1 } from '../favorites'
import { FavoritesTreePickerDialog } from './FavoritesTreePickerDialog'
import { useFavoriteTargets } from './useFavoriteTargets'
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
import { menuDangerItemSx, menuPaperSx } from './pluginUiStyles'
import { NoteVersionHistoryDialog } from './note-version-history/NoteVersionHistoryDialog'
import { NoteSettingsDialog } from './note-settings/NoteSettingsDialog'

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
  const title = String(manifest.title || '').trim() || labelForFaceKind(manifest.kind)
  if (!isKnownFaceKind(manifest.kind)) return `${title}（暂不支持）`
  return title
}

function FaceEmptyState(props: { onCreateFace: (kind: string) => void }): React.ReactNode {
  const creatableFaces = listNoteFaceAdapters().filter(adapter => adapter.capabilities.creatable)
  return (
    <Box
      sx={{
        mt: 0.5,
        px: 2,
        py: 5,
        borderRadius: 3,
        bgcolor: 'rgba(15,23,42,.035)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
      }}
    >
      <Typography sx={{ fontSize: 14, lineHeight: 1.6, color: 'rgba(0,0,0,.55)' }}>
        当前笔记没有面，请选择创建一个面
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center' }}>
        {creatableFaces.map(adapter => (
          <Box
            key={adapter.kind}
            role="button"
            tabIndex={0}
            onClick={() => props.onCreateFace(adapter.kind)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                props.onCreateFace(adapter.kind)
              }
            }}
            sx={{
              px: 2,
              py: 1,
              borderRadius: 999,
              bgcolor: '#fff',
              boxShadow: '0 1px 2px rgba(0,0,0,.06)',
              fontSize: 13,
              lineHeight: 1,
              fontWeight: 700,
              color: '#111',
              cursor: 'pointer',
              userSelect: 'none',
              '&:hover': { bgcolor: 'rgba(0,0,0,.04)' },
            }}
          >
            {adapter.label}
          </Box>
        ))}
      </Box>
    </Box>
  )
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
  reload: () => Promise<void>
}

export type NoteDetailSessionProps = {
  gateway: HyperCortexGateway
  scope: VaultScope
  note: NoteMeta
  visible: boolean
  bodyScrollRef?: React.Ref<HTMLDivElement>
  noteIndexMap: Record<string, { title: string; faceIds?: string[] }>
  allNotesById: Record<string, NoteMeta>
  refIndex: NoteRefIndex
  faceSwitchRequest?: { noteId: string; faceId: string; seq: number } | null
  faceSwitchLatestSeq?: number
  onFaceSwitchConsumed?: (seq: number) => void
  consumeInitSnapshot: (noteId: string) => NoteDetailSnapshotV1 | null
  onOpenNote: (note: NoteMeta, faceId?: string) => void
  onEnsureNoteCardInfoLoaded?: (meta: NoteMeta) => void | Promise<void>
  onDirtyChange?: (payload: { noteId: string; dirty: boolean }) => void
  onSaved: (payload: {
    originalId: string
    meta: NoteMeta
    snapshotForNewId?: NoteDetailSnapshotV1
    refsForIndex?: NoteRefEntryMap
  }) => void
  trashEnabled: boolean
  onRequestDeleteNote: (payload: { note: NoteMeta; mode: 'trash' | 'permanent' }) => Promise<void> | void
  favoritesDoc?: HyperCortexFavoritesDocV1 | null
  onFavoriteSaved?: (doc: HyperCortexFavoritesDocV1) => void
  onPlayingChange?: (playing: boolean) => void
  htmlFaceDisplayMode?: HyperCortexHtmlFaceDisplayModeV1
  htmlFaceGlobalDefaultScale?: number
  globalFaceKindOrder?: readonly string[]
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
    faceSwitchRequest,
    faceSwitchLatestSeq,
    onFaceSwitchConsumed,
    consumeInitSnapshot,
    onOpenNote,
    onEnsureNoteCardInfoLoaded,
    onSaved,
    trashEnabled,
    onRequestDeleteNote,
    favoritesDoc,
    onFavoriteSaved,
    onPlayingChange,
    htmlFaceDisplayMode = DEFAULT_HTML_FACE_DISPLAY_MODE,
    htmlFaceGlobalDefaultScale = HTML_FACE_FIXED_SCALE.default,
    globalFaceKindOrder = DEFAULT_FACE_KIND_ORDER,
  } = props

  const noteId = String(note.id || '').trim()
  const isDraft = isDraftNoteId(noteId) || !String(note.dir || '').trim()

  const initRef = React.useRef<NoteDetailSnapshotV1 | null | undefined>(undefined)
  if (initRef.current === undefined) initRef.current = consumeInitSnapshot(noteId)
  const init = initRef.current

  const [doc, setDoc] = React.useState<HyperCortexNoteDoc | null>(init?.doc ?? null)
  const [htmlFace, setHtmlFace] = React.useState<HyperCortexHtmlFaceDoc | null>(init?.htmlFace ?? null)
  const [faceManifests, setFaceManifests] = React.useState<Record<string, HyperCortexNoteFaceManifestV2>>(init?.faceManifests ?? {})
  const [htmlFaceScaleSaving, setHtmlFaceScaleSaving] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  const [editing, setEditing] = React.useState(init?.editing ?? (isDraft ? true : false))
  const [textEditorMode, setTextEditorMode] = React.useState<TextEditorMode>(init?.textEditorMode ?? 'live')
  const [face, setFace] = React.useState<NoteFaceId>(init?.face ?? '')
  const [faces, setFaces] = React.useState<NoteFaceId[]>(init?.faces ?? [])
  const [facesReady, setFacesReady] = React.useState(() => !!init?.faces || isDraft)
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
  const [editResources, setEditResources] = React.useState(init?.doc?.resources ?? [])

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
  const [deleteFaceTarget, setDeleteFaceTarget] = React.useState<NoteFaceId | null>(null)
  const [htmlFullscreenOpen, setHtmlFullscreenOpen] = React.useState(false)
  const [versionHistoryOpen, setVersionHistoryOpen] = React.useState(false)
  const [noteSettingsOpen, setNoteSettingsOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState<'note' | 'face' | ''>('')

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
  const playbackCleanupRef = React.useRef<(() => void) | null>(null)
  const onPlayingChangeRef = React.useRef<typeof onPlayingChange>(onPlayingChange)
  React.useEffect(() => {
    onPlayingChangeRef.current = onPlayingChange
  }, [onPlayingChange])

  const bindTextPlaybackReporter = React.useCallback(() => {
    const el = textRenderRef.current
    playbackCleanupRef.current?.()
    playbackCleanupRef.current = null
    if (!el) return
    playbackCleanupRef.current = renderEngineRef.current.bindPlaybackReporter(el, playing => onPlayingChangeRef.current?.(playing))
  }, [])

  React.useEffect(() => {
    return () => {
      playbackCleanupRef.current?.()
      playbackCleanupRef.current = null
    }
  }, [])

  React.useEffect(() => {
    if (face === 'text' && !editing) return
    playbackCleanupRef.current?.()
    playbackCleanupRef.current = null
  }, [editing, face])

  const sanitizeSvg = React.useCallback((svg: unknown) => renderEngineRef.current.sanitizeSvg(svg, 'baseline'), [])
  const preview = usePreviewController({ toast: gateway.host.toast, sanitizeSvg })
  const [pastingAssets, setPastingAssets] = React.useState(false)

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
  const deletableFaceIds = React.useMemo(
    () => faces.filter(faceId => !!faceManifests[faceId]?.capabilities.deletable),
    [faceManifests, faces],
  )
  const htmlFaceManifest = React.useMemo(
    () => Object.values(faceManifests).find(face => isHtmlFace(face)) || null,
    [faceManifests],
  )
  // HTML 面显示偏好统一按“笔记级 > 全局级 > 协议默认”解析（Q33/Q34/Q35）。
  const htmlFacePreferences = React.useMemo(
    () => resolveHtmlFacePreferences({
      faceSettings: htmlFaceManifest?.settings,
      globalMode: htmlFaceDisplayMode,
      globalFixedScale: htmlFaceGlobalDefaultScale,
    }),
    [htmlFaceDisplayMode, htmlFaceGlobalDefaultScale, htmlFaceManifest],
  )
  // 笔记级设置写回后，把最新面清单同步到会话状态（面顺序与缩放覆盖共用同一入口）。
  const applyNoteManifest = React.useCallback((manifest: HyperCortexNoteManifestV1) => {
    setFaceManifests(manifest.faces)
    const nextFaces = resolveNoteFaceOrder({ faceOrder: manifest.faceOrder, faces: manifest.faces, globalKindOrder: globalFaceKindOrder })
    setFaces(nextFaces)
    setFace(prev => (nextFaces.includes(prev) ? prev : nextFaces[0] || ''))
    const htmlManifest = Object.values(manifest.faces).find(face => isHtmlFace(face)) || null
    setHtmlFace(prev => (prev ? { ...prev, fixedScale: getHtmlFaceFixedScale(htmlManifest) } : prev))
  }, [globalFaceKindOrder])
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

  const requestOpenNoteDir = React.useCallback(async () => {
    closeMoreMenu()
    const dir = String(note.dir || '').trim()
    if (isDraft || !dir) {
      void gateway.host.toast('草稿暂无所在目录（请先保存）')
      return
    }
    try {
      await gateway.host.openVaultDir(scope, dir)
    } catch (e: any) {
      void gateway.host.toast(String(e?.message || e || '打开目录失败'))
    }
  }, [closeMoreMenu, gateway, isDraft, note.dir, scope])

  const requestOpenVersionHistory = React.useCallback(() => {
    closeMoreMenu()
    if (isDraft || !String(note.dir || '').trim()) {
      void gateway.host.toast('请先保存笔记，再发布版本')
      return
    }
    setVersionHistoryOpen(true)
  }, [closeMoreMenu, gateway, isDraft, note.dir])

  const favoritesTargets = useFavoriteTargets({
    doc: favoritesDoc,
    onDocChange: next => onFavoriteSaved?.(next),
    toast: message => void gateway.host.toast(message),
  })

  const openFavoritesPicker = React.useCallback(() => {
    closeMoreMenu()
    favoritesTargets.openPicker({ kind: 'note', id: note.id })
  }, [closeMoreMenu, favoritesTargets, note.id])

  const handlePasteFiles = React.useCallback(async (files: File[], insertText: (text: string) => void) => {
    if (pastingAssets) {
      void gateway.host.toast('已有附件正在上传，请稍后再粘贴')
      return
    }
    setPastingAssets(true)
    try {
      const resources = await uploadPastedAssetFiles(gateway, scope, files)
      const markerBlock = buildAssetMarkerBlock(resources)
      if (!markerBlock) throw new Error('附件上传成功，但没有生成可插入的引用占位符')
      setEditResources(prev => mergeNoteResources(prev, resources))
      setDoc(prev => prev ? { ...prev, resources: mergeNoteResources(prev.resources || [], resources) } : prev)
      insertText(markerBlock)
      void gateway.host.toast(resources.length > 1 ? `已上传 ${resources.length} 个附件并插入占位符` : '已上传附件并插入占位符')
    } catch (err: any) {
      void gateway.host.toast(`粘贴附件失败：${String(err?.message || err || '未知错误')}`)
    } finally {
      setPastingAssets(false)
    }
  }, [gateway, pastingAssets, scope])

  const handleSourcePaste = React.useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = filesFromClipboardData(event.clipboardData)
    if (!files.length) return
    event.preventDefault()
    const target = event.currentTarget
    const from = target.selectionStart ?? editBody.length
    const to = target.selectionEnd ?? from
    const insertText = (text: string) => {
      const insert = String(text || '')
      if (!insert) return
      setEditBody(prev => `${prev.slice(0, from)}${formatAssetMarkerInsertion(insert, prev.slice(0, from), prev.slice(to))}${prev.slice(to)}`)
    }
    void handlePasteFiles(files, insertText)
  }, [editBody.length, handlePasteFiles])

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

  const requestDeleteFace = React.useCallback((faceId: string) => {
    closeMoreMenu()
    setDeleteFaceTarget(String(faceId || '').trim() || null)
  }, [closeMoreMenu])

  const confirmDeleteFace = React.useCallback(async () => {
    const targetFaceId = String(deleteFaceTarget || '').trim()
    const dir = String(note.dir || '').trim()
    if (!targetFaceId || !dir || deleting) return
    setDeleting('face')
    try {
      const mode: 'trash' | 'permanent' = trashEnabled ? 'trash' : 'permanent'
      const result = await gateway.notes.deleteNoteFace(scope, dir, targetFaceId, mode)
      setFaceManifests(result.manifest.faces)
      const nextFaces = resolveNoteFaceOrder({ faceOrder: result.manifest.faceOrder, faces: result.manifest.faces, globalKindOrder: globalFaceKindOrder })
      setFaces(nextFaces)
      setFace(prev => (nextFaces.includes(prev) ? prev : nextFaces[0] || ''))
      if (isHtmlFaceId(targetFaceId, faceManifests)) {
        const nextHtml = await gateway.notes.loadHtmlFace(scope, dir).catch(() => null)
        if (nextHtml) {
          setHtmlFace(nextHtml)
          setEditHtml(nextHtml.html || '')
          setBase(prev => ({ ...prev, html: nextHtml.html || '' }))
        }
      }
      setAddFaceSelectorVisible(false)
      setPendingAddFace(null)
      setDeleteFaceTarget(null)
      onSaved({ originalId: noteId, meta: result.meta, refsForIndex: result.refs })
      void gateway.host.toast(mode === 'trash' ? '已移入回收站（可在回收站恢复）' : '已删除面')
    } catch (e: any) {
      void gateway.host.toast(String(e?.message || e || '删除面失败'))
    } finally {
      setDeleting('')
    }
  }, [deleteFaceTarget, deleting, faceManifests, gateway, globalFaceKindOrder, note.dir, noteId, onSaved, scope, trashEnabled])

  const handleSaveNoteFixedScale = React.useCallback(async (scale: number | null) => {
    const dir = String(note.dir || '').trim()
    if (!dir || htmlFaceScaleSaving || !htmlFaceManifest) return
    setHtmlFaceScaleSaving(true)
    try {
      const result = await gateway.notes.saveFaceSettings(scope, dir, htmlFaceManifest.id, { fixedScale: scale })
      applyNoteManifest(result.manifest)
      void gateway.host.toast('已保存笔记缩放比例')
    } catch (e: any) {
      void gateway.host.toast(String(e?.message || e || '保存缩放比例失败'))
    } finally {
      setHtmlFaceScaleSaving(false)
    }
  }, [applyNoteManifest, gateway, htmlFaceManifest, htmlFaceScaleSaving, note.dir, scope])

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
    // 草稿的面清单来自初始快照（含默认面配置），这里不重置。
    setFacesReady(true)
  }, [doc, editBody, editDescription, editTags, editTitle, isDraft, note.createdAtMs, note.title, note.updatedAtMs, noteId])

  const hasEverActivatedRef = React.useRef(false)
  React.useEffect(() => {
    if (visible) hasEverActivatedRef.current = true
  }, [visible])

  const loadNoteIfNeeded = React.useCallback(async (options?: { force?: boolean }) => {
    if (!noteId) return
    if (isDraft) return ensureDraftDocIfNeeded()
    if (doc && !options?.force) return
    if (!String(note.dir || '').trim()) return

    if (!options?.force) setLoading(true)
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

      const nextFaces: NoteFaceId[] = resolveNoteFaceOrder({ faceOrder: manifest.faceOrder, faces: manifest.faces, globalKindOrder: globalFaceKindOrder })
      setFaces(nextFaces)
      setFace(prev => (nextFaces.includes(prev) ? prev : nextFaces[0] || ''))
      setFacesReady(true)

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
      setEditResources(loadedDoc.resources || [])
      setTagInput('')
    } catch (e: any) {
      if (options?.force) {
        void gateway.host.toast(String(e?.message || e || '刷新笔记失败'))
      } else {
        setLoadError(String(e?.message || e || '加载笔记失败'))
      }
    } finally {
      if (!options?.force) setLoading(false)
    }
  }, [doc, ensureDraftDocIfNeeded, gateway, globalFaceKindOrder, isDraft, note.description, note.dir, note.title, noteId, scope])

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
    renderEngineRef.current.renderInto(textRenderRef.current, editBody || '', { onAsyncLayout: bindTextPlaybackReporter })
    bindTextPlaybackReporter()
  }, [bindTextPlaybackReporter, editBody, editing, face, noteIndexMap, visible])

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
      if (!meta) return
      const faceId = String(link.getAttribute('data-face-id') || '').trim()
      onOpenNote(meta, faceId || undefined)
    }
    el.addEventListener('click', handler)
    return () => el.removeEventListener('click', handler)
  }, [allNotesById, doc, editing, face, onOpenNote, visible])

  const outgoingIds = React.useMemo(() => {
    if (!infoSidebarVisible) return []
    const body = isTextFaceId(face, faceManifests) ? editBody : (doc?.body || editBody || '')
    return extractNoteRefs(body)
  }, [doc?.body, editBody, face, faceManifests, infoSidebarVisible])

  React.useEffect(() => {
    if (!onEnsureNoteCardInfoLoaded) return
    if (!doc) return
    const targets = extractNoteRefs(editBody || doc.body || '')
    for (const id of targets) {
      const meta = allNotesById[id]
      if (!meta) continue
      try {
        void Promise.resolve(onEnsureNoteCardInfoLoaded(meta)).catch(() => {})
      } catch (_) {}
    }
  }, [allNotesById, doc, editBody, onEnsureNoteCardInfoLoaded])

  const allBacklinks = React.useMemo(() => {
    if (!noteId) return []
    return getBacklinksFor(refIndex, noteId)
  }, [noteId, refIndex])

  const faceBacklinkGroups = React.useMemo(() => {
    if (!noteId) return []
    return faces
      .map(faceId => ({
        faceId,
        label: `${faceLabel(faceId, faceManifests)}面引用`,
        refs: getFaceBacklinksFor(refIndex, noteId, faceId),
      }))
      .filter(group => group.refs.length > 0)
  }, [faces, faceManifests, noteId, refIndex])

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
    const cleanupPlaybackReporter = renderEngineRef.current.bindPlaybackReporter(el, playing => onPlayingChangeRef.current?.(playing))
    if (!pending.length) return cleanupPlaybackReporter

    let remaining = pending.length
    const done = () => { if (--remaining <= 0) requestUpdate() }
    pending.forEach(({ el: m, event }) => {
      m.addEventListener(event, done, { once: true })
      m.addEventListener('error', done, { once: true })
    })
    return cleanupPlaybackReporter
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
    setEditResources(doc?.resources || [])
    setTagInput('')
    setAddFaceSelectorVisible(false)
    setPendingAddFace(null)
    setTextEditorMode('live')
    setEditing(false)
  }, [base, doc?.resources, saving])

  const handleSave = React.useCallback(async () => {
    if (!noteId) return false
    if (saving) return false
    const rawTitle = String(editTitle || '').trim()
    if (faces.length === 0 && !rawTitle) {
      await gateway.host.toast('无面笔记至少需要一个标题')
      return false
    }
    setSaving(true)
    try {
      const originalId = noteId
      const title = rawTitle || '未命名'
      const description = String(editDescription || '').trim()
      const body = String(editBody || '').replace(/\r\n/g, '\n')
      const tags = editTags.map(normalizeTagText).filter(Boolean)
      // 当前笔记的面清单（按界面顺序）：保存时确保这些面存在，即新笔记默认面的落盘点。
      const faceKinds = faces.map(faceId => String(faceManifests[faceId]?.kind || '').trim()).filter(Boolean)

      let nextMeta: NoteMeta
      let nextDoc: HyperCortexNoteDoc | null = doc
      let nextHtmlFace: HyperCortexHtmlFaceDoc | null = htmlFace
      let nextFaceManifests: Record<string, HyperCortexNoteFaceManifestV2> = faceManifests
      let nextFaces: NoteFaceId[] = faces
      let toastMsg: string
      let refsForIndex: NoteRefEntryMap | undefined

      if (isHtmlFaceId(face, faceManifests)) {
        const result = await gateway.notes.saveHtmlFace(scope, {
          id: isDraft ? undefined : originalId,
          packageDir: isDraft ? undefined : note.dir,
          title,
          description,
          body: doc?.body || '',
          tags,
          createdAtMs: note.createdAtMs,
          resources: editResources,
          html: editHtml,
          faceKinds,
        })
        nextMeta = result.meta
        nextHtmlFace = result.htmlFace
        nextFaceManifests = result.manifest.faces
        nextFaces = resolveNoteFaceOrder({ faceOrder: result.manifest.faceOrder, faces: result.manifest.faces, globalKindOrder: globalFaceKindOrder })
        setHtmlFace(nextHtmlFace)
        setFaceManifests(nextFaceManifests)
        setFaces(nextFaces)
        if (nextDoc) {
          nextDoc = { ...nextDoc, id: nextMeta.id, packageDir: nextMeta.dir, title, description, tags, updatedAtMs: nextMeta.updatedAtMs }
          setDoc(nextDoc)
        }
        toastMsg = 'HTML 面已保存'
        refsForIndex = result.refs
      } else {
        const result = await gateway.notes.saveNotePackage(scope, {
          id: isDraft ? undefined : originalId,
          packageDir: isDraft ? undefined : note.dir,
          title,
          description,
          body,
          tags,
          createdAtMs: note.createdAtMs,
          resources: editResources,
          saveTextFace: isTextFaceId(face, faceManifests),
          faceKinds,
        })
        nextMeta = result.meta
        nextDoc = result.doc
        nextFaceManifests = result.manifest.faces
        nextFaces = resolveNoteFaceOrder({ faceOrder: result.manifest.faceOrder, faces: result.manifest.faces, globalKindOrder: globalFaceKindOrder })
        setDoc(nextDoc)
        setEditBody(nextDoc.body)
        setEditResources(nextDoc.resources || [])
        setFaceManifests(nextFaceManifests)
        setFaces(nextFaces)
        toastMsg = '笔记已保存'
        refsForIndex = result.refs
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
        faceManifests: nextFaceManifests,
        faces: nextFaces,
        editTitle: title,
        editDescription: description,
        editBody: isTextFaceId(face, faceManifests) ? body : editBody,
        editTags: tags.slice(),
        editHtml,
        infoSidebarVisible,
      } : undefined

      onSaved({ originalId, meta: nextMeta, snapshotForNewId, refsForIndex })

      // 侧边栏未保存黄点：保存成功后应立即消失（不依赖上层重新渲染时机）。
      onDirtyChange?.({ noteId: originalId, dirty: false })
      if (nextMeta.id && nextMeta.id !== originalId) onDirtyChange?.({ noteId: nextMeta.id, dirty: false })
      await gateway.host.toast(toastMsg)
      return true
    } catch (e: any) {
      await gateway.host.toast(String(e?.message || e || '保存失败'))
      return false
    } finally {
      setSaving(false)
    }
  }, [allNotesById, base.body, base.html, doc, editBody, editDescription, editHtml, editResources, editTags, editTitle, editing, face, faceManifests, faces, gateway, globalFaceKindOrder, htmlFace, infoSidebarVisible, isDraft, note.createdAtMs, note.dir, noteId, onSaved, saving, scope, textEditorMode])

  const saveCurrentForVersionPublish = React.useCallback(async () => {
    const saved = await handleSave()
    if (!saved) throw new Error('保存当前笔记失败，已停止发布版本')
  }, [handleSave])

  // Q24：保存整个笔记所有面——一次提交全部有改动的面与笔记级元数据，全部落盘；
  // 与“保存当前面”共用同一保存语义，仅覆盖范围不同。
  const handleSaveAllFaces = React.useCallback(async () => {
    if (!noteId) return false
    if (saving) return false
    const rawTitle = String(editTitle || '').trim()
    if (faces.length === 0 && !rawTitle) {
      await gateway.host.toast('无面笔记至少需要一个标题')
      return false
    }
    setSaving(true)
    try {
      const originalId = noteId
      const title = rawTitle || '未命名'
      const description = String(editDescription || '').trim()
      const body = String(editBody || '').replace(/\r\n/g, '\n')
      const tags = editTags.map(normalizeTagText).filter(Boolean)
      const faceKinds = faces.map(faceId => String(faceManifests[faceId]?.kind || '').trim()).filter(Boolean)
      // 只提交需要写回的面：草稿首次落盘提交全部面，已保存笔记提交内容有改动的面。
      const facePayloads: SaveNoteFaceContentInput[] = []
      for (const faceId of faces) {
        const faceManifest = faceManifests[faceId]
        if (!faceManifest) continue
        if (faceManifest.kind === MARKDOWN_FACE_KIND && (isDraft || body !== base.body)) {
          facePayloads.push({ faceId, kind: faceManifest.kind, content: body })
        } else if (faceManifest.kind === HTML_FACE_KIND && (isDraft || editHtml !== base.html)) {
          facePayloads.push({ faceId, kind: faceManifest.kind, content: editHtml })
        }
      }

      const result = await gateway.notes.saveNoteFaces(scope, {
        id: isDraft ? undefined : originalId,
        packageDir: isDraft ? undefined : note.dir,
        title,
        description,
        tags,
        createdAtMs: note.createdAtMs,
        resources: editResources,
        faceKinds,
        faces: facePayloads,
      })

      const nextMeta = result.meta
      const nextDoc = result.doc
      const nextHtmlFace = result.htmlFace
      const nextFaceManifests = result.manifest.faces
      const nextFaces = resolveNoteFaceOrder({ faceOrder: result.manifest.faceOrder, faces: result.manifest.faces, globalKindOrder: globalFaceKindOrder })

      setDoc(nextDoc)
      setEditBody(nextDoc.body)
      setEditResources(nextDoc.resources || [])
      if (nextHtmlFace) setHtmlFace(nextHtmlFace)
      setFaceManifests(nextFaceManifests)
      setFaces(nextFaces)

      const nextBase: NoteContent = {
        title,
        description,
        body: nextDoc.body,
        tags: tags.slice(),
        html: nextHtmlFace ? nextHtmlFace.html : base.html,
      }
      setBase(nextBase)

      const didMigrateId = isDraft && nextMeta.id !== originalId
      const snapshotForNewId: NoteDetailSnapshotV1 | undefined = didMigrateId ? {
        doc: nextDoc ? { ...nextDoc, id: nextMeta.id, packageDir: nextMeta.dir } : null,
        htmlFace: nextHtmlFace ? { ...nextHtmlFace, id: nextMeta.id, packageDir: nextMeta.dir } : null,
        base: nextBase,
        editing,
        textEditorMode,
        face,
        faceManifests: nextFaceManifests,
        faces: nextFaces,
        editTitle: title,
        editDescription: description,
        editBody: nextDoc.body,
        editTags: tags.slice(),
        editHtml: nextHtmlFace ? nextHtmlFace.html : editHtml,
        infoSidebarVisible,
      } : undefined

      onSaved({ originalId, meta: nextMeta, snapshotForNewId, refsForIndex: result.refs })
      onDirtyChange?.({ noteId: originalId, dirty: false })
      if (nextMeta.id && nextMeta.id !== originalId) onDirtyChange?.({ noteId: nextMeta.id, dirty: false })
      await gateway.host.toast('笔记所有面已保存')
      return true
    } catch (e: any) {
      await gateway.host.toast(String(e?.message || e || '保存失败'))
      return false
    } finally {
      setSaving(false)
    }
  }, [base.body, base.html, editBody, editDescription, editHtml, editResources, editTags, editTitle, editing, face, faceManifests, faces, gateway, globalFaceKindOrder, infoSidebarVisible, isDraft, note.createdAtMs, note.dir, noteId, onDirtyChange, onSaved, saving, scope, textEditorMode])

  const handleRestoreVersion = React.useCallback(async (versionId: string) => {
    const dir = String(note.dir || '').trim()
    if (!dir) throw new Error('请先保存笔记，再恢复版本')
    const result = await gateway.notes.restoreNoteVersion(scope, dir, versionId)
    const restoredHtml = await gateway.notes.loadHtmlFace(scope, result.meta.dir)
    const nextFaces = resolveNoteFaceOrder({ faceOrder: result.manifest.faceOrder, faces: result.manifest.faces, globalKindOrder: globalFaceKindOrder })
    const nextBase: NoteContent = {
      title: result.doc.title || '未命名',
      description: result.doc.description || '',
      body: result.doc.body || '',
      tags: (result.doc.tags || []).slice(),
      html: restoredHtml.html || '',
    }

    setDoc(result.doc)
    setHtmlFace(restoredHtml)
    setFaceManifests(result.manifest.faces)
    setFaces(nextFaces)
    setFace(prev => (nextFaces.includes(prev) ? prev : nextFaces[0] || ''))
    setBase(nextBase)
    setEditTitle(nextBase.title)
    setEditDescription(nextBase.description)
    setEditBody(nextBase.body)
    setEditTags(nextBase.tags.slice())
    setEditHtml(nextBase.html)
    setEditResources(result.doc.resources || [])
    setTagInput('')
    setEditing(false)
    setTextEditorMode('live')

    onSaved({ originalId: noteId, meta: result.meta, refsForIndex: result.refs })
    onDirtyChange?.({ noteId, dirty: false })
  }, [gateway, globalFaceKindOrder, note.dir, noteId, onDirtyChange, onSaved, scope])

  const handleCycleFace = React.useCallback(() => {
    setFace(prev => {
      const list = Array.isArray(facesRef.current) ? facesRef.current : []
      if (list.length <= 1) return prev
      const idx = list.indexOf(prev)
      const next = list[(idx >= 0 ? idx + 1 : 0) % list.length]
      return next
    })
  }, [])

  React.useEffect(() => {
    const req = faceSwitchRequest
    if (!req || req.noteId !== noteId) return
    if (req.seq !== faceSwitchLatestSeq) return
    const faceId = String(req.faceId || '').trim()
    if (!faceId) return
    if (!facesReady) return
    if (faces.includes(faceId)) setFace(faceId)
    onFaceSwitchConsumed?.(req.seq)
  }, [faceSwitchRequest, faceSwitchLatestSeq, faces, facesReady, noteId, onFaceSwitchConsumed])

  React.useEffect(() => {
    return () => {
      const req = faceSwitchRequest
      if (req && req.noteId === noteId) onFaceSwitchConsumed?.(req.seq)
    }
  }, [faceSwitchRequest, noteId, onFaceSwitchConsumed])

  const copyFaceRef = React.useCallback((faceId: string) => {
    const face = String(faceId || '').trim()
    if (!face) return
    const title = editTitle || doc?.title || note.title || ''
    void gateway.clipboard.writeText(buildNotePlaceholderForCopy(noteId, title, face))
    void gateway.host.toast('已复制此面引用占位符')
  }, [doc?.title, editTitle, gateway, note.title, noteId])

  React.useImperativeHandle(ref, () => ({
    isDirty: () => dirty,
    isSaving: () => saving,
    enterEditMode: () => setEditing(true),
    toggleMode: () => handleToggleMode(),
    cycleFace: () => handleCycleFace(),
    save: async () => { await handleSave() },
    discardChanges: () => handleDiscard(),
    reload: async () => { await loadNoteIfNeeded({ force: true }) },
  }), [dirty, handleCycleFace, handleDiscard, handleSave, handleToggleMode, loadNoteIfNeeded, saving])

  const handleAddFace = React.useCallback(async (kind?: string) => {
    const targetKind = String(kind || pendingAddFace || '').trim()
    const adapter = getNoteFaceAdapter(targetKind)
    if (!adapter || !adapter.capabilities.creatable) return
    if (!doc) return
    if (Object.values(faceManifests).some(face => face.kind === adapter.kind)) return
    const nextFace = createDefaultFaceManifest(adapter.kind)
    if (adapter.kind === HTML_FACE_KIND) {
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
    }
    setFaceManifests(prev => ({ ...prev, [nextFace.id]: nextFace }))
    setFaces(prev => (prev.includes(nextFace.id) ? prev : [...prev, nextFace.id]))
    setFace(nextFace.id)
    setEditing(true)
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

          {!loading && !loadError && doc ? (
            <Tooltip title="保存整个笔记所有面" placement="bottom-start">
              <IconButton
                size="small"
                aria-label="保存整个笔记所有面"
                onClick={() => void handleSaveAllFaces()}
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
                <PlaylistAddCheckRoundedIcon fontSize="small" />
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
                    color: htmlScaleControlsVisible ? 'var(--hc-primary)' : 'var(--hc-text-muted)',
                    bgcolor: 'transparent',
                    '&:hover': { bgcolor: 'var(--hc-surface-soft)', color: 'var(--hc-text)' },
                  }}
                >
                  <TuneRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}

            <Tooltip title="版本历史" placement="bottom-end">
              <IconButton
                size="small"
                aria-label="版本历史"
                onClick={requestOpenVersionHistory}
                disabled={isDraft || !String(note.dir || '').trim()}
                sx={{
                  color: 'rgba(0,0,0,.58)',
                  bgcolor: 'transparent',
                  '&:hover': { bgcolor: 'var(--hc-surface-soft)', color: 'var(--hc-text)' },
                  '&.Mui-disabled': { color: 'rgba(0,0,0,.28)' },
                }}
              >
                <HistoryRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title="更多操作" placement="bottom-end">
              <IconButton
                size="small"
                aria-label="更多操作"
                onClick={e => setMoreMenuAnchorEl(e.currentTarget)}
                sx={{
                  color: 'rgba(0,0,0,.58)',
                  bgcolor: 'transparent',
                    '&:hover': { bgcolor: 'var(--hc-surface-soft)', color: 'var(--hc-text)' },
                }}
              >
                <MoreHorizRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Menu
              open={moreMenuOpen}
              onClose={closeMoreMenu}
              anchorEl={moreMenuAnchorEl}
              PaperProps={{ sx: menuPaperSx }}
            >
              <MenuItem
                onClick={() => void requestOpenNoteDir()}
                disabled={isDraft || !String(note.dir || '').trim()}
              >
                打开当前笔记文件夹
              </MenuItem>
              <MenuItem
                onClick={requestOpenVersionHistory}
                disabled={isDraft || !String(note.dir || '').trim()}
              >
                版本历史…
              </MenuItem>
              <MenuItem
                onClick={() => {
                  closeMoreMenu()
                  setNoteSettingsOpen(true)
                }}
                disabled={isDraft || !String(note.dir || '').trim()}
              >
                笔记设置…
              </MenuItem>
              <MenuItem onClick={openFavoritesPicker} disabled={isDraft || !favoritesDoc}>
                收藏到…
              </MenuItem>
              <MenuItem
                onClick={() => requestDeleteNote()}
                sx={menuDangerItemSx}
              >
                删除当前整个笔记…
              </MenuItem>
              {deletableFaceIds.length > 0 ? (
                <>
                  <MenuItem
                    onClick={e => setDeleteFaceMenuAnchorEl(e.currentTarget as HTMLElement)}
                    sx={{ mt: 0.5, bgcolor: 'var(--hc-danger-soft)', color: 'var(--hc-danger)', '&:hover': { bgcolor: 'var(--hc-accent-clay)' } }}
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
              PaperProps={{ sx: menuPaperSx }}
            >
              {deletableFaceIds.map(faceId => (
                <MenuItem key={faceId} onClick={() => requestDeleteFace(faceId)} sx={{ color: 'var(--hc-danger)' }}>
                  {faceLabel(faceId, faceManifests)}
                </MenuItem>
              ))}
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
                {listNoteFaceAdapters()
                  .filter(adapter => adapter.capabilities.creatable && !faces.some(f => faceManifests[f]?.kind === adapter.kind))
                  .map(adapter => (
                    <Box
                      key={adapter.kind}
                      role="button"
                      tabIndex={0}
                      onClick={() => setPendingAddFace(adapter.kind)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setPendingAddFace(adapter.kind)
                        }
                      }}
                      sx={{
                        minWidth: 56,
                        px: 1.5,
                        py: 0.75,
                        borderRadius: 999,
                        bgcolor: pendingAddFace === adapter.kind ? '#111' : 'transparent',
                        color: pendingAddFace === adapter.kind ? '#fff' : '#374151',
                        fontSize: 12,
                        lineHeight: 1,
                        fontWeight: 700,
                        cursor: 'pointer',
                        userSelect: 'none',
                      }}
                    >
                      {adapter.label}
                    </Box>
                  ))}
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
                <Box key={f} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
                  <Box
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
                  <Tooltip title="复制此面引用" placement="bottom-end">
                    <IconButton
                      size="small"
                      aria-label={`复制 ${faceLabel(f, faceManifests)} 面引用`}
                      onClick={() => copyFaceRef(f)}
                      sx={{
                        color: 'rgba(0,0,0,.48)',
                        p: 0.4,
                        '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
                      }}
                    >
                      <ContentCopyRoundedIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
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
                  px: 1,
                  py: 0.75,
                  borderRadius: 3,
                  bgcolor: 'rgba(15,23,42,.035)',
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
                      bgcolor: 'rgba(15,23,42,.045)',
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

            {facesReady && faces.length === 0 ? (
              <FaceEmptyState onCreateFace={kind => void handleAddFace(kind)} />
            ) : isHtmlFaceId(face, faceManifests) ? editing ? (
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
                mode={htmlFacePreferences.mode}
                minHeightPx={240}
                fixedScale={htmlFacePreferences.fixedScale}
                noteFixedScale={htmlFacePreferences.noteFixedScale}
                onSaveNoteFixedScale={String(note.dir || '').trim() ? handleSaveNoteFixedScale : undefined}
                scaleControlsVisible={htmlScaleControlsVisible}
              />
            ) : editing ? textEditorMode === 'live' ? (
              <BlockEditor value={editBody} onChange={setEditBody} placeholder={pastingAssets ? '正在上传粘贴的附件...' : '开始编辑正文...'} minHeight={400} onBlockRendered={handleBlockRendered} active={visible} refreshToken={noteIndexMap} writeClipboardText={gateway.clipboard.writeText} showToast={gateway.host.toast} onPasteFiles={handlePasteFiles} />
            ) : (
              <InputBase
                value={editBody}
                onChange={e => setEditBody(e.target.value)}
                onPaste={handleSourcePaste}
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
                allBacklinks={allBacklinks}
                faceBacklinkGroups={faceBacklinkGroups}
                onDescriptionChange={setEditDescription}
                resolveTitle={id => allNotesById[id]?.title}
                canOpenId={id => !!allNotesById[id]}
                onOpenId={id => {
                  const meta = allNotesById[id]
                  if (meta) onOpenNote(meta)
                }}
                onOpenRef={ref => {
                  const meta = allNotesById[ref.noteId]
                  if (meta) onOpenNote(meta, ref.faceId || undefined)
                }}
                isBacklinkStale={ref => isBacklinkStaleFor(refIndex, noteId, ref.noteId, faceId => !!faceManifests[String(faceId || '').trim()])}
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

      <Dialog open={!!deleteFaceTarget} onClose={() => setDeleteFaceTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{trashEnabled ? '移入回收站' : '永久删除面'}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.72)' }}>
            {trashEnabled
              ? `确定将笔记的「${deleteFaceTarget ? faceLabel(deleteFaceTarget, faceManifests) : ''}」面移入回收站吗？删除后可在回收站恢复。`
              : `回收站当前未启用。确定永久删除笔记的「${deleteFaceTarget ? faceLabel(deleteFaceTarget, faceManifests) : ''}」面吗？此操作不可撤销。`}
          </Typography>
          {dirty && isHtmlFaceId(deleteFaceTarget || '', faceManifests) ? (
            <Typography sx={{ mt: 1, fontSize: 12, lineHeight: 1.6, color: 'rgba(0,0,0,.56)' }}>
              提示：会丢弃该面的未保存改动。
            </Typography>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteFaceTarget(null)} disabled={deleting === 'face'}>取消</Button>
          <Button variant="contained" color="error" onClick={() => void confirmDeleteFace()} disabled={deleting === 'face'}>
            {deleting === 'face' ? '处理中…' : trashEnabled ? '移入回收站' : '永久删除'}
          </Button>
        </DialogActions>
      </Dialog>

      {favoritesDoc && favoritesTargets.target ? (
        <FavoritesTreePickerDialog
          open={favoritesTargets.pickerOpen}
          doc={favoritesDoc}
          kind={favoritesTargets.target.kind}
          targetId={favoritesTargets.target.id}
          onClose={favoritesTargets.closePicker}
          onSave={favoritesTargets.saveResult}
        />
      ) : null}

      {!isDraft && String(note.dir || '').trim() ? (
        <NoteVersionHistoryDialog
          open={versionHistoryOpen}
          gateway={gateway}
          scope={scope}
          packageDir={note.dir}
          dirty={dirty}
          onClose={() => setVersionHistoryOpen(false)}
          onSaveCurrent={saveCurrentForVersionPublish}
          onRestoreVersion={handleRestoreVersion}
        />
      ) : null}

      {!isDraft && String(note.dir || '').trim() ? (
        <NoteSettingsDialog
          open={noteSettingsOpen}
          onClose={() => setNoteSettingsOpen(false)}
          gateway={gateway}
          scope={scope}
          packageDir={note.dir}
          faceManifests={faceManifests}
          faceOrder={faces}
          htmlFacePreferences={htmlFacePreferences}
          globalHtmlFaceMode={htmlFaceDisplayMode}
          globalHtmlFaceScale={htmlFaceGlobalDefaultScale}
          onManifestSaved={applyNoteManifest}
        />
      ) : null}

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
