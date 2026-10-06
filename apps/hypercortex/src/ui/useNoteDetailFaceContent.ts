import * as React from 'react'

import { type HyperCortexNoteManifestV1, type HyperCortexNoteResourceRef } from '../noteSchema'
import type { HyperCortexNoteFaceManifestV2 } from '../noteFaces'
import { getFaceViewPlugin, type FaceContentStore } from '../facePlugins'
import type { HyperCortexGateway } from '../gateway'
import type { SaveNoteFaceContentInput } from '../gateway/types'
import type { NoteMeta, VaultScope } from '../core'
import { resolveNoteFaceOrder } from '../facePreferences'
import { normalizeTagText, type NoteBaseFields, type NoteFaceId } from './note-detail/noteDetailTools'
import type { NoteDetailSnapshotV1 } from './NoteDetailSession'

/** 笔记详情会话的面内容状态：面存储、脏标记与保存/放弃编排。 */
export type UseNoteDetailFaceContentInput = {
  gateway: HyperCortexGateway
  scope: VaultScope
  noteId: string
  isDraft: boolean
  noteDir: string
  init: NoteDetailSnapshotV1 | null
  editing: boolean
  face: NoteFaceId
  faces: NoteFaceId[]
  faceManifests: Record<string, HyperCortexNoteFaceManifestV2>
  baseFields: NoteBaseFields
  editTitle: string
  editDescription: string
  editTags: string[]
  editResources: HyperCortexNoteResourceRef[]
  noteTimes: { createdAtMs: number; updatedAtMs: number }
  tagInput: string
  faceViewState: Record<string, unknown>
  infoSidebarVisible: boolean
  globalFaceKindOrder: readonly string[]
  saving: boolean
  deleting: 'note' | 'face' | ''
  onSaved: (payload: { originalId: string; meta: NoteMeta; snapshotForNewId?: NoteDetailSnapshotV1 }) => void
  /** 保存被版本保险丝拦下（VERSION_CONFLICT）：交给会话处理冲突（抓取外部版本并提示）。 */
  onVersionConflict: () => void
  applyNoteManifest: (manifest: HyperCortexNoteManifestV1) => void
  resetFaceViewState: () => void
  setBaseFields: React.Dispatch<React.SetStateAction<NoteBaseFields>>
  setNoteTimes: React.Dispatch<React.SetStateAction<{ createdAtMs: number; updatedAtMs: number }>>
  setEditTitle: React.Dispatch<React.SetStateAction<string>>
  setEditDescription: React.Dispatch<React.SetStateAction<string>>
  setEditTags: React.Dispatch<React.SetStateAction<string[]>>
  setEditResources: React.Dispatch<React.SetStateAction<HyperCortexNoteResourceRef[]>>
  setFaceManifests: React.Dispatch<React.SetStateAction<Record<string, HyperCortexNoteFaceManifestV2>>>
  setFaces: React.Dispatch<React.SetStateAction<NoteFaceId[]>>
  setFace: React.Dispatch<React.SetStateAction<NoteFaceId>>
  setTagInput: React.Dispatch<React.SetStateAction<string>>
  setAddFaceSelectorVisible: React.Dispatch<React.SetStateAction<boolean>>
  setPendingAddFace: React.Dispatch<React.SetStateAction<NoteFaceId | null>>
  setEditing: React.Dispatch<React.SetStateAction<boolean>>
  setSaving: React.Dispatch<React.SetStateAction<boolean>>
}

export type NoteDetailFaceContent = {
  faceStoresRef: React.MutableRefObject<Record<string, FaceContentStore>>
  faceSavedContentsRef: React.MutableRefObject<Record<string, string>>
  savedFaceIdsRef: React.MutableRefObject<Set<string>>
  createFaceStore: (faceId: string, kind: string, initialContent: string, savedContent?: string) => FaceContentStore | null
  /** 整体替换面内容存储（装载 / 外部刷新 / 版本恢复共用）：替换后刷新脏标记版本，避免脏状态滞留。 */
  replaceFaceStores: (stores: Record<string, FaceContentStore>, savedContents: Record<string, string>) => void
  faceDirtyVersion: number
  facesDirty: boolean
  buildSessionSnapshot: (input: {
    baseFields: NoteBaseFields
    manifest: HyperCortexNoteManifestV1
    title: string
    description: string
    tags: string[]
    updatedAtMs: number
  }) => NoteDetailSnapshotV1
  saveSessionToDisk: (mode: 'current' | 'all', opts?: { expectedVersion?: number }) => Promise<boolean>
  handleSave: () => Promise<boolean>
  handleSaveAllFaces: () => Promise<boolean>
  saveCurrentForVersionPublish: () => Promise<void>
  handleDiscard: () => void
}

