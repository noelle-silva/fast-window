import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputBase, Typography } from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'

import { type HyperCortexNoteManifestV1, type HyperCortexNoteResourceRef } from '../noteSchema'
import { getBacklinksFor, getFaceBacklinksFor, isBacklinkStaleFor, type NoteRefEntryMap, type NoteRefIndex } from '../noteRefs'
import { buildNotePlaceholderForCopy } from '../notePlaceholder'
import { mergeNoteResources } from '../noteResources'
import { uploadPastedAssetFiles } from '../services/pastedAssetUpload'
import type { NoteMeta, VaultScope } from '../core'
import type { HyperCortexGateway } from '../gateway'
import type { SaveNoteFaceContentInput } from '../gateway/types'
import { resolveNoteFaceOrder } from '../facePreferences'
import type { HyperCortexNoteFaceManifestV2 } from '../noteFaces'
import type { FaceDeclaration } from '../shared/faceDeclarations'
import { isDraftNoteId } from '../drafts'
import type { HyperCortexFavoritesDocV1 } from '../favorites'
import { FavoritesTreePickerDialog } from './FavoritesTreePickerDialog'
import { useFavoriteTargets } from './useFavoriteTargets'
import { NoteInfoSidebar } from './NoteInfoSidebar'
import { NoteVersionHistoryDialog } from './note-version-history/NoteVersionHistoryDialog'
import { NoteSettingsDialog } from './note-settings/NoteSettingsDialog'
import { useWorkspaceVisible } from './workspaceVisibility'
import {
  faceManifestFromDeclaration,
  filterCreatableFaceDeclarations,
  getFaceDeclaration,
  getFaceViewPlugin,
  resolveFaceCapabilities,
  resolveFaceLabel,
  useFaceContent,
  useFaceDeclarations,
  type FaceContentStore,
  type FaceViewContext,
} from '../facePlugins'
import { resolveFaceSettingValues } from '../facePlugins/settings'

import {
  appendTag,
  areNoteBaseFieldsEqual,
  normalizeTagText,
  type NoteBaseFields,
  type NoteFaceId,
} from './note-detail/noteDetailTools'
import { NoteDetailTopBar } from './note-detail/NoteDetailTopBar'

