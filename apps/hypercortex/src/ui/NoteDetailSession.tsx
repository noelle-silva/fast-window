import * as React from 'react'
import { Box, Typography } from '@mui/material'

import { type HyperCortexNoteManifestV1, type HyperCortexNoteResourceRef } from '../noteSchema'
import type { EntityIcon } from '../entityIcon'
import { mergeNoteResources } from '../noteResources'
import { uploadPastedAssetFiles } from '../services/pastedAssetUpload'
import type { NoteMeta, VaultScope } from '../core'
import type { HyperCortexGateway } from '../gateway'
import { resolveNoteFaceOrder } from '../facePreferences'
import type { HyperCortexNoteFaceManifestV2 } from '../noteFaces'
import type { HyperCortexGraphSettingsV1 } from '../graphSettings'
import { isDraftNoteId } from '../drafts'
import { collectFoldersForTarget, type HyperCortexFavoritesDocV1 } from '../favorites'
import {
  faceManifestFromDeclaration,
  filterCreatableFaceDeclarations,
  getFaceDeclaration,
  getFaceViewPlugin,
  resolveFaceCapabilities,
  useFaceContent,
  useFaceDeclarations,
  type FaceContentStore,
  type FaceViewContext,
} from '../facePlugins'
import { resolveFaceSettingValues } from '../facePlugins/settings'

import {
  appendTag,
  areNoteBaseFieldsEqual,
  type NoteBaseFields,
  type NoteFaceId,
} from './note-detail/noteDetailTools'
import { NoteDetailTopBarHost } from './note-detail/NoteDetailTopBarHost'
import { NoteDetailContentArea } from './note-detail/NoteDetailContentArea'
import { NoteDetailInfoSidebar } from './note-detail/NoteDetailInfoSidebar'
import { NoteDetailDialogs } from './note-detail/NoteDetailDialogs'
import { NoteConflictDialog } from './note-detail/NoteConflictDialog'
import { NoteLocalRelationGraphDialog } from './NoteLocalRelationGraphDialog'
import { useNoteDetailFaceContent } from './useNoteDetailFaceContent'
import { useNoteDetailReferences } from './useNoteDetailReferences'
import { useNoteDetailToolbar } from './useNoteDetailToolbar'
import { folderTitle } from './index-page/helpers'

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

/** 外部改动冲突：本地未保存改动与外部传入的同一笔记改动并存时，暂存外部版本供三栏对照与选择。 */
type NoteConflictState = {
  manifest: HyperCortexNoteManifestV1
  contents: Record<string, string>
}