export function useNoteDetailFaceContent(input: UseNoteDetailFaceContentInput): NoteDetailFaceContent {
  const {
    gateway,
    scope,
    noteId,
    isDraft,
    noteDir,
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
    onVersionConflict,
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
  } = input

  // 面内容存储：内容由插件持有，宿主只取内容与脏标记，不持久化内容本身。
  const faceStoresRef = React.useRef<Record<string, FaceContentStore>>({})
  const faceSavedContentsRef = React.useRef<Record<string, string>>(init?.savedFaceContents ?? {})
  // 版本冲突出口：常驻回调经 ref 读取最新实现，避免保存管线因回调引用变化而重建。
  const onVersionConflictRef = React.useRef(onVersionConflict)
  React.useEffect(() => {
    onVersionConflictRef.current = onVersionConflict
  }, [onVersionConflict])
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

  // 整体替换面内容存储：替换后必须刷新脏标记版本——facesDirty 依赖该版本重算，
  // 否则引用被换掉但记忆值不更新，脏状态会滞留（如「采用外部版本」后仍显示未保存）。
  const replaceFaceStores = React.useCallback((stores: Record<string, FaceContentStore>, savedContents: Record<string, string>) => {
    faceStoresRef.current = stores
    faceSavedContentsRef.current = savedContents
    setFaceDirtyVersion(v => v + 1)
  }, [])

  const facesDirty = React.useMemo(
    () => Object.values(faceStoresRef.current).some(store => store.isDirty()),
    [faceDirtyVersion],
  )

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
  const saveSessionToDisk = React.useCallback(async (mode: 'current' | 'all', opts?: { expectedVersion?: number }): Promise<boolean> => {
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

      // 版本保险丝：保存时带上加载时的版本号；版本对不上由后端拒绝并回报当前版本。
      // 冲突解决选择「保留我的」时经 opts 覆盖为外部版本，强制覆盖外部改动。
      const expectedVersion = opts?.expectedVersion ?? (!isDraft && noteTimes.updatedAtMs > 0 ? noteTimes.updatedAtMs : undefined)

      const result = await gateway.notes.saveNoteFaces(scope, {
        id: isDraft ? undefined : originalId,
        packageDir: isDraft ? undefined : noteDir,
        title,
        description,
        tags,
        createdAtMs: noteTimes.createdAtMs,
        resources: editResources,
        faceKinds,
        faces: facePayloads,
      }, expectedVersion)

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

      onSaved({ originalId, meta: result.meta, snapshotForNewId })
      await gateway.host.toast(mode === 'current' ? '笔记已保存' : '笔记所有面已保存')
      return true
    } catch (e: any) {
      // 版本冲突：不当作普通失败提示，交给会话唤出冲突窗。
      if (e?.code === 'VERSION_CONFLICT') {
        onVersionConflictRef.current()
        return false
      }
      await gateway.host.toast(String(e?.message || e || '保存失败'))
      return false
    } finally {
      setSaving(false)
    }
  }, [applyNoteManifest, buildSessionSnapshot, deleting, editDescription, editResources, editTags, editTitle, face, faceManifests, faces, gateway, isDraft, noteDir, noteId, noteTimes, onSaved, saving, scope])

  const handleSave = React.useCallback(async () => saveSessionToDisk('current'), [saveSessionToDisk])

  const saveCurrentForVersionPublish = React.useCallback(async () => {
    const saved = await handleSave()
    if (!saved) throw new Error('保存当前笔记失败，已停止发布版本')
  }, [handleSave])

  // Q24：保存整个笔记所有面——与「保存当前面」共用同一保存管线，仅提交范围不同。
  const handleSaveAllFaces = React.useCallback(async () => saveSessionToDisk('all'), [saveSessionToDisk])

  return {
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
  }
}