function FaceEmptyState(props: { declarations: readonly FaceDeclaration[]; onCreateFace: (kind: string) => void }): React.ReactNode {
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
        {props.declarations.map(declaration => (
          <Box
            key={declaration.kind}
            role="button"
            tabIndex={0}
            onClick={() => props.onCreateFace(declaration.kind)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                props.onCreateFace(declaration.kind)
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
            {declaration.label}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

export type NoteDetailSnapshotV1 = {
  baseFields: NoteBaseFields
  faceManifests: Record<string, HyperCortexNoteFaceManifestV2>
  /** 会话迁移时带走的面草稿内容（含未保存改动）。 */
  faceContents: Record<string, string>
  /** 会话迁移时带走的各面已保存内容（放弃改动时回退用）。 */
  savedFaceContents: Record<string, string>
  editing: boolean
  faceViewState: Record<string, unknown>
  face: NoteFaceId
  faces: NoteFaceId[]
  editTitle: string
  editDescription: string
  editTags: string[]
  editResources: HyperCortexNoteResourceRef[]
  /** 未回车的标签输入文本（会话迁移时保留）。 */
  tagInput: string
  noteTimes: { createdAtMs: number; updatedAtMs: number }
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
  facePluginGlobalSettings?: Record<string, Record<string, unknown>>
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
    facePluginGlobalSettings = {},
    globalFaceKindOrder = [],
  } = props
  const workspaceVisible = useWorkspaceVisible()

  const noteId = String(note.id || '').trim()
  const isDraft = isDraftNoteId(noteId) || !String(note.dir || '').trim()
  const packageAvailable = !isDraft && !!String(note.dir || '').trim()
  const faceDeclarations = useFaceDeclarations()
  const creatableFaceDeclarations = React.useMemo(
    () => filterCreatableFaceDeclarations(faceDeclarations),
    [faceDeclarations],
  )

  const initRef = React.useRef<NoteDetailSnapshotV1 | null | undefined>(undefined)
  if (initRef.current === undefined) initRef.current = consumeInitSnapshot(noteId)
  const init = initRef.current

  const [faceManifests, setFaceManifests] = React.useState<Record<string, HyperCortexNoteFaceManifestV2>>(init?.faceManifests ?? {})
  const [loaded, setLoaded] = React.useState(() => !!init || isDraft)
  const [noteTimes, setNoteTimes] = React.useState(() => init?.noteTimes ?? {
    createdAtMs: Number(note.createdAtMs) > 0 ? Number(note.createdAtMs) : Date.now(),
    updatedAtMs: Number(note.updatedAtMs) > 0 ? Number(note.updatedAtMs) : Date.now(),
  })
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  const [editing, setEditing] = React.useState(init?.editing ?? (isDraft ? true : false))
  const [faceViewState, setFaceViewState] = React.useState<Record<string, unknown>>(init?.faceViewState ?? {})
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
  const [editTags, setEditTags] = React.useState<string[]>(init?.editTags ?? [])
  const [tagInput, setTagInput] = React.useState(init?.tagInput ?? '')
  const [editResources, setEditResources] = React.useState<HyperCortexNoteResourceRef[]>(init?.editResources ?? [])

  const [addFaceSelectorVisible, setAddFaceSelectorVisible] = React.useState(false)
  const [pendingAddFace, setPendingAddFace] = React.useState<NoteFaceId | null>(null)

  const [moreMenuAnchorEl, setMoreMenuAnchorEl] = React.useState<HTMLElement | null>(null)
  const moreMenuOpen = !!moreMenuAnchorEl
  const [deleteFaceMenuAnchorEl, setDeleteFaceMenuAnchorEl] = React.useState<HTMLElement | null>(null)
  const deleteFaceMenuOpen = !!deleteFaceMenuAnchorEl
  const closeMoreMenu = React.useCallback(() => {
    setMoreMenuAnchorEl(null)
    setDeleteFaceMenuAnchorEl(null)
  }, [])

  const [deleteNoteConfirmOpen, setDeleteNoteConfirmOpen] = React.useState(false)
  const [deleteFaceTarget, setDeleteFaceTarget] = React.useState<NoteFaceId | null>(null)
  const [versionHistoryOpen, setVersionHistoryOpen] = React.useState(false)
  const [noteSettingsOpen, setNoteSettingsOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState<'note' | 'face' | ''>('')

  const [baseFields, setBaseFields] = React.useState<NoteBaseFields>(
    init?.baseFields ?? {
      title: note.title || '未命名',
      description: note.description || '',
      tags: [],
      resources: [],
    },
  )

  // 面内容存储：内容由插件持有，宿主只取内容与脏标记，不持久化内容本身。
  const faceStoresRef = React.useRef<Record<string, FaceContentStore>>({})
  const faceSavedContentsRef = React.useRef<Record<string, string>>(init?.savedFaceContents ?? {})
  // 已保存的面 ID 集合：放弃改动时用于回退本会话新增（尚未落盘）的面。
  const savedFaceIdsRef = React.useRef<Set<string>>(new Set(Object.keys(init?.faceManifests ?? {})))
  const [faceDirtyVersion, setFaceDirtyVersion] = React.useState(0)
  const dirtyNotifyRef = React.useRef<() => void>(() => {})
  React.useEffect(() => {
    dirtyNotifyRef.current = () => setFaceDirtyVersion(v => v + 1)
  }, [])
  const createFaceStore = React.useCallback((faceId: string, kind: string, initialContent: string, savedContent?: string): FaceContentStore | null => {
    const plugin = getFaceViewPlugin(kind)
    if (!plugin) return null
    const store = plugin.createContentStore({ faceId, initialContent, savedContent })
    store.subscribe(() => dirtyNotifyRef.current())
    return store
  }, [])
  const storesInitializedRef = React.useRef(false)
  if (!storesInitializedRef.current) {
    storesInitializedRef.current = true
    if (init?.faceContents) {
      for (const [faceId, manifest] of Object.entries(init.faceManifests || {})) {
        // 会话迁移：草稿内容与已保存基线分离播种，未保存的面保持脏状态。
        const store = createFaceStore(faceId, manifest.kind, init.faceContents[faceId] ?? '', init.savedFaceContents?.[faceId] ?? '')
        if (store) faceStoresRef.current[faceId] = store
      }
    }
  }

  const uploadPastedFiles = React.useCallback(
    (files: File[]) => uploadPastedAssetFiles(gateway, scope, files),
    [gateway, scope],
  )
  const handleResourcesAdded = React.useCallback((resources: HyperCortexNoteResourceRef[]) => {
    setEditResources(prev => mergeNoteResources(prev, resources))
  }, [])
  // 播放上报稳定化：宿主每次渲染都换回调引用，经 ref 包装避免插件上下文被无谓全量重建。
  const onPlayingChangeRef = React.useRef(onPlayingChange)
  React.useEffect(() => {
    onPlayingChangeRef.current = onPlayingChange
  }, [onPlayingChange])
  const stableOnPlayingChange = React.useCallback((playing: boolean) => {
    onPlayingChangeRef.current?.(playing)
  }, [])

  // 面视窗只按类型从注册表挂载；宿主不识别具体面的界面实现。
  const faceViewPlugin = getFaceViewPlugin(String(faceManifests[face]?.kind || ''))
  const FaceReadView = faceViewPlugin?.ReadView || null
  const FaceEditView = faceViewPlugin?.EditView || null
  const FaceToolbarLeft = faceViewPlugin?.Toolbars?.left || null
  const FaceToolbarRight = faceViewPlugin?.Toolbars?.right || null

  const handleFaceViewStateChange = React.useCallback((patch: Record<string, unknown>) => {
    setFaceViewState(prev => ({ ...prev, ...patch }))
  }, [])
  const resetFaceViewState = React.useCallback(() => {
    const plugin = getFaceViewPlugin(String(faceManifests[face]?.kind || ''))
    setFaceViewState(prev => ({ ...prev, ...(plugin ? plugin.defaultViewState : {}) }))
  }, [face, faceManifests])

  // 当前面的内容由插件存储持有；宿主只订阅内容用于渲染与保存。
  const activeContent = useFaceContent(faceStoresRef.current[face] || null)

  const draftFields = React.useMemo<NoteBaseFields>(() => ({
    title: editTitle,
    description: editDescription,
    tags: editTags,
    resources: editResources,
  }), [editDescription, editResources, editTags, editTitle])

  const fieldsDirty = React.useMemo(() => !areNoteBaseFieldsEqual(draftFields, baseFields), [baseFields, draftFields])
  const facesDirty = React.useMemo(
    () => Object.values(faceStoresRef.current).some(store => store.isDirty()),
    [faceDirtyVersion],
  )
  const dirty = fieldsDirty || facesDirty
  // 外部（索引页信息编辑等）更新笔记元信息时：未处于脏状态则同步到会话编辑字段；脏状态以用户改动优先。
  const lastSyncedNoteRef = React.useRef({ title: note.title, description: note.description })
  React.useEffect(() => {
    const last = lastSyncedNoteRef.current
    if (last.title === note.title && last.description === note.description) return
    lastSyncedNoteRef.current = { title: note.title, description: note.description }
    if (fieldsDirty) return
    setEditTitle(note.title || '未命名')
    setEditDescription(note.description || '')
  }, [fieldsDirty, note.description, note.title])
  const noteTitleForPrompt = React.useMemo(() => {
    const s = String(editTitle || note.title || '').trim()
    return s || '未命名'
  }, [editTitle, note.title])
  const deletableFaceIds = React.useMemo(
    () => faces.filter(faceId => {
      const manifest = faceManifests[faceId]
      return !!resolveFaceCapabilities(manifest?.kind || '', manifest?.capabilities)?.deletable
    }),
    [faceManifests, faces],
  )
  const activeFaceKind = String(faceManifests[face]?.kind || '')
  const activeFaceDeclaration = React.useMemo(
    () => getFaceDeclaration(activeFaceKind),
    [activeFaceKind, faceDeclarations],
  )
  // 面视窗的实际编辑态判据：宿主处于编辑模式且当前面按声明具备可编辑能力。
  // 不可编辑的面（含未知类型）始终保持阅读态，不因模式切换落入占位或强行进入编辑；
  // 编辑模式仍服务于笔记级字段（标题/标签）的编辑。
  const faceEditing = editing && !!resolveFaceCapabilities(activeFaceKind, faceManifests[face]?.capabilities)?.editable
  const faceGlobalSettings = React.useMemo(
    () => facePluginGlobalSettings[activeFaceKind] || {},
    [activeFaceKind, facePluginGlobalSettings],
  )
  const faceNoteSettings = React.useMemo(
    () => (faceManifests[face]?.settings || {}) as Record<string, unknown>,
    [face, faceManifests],
  )
  // 面设置统一按「笔记级覆盖 > 全局值 > 声明默认」解析（Q33/Q34/Q35）。
  const faceEffectiveSettings = React.useMemo(
    () => resolveFaceSettingValues(activeFaceDeclaration?.settings, { noteSettings: faceNoteSettings, globalSettings: faceGlobalSettings }),
    [activeFaceDeclaration, faceGlobalSettings, faceNoteSettings],
  )
  // 笔记级设置写回后，把最新面清单同步到会话状态（面顺序与缩放覆盖共用同一入口）。
  const applyNoteManifest = React.useCallback((manifest: HyperCortexNoteManifestV1) => {
    setFaceManifests(manifest.faces)
    const nextFaces = resolveNoteFaceOrder({ faceOrder: manifest.faceOrder, faces: manifest.faces, globalKindOrder: globalFaceKindOrder })
    setFaces(nextFaces)
    setFace(prev => (nextFaces.includes(prev) ? prev : nextFaces[0] || ''))
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

  const confirmDeleteNote = React.useCallback(async () => {
    if (deleting || saving) return
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
  }, [deleting, gateway, note, onRequestDeleteNote, saving, trashEnabled])

  const requestDeleteFace = React.useCallback((faceId: string) => {
    closeMoreMenu()
    setDeleteFaceTarget(String(faceId || '').trim() || null)
  }, [closeMoreMenu])

  const confirmDeleteFace = React.useCallback(async () => {
    const targetFaceId = String(deleteFaceTarget || '').trim()
    const dir = String(note.dir || '').trim()
    if (!targetFaceId || !dir || deleting || saving) return
    setDeleting('face')
    try {
      const mode: 'trash' | 'permanent' = trashEnabled ? 'trash' : 'permanent'
      const result = await gateway.notes.deleteNoteFace(scope, dir, targetFaceId, mode)
      delete faceStoresRef.current[targetFaceId]
      delete faceSavedContentsRef.current[targetFaceId]
      applyNoteManifest(result.manifest)
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
  }, [applyNoteManifest, deleteFaceTarget, deleting, gateway, note.dir, noteId, onSaved, saving, scope, trashEnabled])

  const updateFaceSettings = React.useCallback(async (patch: Record<string, unknown | null>) => {
    const dir = String(note.dir || '').trim()
    const faceId = String(face || '').trim()
    if (!dir || !faceId) return
    const result = await gateway.notes.saveFaceSettings(scope, dir, faceId, patch)
    applyNoteManifest(result.manifest)
  }, [applyNoteManifest, face, gateway, note.dir, scope])

  const faceViewContext: FaceViewContext = React.useMemo(() => ({
    gateway,
    scope,
    noteIndexMap,
    getNoteMeta: noteId => allNotesById[noteId],
    onOpenNote,
    onPlayingChange: stableOnPlayingChange,
    uploadFiles: uploadPastedFiles,
    onResourcesAdded: handleResourcesAdded,
    settings: faceEffectiveSettings,
    noteSettings: faceNoteSettings,
    globalSettings: faceGlobalSettings,
    updateSettings: String(note.dir || '').trim() ? updateFaceSettings : undefined,
  }), [allNotesById, faceEffectiveSettings, faceGlobalSettings, faceNoteSettings, gateway, handleResourcesAdded, note.dir, noteIndexMap, onOpenNote, scope, stableOnPlayingChange, updateFaceSettings, uploadPastedFiles])

  /** 统一读取通道：按笔记包读取清单与各面内容，构建内容存储与已保存基线。 */
  const readNotePackage = React.useCallback(async (packageDir: string): Promise<{
    manifest: HyperCortexNoteManifestV1
    stores: Record<string, FaceContentStore>
    savedContents: Record<string, string>
  }> => {
    const manifest = await gateway.notes.loadNoteManifest(scope, packageDir)
    const faceIds = Object.keys(manifest.faces)
    const faceDocs = await Promise.all(
      faceIds.map(id => gateway.notes.loadNoteFace(scope, packageDir, id).catch(() => null)),
    )
    const stores: Record<string, FaceContentStore> = {}
    const savedContents: Record<string, string> = {}
    for (let i = 0; i < faceIds.length; i++) {
      const faceId = faceIds[i]
      const content = faceDocs[i]?.content ?? ''
      savedContents[faceId] = content
      const store = createFaceStore(faceId, manifest.faces[faceId].kind, content)
      if (store) stores[faceId] = store
    }
    return { manifest, stores, savedContents }
  }, [createFaceStore, gateway, scope])

  /** 统一装载应用：把读取结果一次性落到会话状态（内容存储、面清单、笔记级字段与时间）。 */
  const applyLoadedNote = React.useCallback((
    manifest: HyperCortexNoteManifestV1,
    stores: Record<string, FaceContentStore>,
    savedContents: Record<string, string>,
  ) => {
    faceStoresRef.current = stores
    faceSavedContentsRef.current = savedContents
    savedFaceIdsRef.current = new Set(Object.keys(manifest.faces))
    applyNoteManifest(manifest)
    const nextBase: NoteBaseFields = {
      title: manifest.title || note.title || '未命名',
      description: manifest.description || note.description || '',
      tags: (manifest.tags || []).slice(),
      resources: manifest.resources || [],
    }
    setBaseFields(nextBase)
    setEditTitle(nextBase.title)
    setEditDescription(nextBase.description)
    setEditTags(nextBase.tags.slice())
    setEditResources(nextBase.resources.slice())
    setNoteTimes({ createdAtMs: manifest.createdAtMs, updatedAtMs: manifest.updatedAtMs })
    setTagInput('')
  }, [applyNoteManifest, note.description, note.title])

  const loadNoteIfNeeded = React.useCallback(async (options?: { force?: boolean }) => {
    if (!noteId) return
    if (isDraft) return
    if (loaded && !options?.force) return
    if (!String(note.dir || '').trim()) return

    if (!options?.force) setLoading(true)
    setLoadError(null)
    try {
      const { manifest, stores, savedContents } = await readNotePackage(note.dir)
      applyLoadedNote(manifest, stores, savedContents)
      setFacesReady(true)
      setLoaded(true)
    } catch (e: any) {
      if (options?.force) {
        void gateway.host.toast(String(e?.message || e || '刷新笔记失败'))
      } else {
        setLoadError(String(e?.message || e || '加载笔记失败'))
      }
    } finally {
      if (!options?.force) setLoading(false)
    }
  }, [applyLoadedNote, gateway.host, isDraft, loaded, note.dir, noteId, readNotePackage])

  // 单一装载触发：仅当前标签可见时装载（守卫负责去重，避免同帧双装载）。
  React.useEffect(() => {
    if (!visible) return
    void loadNoteIfNeeded()
  }, [loadNoteIfNeeded, visible])

  // 出链与卡片预取统一从各面草稿内容提取（未保存的引用同样可见）；按面类型派发到各自的引用解析器。
  const draftRefIds = React.useMemo(() => {
    const ids = new Set<string>()
    for (const [faceId, store] of Object.entries(faceStoresRef.current)) {
      const kind = String(faceManifests[faceId]?.kind || '').trim()
      const refs = kind ? getFaceViewPlugin(kind)?.extractRefs?.(store.getContent()) || [] : []
      for (const ref of refs) {
        const noteId = String(ref?.noteId || '').trim()
        if (noteId) ids.add(noteId)
      }
    }
    return Array.from(ids)
  }, [faceDirtyVersion, loaded, faceManifests])

  const outgoingIds = React.useMemo(() => (infoSidebarVisible ? draftRefIds : []), [draftRefIds, infoSidebarVisible])

  React.useEffect(() => {
    if (!onEnsureNoteCardInfoLoaded) return
    if (!loaded) return
    for (const id of draftRefIds) {
      const meta = allNotesById[id]
      if (!meta) continue
      try {
        void Promise.resolve(onEnsureNoteCardInfoLoaded(meta)).catch(() => {})
      } catch (_) {}
    }
  }, [allNotesById, draftRefIds, loaded, onEnsureNoteCardInfoLoaded])

  const allBacklinks = React.useMemo(() => {
    if (!noteId) return []
    return getBacklinksFor(refIndex, noteId)
  }, [noteId, refIndex])

  const faceBacklinkGroups = React.useMemo(() => {
    if (!noteId) return []
    return faces
      .map(faceId => ({
        faceId,
        label: `${resolveFaceLabel(faceId, faceManifests)}面引用`,
        refs: getFaceBacklinksFor(refIndex, noteId, faceId),
      }))
      .filter(group => group.refs.length > 0)
  }, [faces, faceManifests, noteId, refIndex])

  const handleAddTag = React.useCallback(() => {
    setEditTags(prev => appendTag(prev, tagInput))
    setTagInput('')
  }, [tagInput])

  const handleRemoveTag = React.useCallback((tag: string) => {
    setEditTags(prev => prev.filter(item => item !== tag))
  }, [])

  const handleToggleMode = React.useCallback(() => {
    if (!loaded) return
    setEditing(prev => !prev)
  }, [loaded])

  const handleDiscard = React.useCallback(() => {
    if (saving || deleting) return
    setEditTitle(baseFields.title)
    setEditDescription(baseFields.description)
    setEditTags(baseFields.tags.slice())
    setEditResources(baseFields.resources.slice())
    for (const [faceId, store] of Object.entries(faceStoresRef.current)) {
      store.reset(faceSavedContentsRef.current[faceId] ?? '')
    }
    // 回退本会话新增（尚未落盘）的面：移除其内容存储、面清单与切换状态。
    const savedIds = savedFaceIdsRef.current
    for (const faceId of Object.keys(faceStoresRef.current)) {
      if (!savedIds.has(faceId)) delete faceStoresRef.current[faceId]
    }
    setFaceManifests(prev => {
      const next: Record<string, HyperCortexNoteFaceManifestV2> = {}
      for (const [id, manifest] of Object.entries(prev)) {
        if (savedIds.has(id)) next[id] = manifest
      }
      return next
    })
    const nextFaces = faces.filter(id => savedIds.has(id))
    setFaces(nextFaces)
    setFace(prev => (nextFaces.includes(prev) ? prev : nextFaces[0] || ''))
    setTagInput('')
    setAddFaceSelectorVisible(false)
    setPendingAddFace(null)
    resetFaceViewState()
    setEditing(false)
  }, [baseFields, deleting, faces, resetFaceViewState, saving])

  /** 会话迁移快照：草稿首次落盘换 id 时完整带走当前会话状态。 */
  const buildSessionSnapshot = React.useCallback((input: {
    baseFields: NoteBaseFields
    manifest: HyperCortexNoteManifestV1
    title: string
    description: string
    tags: string[]
    updatedAtMs: number
  }): NoteDetailSnapshotV1 => ({
    baseFields: input.baseFields,
    faceManifests: input.manifest.faces,
    faceContents: Object.fromEntries(Object.entries(faceStoresRef.current).map(([id, store]) => [id, store.getContent()])),
    savedFaceContents: { ...faceSavedContentsRef.current },
    editing,
    faceViewState,
    face,
    faces: resolveNoteFaceOrder({ faceOrder: input.manifest.faceOrder, faces: input.manifest.faces, globalKindOrder: globalFaceKindOrder }),
    editTitle: input.title,
    editDescription: input.description,
    editTags: input.tags.slice(),
    editResources,
    tagInput,
    noteTimes: { createdAtMs: noteTimes.createdAtMs, updatedAtMs: input.updatedAtMs },
    infoSidebarVisible,
  }), [editResources, editing, face, faceViewState, globalFaceKindOrder, infoSidebarVisible, noteTimes.createdAtMs, tagInput])

  /** 统一保存管线：当前面（current）与所有面（all）共用同一提交、回收与快照逻辑，仅提交范围不同。 */
  const saveSessionToDisk = React.useCallback(async (mode: 'current' | 'all'): Promise<boolean> => {
    if (!noteId) return false
    if (saving || deleting) return false
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
      const tags = editTags.map(normalizeTagText).filter(Boolean)
      // 当前笔记的面清单（按界面顺序）：保存时确保这些面存在，即新笔记默认面的落盘点。
      const faceKinds = faces.map(faceId => String(faceManifests[faceId]?.kind || '').trim()).filter(Boolean)
      // 提交范围：当前面只取该面的内容存储；所有面按草稿规则（草稿首次落盘提交全部存在面，已保存笔记只提交有改动的面）。
      const facePayloads: SaveNoteFaceContentInput[] = []
      if (mode === 'current') {
        const activeManifest = faceManifests[face]
        const activeStore = faceStoresRef.current[face]
        if (activeManifest && activeStore) {
          facePayloads.push({ faceId: face, kind: activeManifest.kind, content: activeStore.getContent() })
        }
      } else {
        for (const faceId of faces) {
          const faceManifest = faceManifests[faceId]
          const store = faceStoresRef.current[faceId]
          if (!faceManifest || !store) continue
          if (isDraft || store.isDirty()) {
            facePayloads.push({ faceId, kind: faceManifest.kind, content: store.getContent() })
          }
        }
      }

      const result = await gateway.notes.saveNoteFaces(scope, {
        id: isDraft ? undefined : originalId,
        packageDir: isDraft ? undefined : note.dir,
        title,
        description,
        tags,
        createdAtMs: noteTimes.createdAtMs,
        resources: editResources,
        faceKinds,
        faces: facePayloads,
      })

      for (const payload of facePayloads) {
        const store = faceStoresRef.current[payload.faceId]
        if (store) store.reset(payload.content)
        faceSavedContentsRef.current[payload.faceId] = payload.content
      }
      applyNoteManifest(result.manifest)

      const nextBaseFields: NoteBaseFields = { title, description, tags: tags.slice(), resources: editResources }
      setBaseFields(nextBaseFields)
      const nextUpdatedAtMs = result.meta.updatedAtMs
      setNoteTimes(prev => ({ createdAtMs: prev.createdAtMs, updatedAtMs: nextUpdatedAtMs }))

      const didMigrateId = isDraft && result.meta.id !== originalId
      const snapshotForNewId: NoteDetailSnapshotV1 | undefined = didMigrateId
        ? buildSessionSnapshot({ baseFields: nextBaseFields, manifest: result.manifest, title, description, tags, updatedAtMs: nextUpdatedAtMs })
        : undefined

      onSaved({ originalId, meta: result.meta, snapshotForNewId, refsForIndex: result.refs })
      await gateway.host.toast(mode === 'current' ? '笔记已保存' : '笔记所有面已保存')
      return true
    } catch (e: any) {
      await gateway.host.toast(String(e?.message || e || '保存失败'))
      return false
    } finally {
      setSaving(false)
    }
  }, [applyNoteManifest, buildSessionSnapshot, deleting, editDescription, editResources, editTags, editTitle, face, faceManifests, faces, gateway, isDraft, note.dir, noteId, noteTimes, onSaved, saving, scope])

  const handleSave = React.useCallback(async () => saveSessionToDisk('current'), [saveSessionToDisk])

  const saveCurrentForVersionPublish = React.useCallback(async () => {
    const saved = await handleSave()
    if (!saved) throw new Error('保存当前笔记失败，已停止发布版本')
  }, [handleSave])

  // Q24：保存整个笔记所有面——与「保存当前面」共用同一保存管线，仅提交范围不同。
  const handleSaveAllFaces = React.useCallback(async () => saveSessionToDisk('all'), [saveSessionToDisk])

  const handleRestoreVersion = React.useCallback(async (versionId: string) => {
    const dir = String(note.dir || '').trim()
    if (!dir) throw new Error('请先保存笔记，再恢复版本')
    const result = await gateway.notes.restoreNoteVersion(scope, dir, versionId)
    // 恢复已落盘：经统一读取通道重建会话内容与基线，不再维护第二套装载逻辑。
    const { manifest, stores, savedContents } = await readNotePackage(result.meta.dir)
    applyLoadedNote(manifest, stores, savedContents)
    setEditing(false)
    resetFaceViewState()

    onSaved({ originalId: noteId, meta: result.meta, refsForIndex: result.refs })
  }, [applyLoadedNote, gateway, note.dir, noteId, onSaved, readNotePackage, resetFaceViewState, scope])

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

  const handleCopyNoteRef = React.useCallback(() => {
    void gateway.clipboard.writeText(buildNotePlaceholderForCopy(noteId, editTitle || note.title || ''))
    void gateway.host.toast('已复制引用占位符')
  }, [editTitle, gateway, note.title, noteId])

  const copyFaceRef = React.useCallback((faceId: string) => {
    const face = String(faceId || '').trim()
    if (!face) return
    const title = editTitle || note.title || ''
    void gateway.clipboard.writeText(buildNotePlaceholderForCopy(noteId, title, face))
    void gateway.host.toast('已复制此面引用占位符')
  }, [editTitle, gateway, note.title, noteId])

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
    const declaration = getFaceDeclaration(targetKind)
    if (!declaration || !resolveFaceCapabilities(targetKind)?.creatable) return
    if (!loaded) return
    if (Object.values(faceManifests).some(face => face.kind === declaration.kind)) return
    const nextFace = faceManifestFromDeclaration(declaration)
    // 新面从空白草稿开始；落盘时由后端按面协议生成空白内容。
    const store = createFaceStore(nextFace.id, declaration.kind, '')
    if (store) faceStoresRef.current[nextFace.id] = store
    faceSavedContentsRef.current[nextFace.id] = ''
    setFaceManifests(prev => ({ ...prev, [nextFace.id]: nextFace }))
    setFaces(prev => (prev.includes(nextFace.id) ? prev : [...prev, nextFace.id]))
    setFace(nextFace.id)
    setEditing(true)
    setAddFaceSelectorVisible(false)
    setPendingAddFace(null)
  }, [createFaceStore, faceManifests, loaded, pendingAddFace])

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
      <NoteDetailTopBar
        loading={loading}
        loadError={loadError}
        loaded={loaded}
        editing={editing}
        saving={saving}
        dirty={dirty}
        isDraft={isDraft}
        packageAvailable={packageAvailable}
        faceEditing={faceEditing}
        onToggleMode={handleToggleMode}
        onSave={handleSave}
        onSaveAllFaces={handleSaveAllFaces}
        onDiscard={handleDiscard}
        FaceToolbarLeft={FaceToolbarLeft}
        FaceToolbarRight={FaceToolbarRight}
        faceViewState={faceViewState}
        onFaceViewStateChange={handleFaceViewStateChange}
        faceViewContext={faceViewContext}
        moreMenuOpen={moreMenuOpen}
        moreMenuAnchorEl={moreMenuAnchorEl}
        onMoreMenuOpen={setMoreMenuAnchorEl}
        onMoreMenuClose={closeMoreMenu}
        onOpenNoteDir={requestOpenNoteDir}
        onOpenVersionHistory={requestOpenVersionHistory}
        onOpenNoteSettings={() => setNoteSettingsOpen(true)}
        canFavorite={!!favoritesDoc}
        onOpenFavorites={openFavoritesPicker}
        onRequestDeleteNote={requestDeleteNote}
        deletableFaceIds={deletableFaceIds}
        deleteFaceMenuOpen={deleteFaceMenuOpen}
        deleteFaceMenuAnchorEl={deleteFaceMenuAnchorEl}
        onDeleteFaceMenuOpen={setDeleteFaceMenuAnchorEl}
        onDeleteFaceMenuClose={() => setDeleteFaceMenuAnchorEl(null)}
        onRequestDeleteFace={requestDeleteFace}
        onCopyNoteRef={handleCopyNoteRef}
        infoSidebarVisible={infoSidebarVisible}
        onToggleInfoSidebar={() => setInfoSidebarVisible(prev => !prev)}
        addFaceSelectorVisible={addFaceSelectorVisible}
        onToggleAddFaceSelector={() => setAddFaceSelectorVisible(prev => !prev)}
        creatableFaceDeclarations={creatableFaceDeclarations}
        pendingAddFace={pendingAddFace}
        onPickAddFace={setPendingAddFace}
        onConfirmAddFace={() => void handleAddFace()}
        face={face}
        faces={faces}
        faceManifests={faceManifests}
        onSelectFace={setFace}
        onCopyFaceRef={copyFaceRef}
      />

      {loading ? <Typography sx={{ pt: 7 }} color="text.secondary">正在加载笔记...</Typography> : null}
      {!loading && loadError ? <Typography sx={{ pt: 7 }} color="error">{loadError}</Typography> : null}

      {!loading && !loadError && loaded ? (
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
                {editTitle || note.title || '未命名'}
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
              <FaceEmptyState declarations={creatableFaceDeclarations} onCreateFace={kind => void handleAddFace(kind)} />
            ) : FaceReadView ? (
              faceEditing && FaceEditView ? (
                <FaceEditView
                  content={activeContent.content}
                  visible={visible}
                  onChange={activeContent.setContent}
                  viewState={faceViewState}
                  onViewStateChange={handleFaceViewStateChange}
                  context={faceViewContext}
                />
              ) : (
                <FaceReadView content={activeContent.content} visible={visible} viewState={faceViewState} onViewStateChange={handleFaceViewStateChange} context={faceViewContext} />
              )
            ) : (
              <Box sx={{ mt: 0.5, px: 2, py: 5, borderRadius: 3, bgcolor: 'rgba(15,23,42,.035)', textAlign: 'center' }}>
                <Typography sx={{ fontSize: 14, lineHeight: 1.6, color: 'rgba(0,0,0,.55)' }}>
                  该面的类型暂不支持显示，内容已原样保留
                </Typography>
              </Box>
            )}

            </Box>
          </Box>

          {infoSidebarVisible ? (
            <Box sx={{ flex: '0 0 280px', width: 280, minWidth: 280, minHeight: 0, overflow: 'auto', overscrollBehavior: 'contain' }}>
              <NoteInfoSidebar
                noteId={noteId}
                description={editDescription}
                editing={editing}
                createdAtMs={noteTimes.createdAtMs}
                updatedAtMs={noteTimes.updatedAtMs}
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

      <Dialog open={workspaceVisible && deleteNoteConfirmOpen} onClose={() => setDeleteNoteConfirmOpen(false)} maxWidth="xs" fullWidth>
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
          <Button variant="contained" color="error" onClick={() => void confirmDeleteNote()} disabled={deleting === 'note' || saving}>
            {deleting === 'note' ? '处理中…' : isDraft ? '删除' : trashEnabled ? '移入回收站' : '永久删除'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={workspaceVisible && !!deleteFaceTarget} onClose={() => setDeleteFaceTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{trashEnabled ? '移入回收站' : '永久删除面'}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.72)' }}>
            {trashEnabled
              ? `确定将笔记的「${deleteFaceTarget ? resolveFaceLabel(deleteFaceTarget, faceManifests) : ''}」面移入回收站吗？删除后可在回收站恢复。`
              : `回收站当前未启用。确定永久删除笔记的「${deleteFaceTarget ? resolveFaceLabel(deleteFaceTarget, faceManifests) : ''}」面吗？此操作不可撤销。`}
          </Typography>
          {dirty && !!faceStoresRef.current[String(deleteFaceTarget || '').trim()]?.isDirty() ? (
            <Typography sx={{ mt: 1, fontSize: 12, lineHeight: 1.6, color: 'rgba(0,0,0,.56)' }}>
              提示：会丢弃该面的未保存改动。
            </Typography>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteFaceTarget(null)} disabled={deleting === 'face'}>取消</Button>
          <Button variant="contained" color="error" onClick={() => void confirmDeleteFace()} disabled={deleting === 'face' || saving}>
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
          facePluginGlobalSettings={facePluginGlobalSettings}
          onManifestSaved={applyNoteManifest}
        />
      ) : null}
    </Box>
  )
})