export type NoteDetailSessionProps = {
  gateway: HyperCortexGateway
  scope: VaultScope
  note: NoteMeta
  visible: boolean
  bodyScrollRef?: React.Ref<HTMLDivElement>
  noteIndexMap: Record<string, { title: string; faceIds?: string[] }>
  allNotesById: Record<string, NoteMeta>
  refRelationsEpoch: number
  /** 外部改动信号：仓库笔记被外部改动时自增，会话据此就地刷新或提示冲突。 */
  externalChangeSignal?: number
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
  }) => void
  trashEnabled: boolean
  onRequestDeleteNote: (payload: { note: NoteMeta; mode: 'trash' | 'permanent' }) => Promise<void> | void
  favoritesDoc?: HyperCortexFavoritesDocV1 | null
  onFavoriteSaved?: (doc: HyperCortexFavoritesDocV1) => void
  /** 「收藏于」标签点击：把右侧收藏夹栏切到该收藏夹并指明该笔记条目。 */
  onRevealNoteInFavorites?: (folderId: string) => void
  onPlayingChange?: (playing: boolean) => void
  facePluginGlobalSettings?: Record<string, Record<string, unknown>>
  globalFaceKindOrder?: readonly string[]
  /** 全局关系图的持久化外观设置：局部关系图复用其外观，但不可在此修改。 */
  graphSettings: HyperCortexGraphSettingsV1
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
    refRelationsEpoch,
    externalChangeSignal = 0,
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
    onRevealNoteInFavorites,
    onPlayingChange,
    facePluginGlobalSettings = {},
    globalFaceKindOrder = [],
    graphSettings,
  } = props

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
  const [noteIcon, setNoteIcon] = React.useState<EntityIcon | undefined>(note.icon)
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

  const [deleting, setDeleting] = React.useState<'note' | 'face' | ''>('')

  const [localGraphOpen, setLocalGraphOpen] = React.useState(false)

  const [baseFields, setBaseFields] = React.useState<NoteBaseFields>(
    init?.baseFields ?? {
      title: note.title || '未命名',
      description: note.description || '',
      tags: [],
      resources: [],
    },
  )

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

  const draftFields = React.useMemo<NoteBaseFields>(() => ({
    title: editTitle,
    description: editDescription,
    tags: editTags,
    resources: editResources,
  }), [editDescription, editResources, editTags, editTitle])

  const fieldsDirty = React.useMemo(() => !areNoteBaseFieldsEqual(draftFields, baseFields), [baseFields, draftFields])
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
    setNoteIcon(manifest.icon)
    // 设置/图标等元数据写回会刷新笔记版本：同步会话版本标记，后续保存的保险丝才不会误判冲突。
    setNoteTimes({ createdAtMs: manifest.createdAtMs, updatedAtMs: manifest.updatedAtMs })
    const nextFaces = resolveNoteFaceOrder({ faceOrder: manifest.faceOrder, faces: manifest.faces, globalKindOrder: globalFaceKindOrder })
    setFaces(nextFaces)
    setFace(prev => (nextFaces.includes(prev) ? prev : nextFaces[0] || ''))
  }, [globalFaceKindOrder])

  // 外部改动冲突：脏状态下收到外部改动，或保存被版本保险丝拦下时，暂存外部版本并唤出三栏窗。
  const [conflict, setConflict] = React.useState<NoteConflictState | null>(null)
  const [conflictOpen, setConflictOpen] = React.useState(false)
  const conflictRef = React.useRef<NoteConflictState | null>(null)
  React.useEffect(() => {
    conflictRef.current = conflict
  }, [conflict])
  // 版本冲突出口：保存管线定义早于冲突抓取实现，经 ref 连接。
  const onVersionConflictRef = React.useRef<() => void>(() => {})
  const handleVersionConflict = React.useCallback(() => {
    onVersionConflictRef.current()
  }, [])

  // 面内容状态管理：面存储、脏标记与保存/放弃编排。
  const {
    faceStoresRef,
    faceSavedContentsRef,
    savedFaceIdsRef,
    createFaceStore,
    replaceFaceStores,
    faceDirtyVersion,
    facesDirty,
    buildSessionSnapshot,
    saveSessionToDisk,
    handleSave,
    handleSaveAllFaces,
    saveCurrentForVersionPublish,
    handleDiscard,
  } = useNoteDetailFaceContent({
    gateway,
    scope,
    noteId,
    isDraft,
    noteDir: note.dir,
    init,
    editing,
    face,
    faces,
    faceManifests,
    baseFields,
    editTitle,
    editDescription,
    editTags,
    editResources,
    noteTimes,
    tagInput,
    faceViewState,
    infoSidebarVisible,
    globalFaceKindOrder,
    saving,
    deleting,
    onSaved,
    onVersionConflict: handleVersionConflict,
    applyNoteManifest,
    resetFaceViewState,
    setBaseFields,
    setNoteTimes,
    setEditTitle,
    setEditDescription,
    setEditTags,
    setEditResources,
    setFaceManifests,
    setFaces,
    setFace,
    setTagInput,
    setAddFaceSelectorVisible,
    setPendingAddFace,
    setEditing,
    setSaving,
  })

  // 当前面的内容由插件存储持有；宿主只订阅内容用于渲染与保存。
  const activeContent = useFaceContent(faceStoresRef.current[face] || null)

  const dirty = fieldsDirty || facesDirty
  const lastDirtyRef = React.useRef<boolean | null>(null)
  React.useEffect(() => {
    if (lastDirtyRef.current === dirty) return
    lastDirtyRef.current = dirty
    onDirtyChange?.({ noteId, dirty })
  }, [dirty, noteId, onDirtyChange])

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
    // 整体替换内容存储（含刷新脏标记版本）：采用外部版本后未保存状态随之清除。
    replaceFaceStores(stores, savedContents)
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
  }, [applyNoteManifest, note.description, note.title, replaceFaceStores, savedFaceIdsRef, setBaseFields, setEditDescription, setEditResources, setEditTags, setEditTitle, setNoteTimes, setTagInput])

  /** 只读外部版本：读取清单与各面内容原文，不建立会话内容存储（用于冲突对照与干净刷新）。 */
  const readNotePackageRaw = React.useCallback(async (packageDir: string): Promise<{ manifest: HyperCortexNoteManifestV1; contents: Record<string, string> }> => {
    const manifest = await gateway.notes.loadNoteManifest(scope, packageDir)
    const faceIds = Object.keys(manifest.faces)
    const faceDocs = await Promise.all(
      faceIds.map(id => gateway.notes.loadNoteFace(scope, packageDir, id).catch(() => null)),
    )
    const contents: Record<string, string> = {}
    for (let i = 0; i < faceIds.length; i++) contents[faceIds[i]] = faceDocs[i]?.content ?? ''
    return { manifest, contents }
  }, [gateway, scope])

  /** 应用外部版本快照：以外部内容建立会话内容存储与已保存基线，就地替换当前笔记内容。 */
  const applyExternalSnapshot = React.useCallback((snapshot: NoteConflictState) => {
    const stores: Record<string, FaceContentStore> = {}
    for (const [faceId, faceManifest] of Object.entries(snapshot.manifest.faces)) {
      const content = snapshot.contents[faceId] ?? ''
      const store = createFaceStore(faceId, faceManifest.kind, content, content)
      if (store) stores[faceId] = store
    }
    applyLoadedNote(snapshot.manifest, stores, { ...snapshot.contents })
  }, [applyLoadedNote, createFaceStore])

  /** 抓取外部版本（失败返回 null）；冲突对照与干净刷新共用同一读取通道。 */
  const fetchExternalSnapshot = React.useCallback(async (): Promise<NoteConflictState | null> => {
    if (isDraft || !String(note.dir || '').trim()) return null
    try {
      return await readNotePackageRaw(note.dir)
    } catch {
      return null
    }
  }, [isDraft, note.dir, readNotePackageRaw])

  /** 抓取外部版本并进入冲突态（唤出三栏窗）：保存被版本保险丝拦下时调用。 */
  const captureExternalConflict = React.useCallback(async () => {
    const snapshot = await fetchExternalSnapshot()
    if (!snapshot) return
    setConflict(snapshot)
    setConflictOpen(true)
  }, [fetchExternalSnapshot])

  React.useEffect(() => {
    onVersionConflictRef.current = () => {
      void captureExternalConflict()
    }
  }, [captureExternalConflict])

  // 外部改动：干净会话就地刷新，脏会话只提示冲突、不覆盖未保存改动。
  const lastExternalSignalRef = React.useRef(externalChangeSignal)
  const dirtyRef = React.useRef(dirty)
  React.useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])
  const loadedRef = React.useRef(loaded)
  React.useEffect(() => {
    loadedRef.current = loaded
  }, [loaded])
  const noteTimesRef = React.useRef(noteTimes)
  React.useEffect(() => {
    noteTimesRef.current = noteTimes
  }, [noteTimes])

  React.useEffect(() => {
    if (externalChangeSignal === lastExternalSignalRef.current) return
    lastExternalSignalRef.current = externalChangeSignal
    if (!loadedRef.current || isDraft || !String(note.dir || '').trim()) return
    void (async () => {
      const snapshot = await fetchExternalSnapshot()
      if (!snapshot) return
      if (snapshot.manifest.updatedAtMs <= noteTimesRef.current.updatedAtMs) return
      if (!dirtyRef.current) {
        applyExternalSnapshot(snapshot)
        setConflict(null)
        setConflictOpen(false)
        void gateway.host.toast('笔记已被外部更新，已就地刷新')
        return
      }
      setConflict(snapshot)
    })()
  }, [externalChangeSignal, applyExternalSnapshot, fetchExternalSnapshot, gateway.host, isDraft, note.dir])

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

  // 引用与反向引用：出链提取、卡片预取与后端反向引用查询。
  const { outgoingIds, backlinkEdges, allBacklinks, faceBacklinkGroups } = useNoteDetailReferences({
    gateway,
    scope,
    noteId,
    visible,
    refRelationsEpoch,
    loaded,
    infoSidebarVisible,
    faceManifests,
    faceDirtyVersion,
    faceStoresRef,
    faces,
    allNotesById,
    onEnsureNoteCardInfoLoaded,
  })

  // 工具栏与设置接线：文件菜单、删除、收藏、版本历史与设置动作。
  const {
    moreMenuOpen,
    moreMenuAnchorEl,
    setMoreMenuAnchorEl,
    closeMoreMenu,
    deleteFaceMenuOpen,
    deleteFaceMenuAnchorEl,
    setDeleteFaceMenuAnchorEl,
    requestOpenNoteDir,
    requestOpenVersionHistory,
    favoritesTargets,
    openFavoritesPicker,
    requestDeleteNote,
    requestDeleteFace,
    deleteNoteConfirmOpen,
    setDeleteNoteConfirmOpen,
    deleteFaceTarget,
    setDeleteFaceTarget,
    confirmDeleteNote,
    confirmDeleteFace,
    versionHistoryOpen,
    setVersionHistoryOpen,
    noteSettingsOpen,
    setNoteSettingsOpen,
    handleRestoreVersion,
    updateFaceSettings,
    handleCopyNoteRef,
    copyFaceRef,
  } = useNoteDetailToolbar({
    gateway,
    scope,
    note,
    noteId,
    isDraft,
    trashEnabled,
    saving,
    deleting,
    setDeleting,
    face,
    faceManifests,
    editTitle,
    favoritesDoc,
    onFavoriteSaved,
    onRequestDeleteNote,
    onSaved,
    applyNoteManifest,
    resetFaceViewState,
    setEditing,
    setAddFaceSelectorVisible,
    setPendingAddFace,
    faceStoresRef,
    faceSavedContentsRef,
    readNotePackage,
    applyLoadedNote,
  })

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

  const handleSaveRequest = React.useCallback(async () => {
    if (conflictRef.current) {
      setConflictOpen(true)
      return
    }
    await handleSave()
  }, [handleSave])

  const handleSaveAllFacesRequest = React.useCallback(async () => {
    if (conflictRef.current) {
      setConflictOpen(true)
      return
    }
    await handleSaveAllFaces()
  }, [handleSaveAllFaces])

  const handleDiscardRequest = React.useCallback(() => {
    setConflict(null)
    setConflictOpen(false)
    handleDiscard()
  }, [handleDiscard])

  // 冲突解决：顶部先选其一，点接受才落盘。
  // 采用外部：就地替换为外部版本；保留我的：以外部版本为期望版本强制覆盖，保住本地改动。
  const handleAcceptConflict = React.useCallback(
    async (choice: 'mine' | 'external') => {
      const current = conflictRef.current
      if (!current) {
        setConflictOpen(false)
        return
      }
      if (choice === 'external') {
        applyExternalSnapshot(current)
        setConflict(null)
        setConflictOpen(false)
        void gateway.host.toast('已采用外部版本')
        return
      }
      const saved = await saveSessionToDisk('all', { expectedVersion: current.manifest.updatedAtMs })
      if (saved) {
        setConflict(null)
        setConflictOpen(false)
      }
    },
    [applyExternalSnapshot, gateway.host, saveSessionToDisk],
  )

  const conflictFaceLabel = React.useMemo(() => {
    const manifest = faceManifests[face]
    return String(manifest?.title || manifest?.kind || face || '当前面')
  }, [face, faceManifests])
  const conflictMine = conflict ? faceStoresRef.current[face]?.getContent() ?? '' : ''
  const conflictBase = conflict ? faceSavedContentsRef.current[face] ?? '' : ''
  const conflictExternal = conflict ? conflict.contents[face] ?? '' : ''

  React.useImperativeHandle(ref, () => ({
    isDirty: () => dirty,
    isSaving: () => saving,
    enterEditMode: () => setEditing(true),
    toggleMode: () => handleToggleMode(),
    cycleFace: () => handleCycleFace(),
    save: async () => { await handleSaveRequest() },
    discardChanges: () => handleDiscardRequest(),
    reload: async () => { await loadNoteIfNeeded({ force: true }) },
  }), [dirty, handleCycleFace, handleDiscardRequest, handleSaveRequest, handleToggleMode, loadNoteIfNeeded, saving])

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

  // 「收藏于」：从收藏夹文档单向反查，按收藏夹创建顺序列出收藏了当前笔记的收藏夹。
  // 草稿引用只活在内存文档中，因此草稿同样能被列出。
  const favoriteFolders = React.useMemo(
    () =>
      infoSidebarVisible && favoritesDoc
        ? collectFoldersForTarget(favoritesDoc, 'note', noteId).map(folder => ({ id: folder.id, title: folderTitle(favoritesDoc, folder.id) }))
        : [],
    [favoritesDoc, infoSidebarVisible, noteId],
  )

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
      <NoteDetailTopBarHost
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
        onSave={handleSaveRequest}
        onSaveAllFaces={handleSaveAllFacesRequest}
        onDiscard={handleDiscardRequest}
        conflict={!!conflict}
        onOpenConflict={() => setConflictOpen(true)}
        FaceToolbarLeft={FaceToolbarLeft}
        FaceToolbarRight={FaceToolbarRight}
        faceViewState={faceViewState}
        onFaceViewStateChange={handleFaceViewStateChange}
        faceViewContext={faceViewContext}
        moreMenuOpen={moreMenuOpen}
        moreMenuAnchorEl={moreMenuAnchorEl}
        setMoreMenuAnchorEl={setMoreMenuAnchorEl}
        closeMoreMenu={closeMoreMenu}
        requestOpenNoteDir={requestOpenNoteDir}
        requestOpenVersionHistory={requestOpenVersionHistory}
        requestOpenLocalGraph={() => setLocalGraphOpen(true)}
        setNoteSettingsOpen={setNoteSettingsOpen}
        favoritesDoc={favoritesDoc}
        openFavoritesPicker={openFavoritesPicker}
        requestDeleteNote={requestDeleteNote}
        deletableFaceIds={deletableFaceIds}
        deleteFaceMenuOpen={deleteFaceMenuOpen}
        deleteFaceMenuAnchorEl={deleteFaceMenuAnchorEl}
        setDeleteFaceMenuAnchorEl={setDeleteFaceMenuAnchorEl}
        requestDeleteFace={requestDeleteFace}
        handleCopyNoteRef={handleCopyNoteRef}
        infoSidebarVisible={infoSidebarVisible}
        setInfoSidebarVisible={setInfoSidebarVisible}
        addFaceSelectorVisible={addFaceSelectorVisible}
        setAddFaceSelectorVisible={setAddFaceSelectorVisible}
        creatableFaceDeclarations={creatableFaceDeclarations}
        pendingAddFace={pendingAddFace}
        setPendingAddFace={setPendingAddFace}
        handleAddFace={handleAddFace}
        face={face}
        faces={faces}
        faceManifests={faceManifests}
        setFace={setFace}
        copyFaceRef={copyFaceRef}
      />

      {loading ? <Typography sx={{ pt: 7 }} color="text.secondary">正在加载笔记...</Typography> : null}
      {!loading && loadError ? <Typography sx={{ pt: 7 }} color="error">{loadError}</Typography> : null}

      {!loading && !loadError && loaded ? (
        <Box sx={{ width: '100%', flex: 1, minHeight: 0, display: 'flex', minWidth: 0, gap: 2, alignItems: 'stretch' }}>
          <NoteDetailContentArea
            bodyScrollRef={bodyScrollRef}
            editing={editing}
            editTitle={editTitle}
            setEditTitle={setEditTitle}
            noteTitle={note.title}
            editTags={editTags}
            onRemoveTag={handleRemoveTag}
            tagInput={tagInput}
            setTagInput={setTagInput}
            onAddTag={handleAddTag}
            facesReady={facesReady}
            faces={faces}
            creatableFaceDeclarations={creatableFaceDeclarations}
            onAddFace={handleAddFace}
            FaceReadView={FaceReadView}
            FaceEditView={FaceEditView}
            faceEditing={faceEditing}
            activeContent={activeContent}
            visible={visible}
            faceViewState={faceViewState}
            onFaceViewStateChange={handleFaceViewStateChange}
            faceViewContext={faceViewContext}
          />

          <NoteDetailInfoSidebar
            infoSidebarVisible={infoSidebarVisible}
            noteId={noteId}
            editDescription={editDescription}
            editing={editing}
            noteTimes={noteTimes}
            outgoingIds={outgoingIds}
            allBacklinks={allBacklinks}
            faceBacklinkGroups={faceBacklinkGroups}
            setEditDescription={setEditDescription}
            allNotesById={allNotesById}
            onOpenNote={onOpenNote}
            backlinkEdges={backlinkEdges}
            faceManifests={faceManifests}
            favoriteFolders={favoriteFolders}
            onRevealFavoriteFolder={folderId => onRevealNoteInFavorites?.(folderId)}
          />
        </Box>
      ) : null}

      <NoteDetailDialogs
        isDraft={isDraft}
        trashEnabled={trashEnabled}
        noteTitleForPrompt={noteTitleForPrompt}
        dirty={dirty}
        deleting={deleting}
        saving={saving}
        deleteNoteConfirmOpen={deleteNoteConfirmOpen}
        setDeleteNoteConfirmOpen={setDeleteNoteConfirmOpen}
        confirmDeleteNote={confirmDeleteNote}
        deleteFaceTarget={deleteFaceTarget}
        setDeleteFaceTarget={setDeleteFaceTarget}
        faceManifests={faceManifests}
        faceStoresRef={faceStoresRef}
        confirmDeleteFace={confirmDeleteFace}
        favoritesDoc={favoritesDoc}
        favoritesTargets={favoritesTargets}
        versionHistoryOpen={versionHistoryOpen}
        setVersionHistoryOpen={setVersionHistoryOpen}
        noteSettingsOpen={noteSettingsOpen}
        setNoteSettingsOpen={setNoteSettingsOpen}
        gateway={gateway}
        scope={scope}
        noteDir={note.dir}
        noteIcon={noteIcon}
        saveCurrentForVersionPublish={saveCurrentForVersionPublish}
        handleRestoreVersion={handleRestoreVersion}
        facePluginGlobalSettings={facePluginGlobalSettings}
        faces={faces}
        applyNoteManifest={applyNoteManifest}
      />

      {localGraphOpen ? (
        <NoteLocalRelationGraphDialog
          open
          gateway={gateway}
          scope={scope}
          noteId={noteId}
          allNotesById={allNotesById}
          settings={graphSettings}
          refRelationsEpoch={refRelationsEpoch}
          onClose={() => setLocalGraphOpen(false)}
          onOpenNote={onOpenNote}
        />
      ) : null}

      <NoteConflictDialog
        open={visible && conflictOpen && !!conflict}
        noteTitle={noteTitleForPrompt}
        faceLabel={conflictFaceLabel}
        mine={conflictMine}
        base={conflictBase}
        external={conflictExternal}
        busy={saving}
        onAccept={choice => void handleAcceptConflict(choice)}
        onClose={() => setConflictOpen(false)}
      />
    </Box>
  )
})
