import * as React from 'react'
import { type HyperCortexIndexV1, type HyperCortexWorkspaceV1, type NoteMeta } from '../core'
import { addRef, type HyperCortexFavoritesDocV1 } from '../favorites'
import { orderKindsByGlobalOrder, resolveNoteFaceOrder } from '../facePreferences'
import { faceManifestFromDeclaration, requireFaceDeclaration } from '../facePlugins'
import { noteTabKey, type TabKey } from '../tabKey'
import {
  createDraftIdentity,
  reconcileDraftNoteRefs,
  reconcileDraftSidebarItems,
  resolveDraftTabKey,
  useDraftIdentityVersion,
  type DraftIdentity,
  type DraftSide,
} from './draftIdentity'
import { deriveSidebarFields, insertTabAsUngrouped, type SidebarItem } from './sidebarModel'
import type { NoteDetailSnapshotV1 } from './NoteDetailSession'
import type { PageId } from './workspacePages'

// 草稿身份的编排胶水：草稿身份档案的创建与订阅、草稿解析索引与打开会话列表的派生、
// 会话初始快照的构造与消费、草稿的登记与打开、左右两侧新建草稿入口，
// 以及档案变化后对左右两侧消费面的调和。
// 现场负责提供状态与端口，模块负责草稿身份的编排规则。

/**
 * 会话初始快照的唯一构造入口（普通新建与索引页创建共用）：
 * 面清单/面顺序/激活面/笔记级字段一次性装配，保证两条创建流程表现一致。
 */
export function buildNoteInitSnapshot(input: {
  faceManifests: NoteDetailSnapshotV1['faceManifests']
  faceOrder?: readonly string[]
  globalKindOrder: readonly string[]
  title: string
  description?: string
  tags?: string[]
  resources?: NoteDetailSnapshotV1['baseFields']['resources']
  noteTimes: NoteDetailSnapshotV1['noteTimes']
}): NoteDetailSnapshotV1 {
  const faces = resolveNoteFaceOrder({
    faceOrder: input.faceOrder,
    faces: input.faceManifests,
    globalKindOrder: input.globalKindOrder,
  })
  const title = String(input.title || '').trim() || '未命名'
  const description = String(input.description || '').trim()
  const tags = (input.tags || []).slice()
  const resources = (input.resources || []).slice()
  return {
    baseFields: { title, description, tags: tags.slice(), resources: resources.slice() },
    faceManifests: input.faceManifests,
    faceContents: {},
    savedFaceContents: {},
    editing: true,
    faceViewState: {},
    face: faces[0] || '',
    faces,
    editTitle: title,
    editDescription: description,
    editTags: tags,
    editResources: resources,
    tagInput: '',
    noteTimes: input.noteTimes,
    infoSidebarVisible: false,
  }
}

/**
 * 打开会话标识按关闭键过滤：先按档案解析（转正草稿的原始标识经解析落到真实标识），
 * 再剔除关闭键命中的条目，必须同步求值（函数式更新会被推迟到 discard 之后执行，届时解析已失效）。
 */
export function filterOpenNoteIdsForClose(
  draftIdentity: DraftIdentity,
  openNoteIds: readonly string[],
  closingTabKeys: ReadonlySet<string>,
): string[] {
  return openNoteIds.filter(id => !closingTabKeys.has(noteTabKey(draftIdentity.resolveId(id))))
}

export function useDraftOrchestration(opts: {
  /** 正式笔记索引；草稿在模块内由档案派生后并入。 */
  noteIndex: HyperCortexIndexV1 | null
  /** 打开的会话标识：真实笔记记真实标识，草稿记草稿标识。 */
  openNoteIds: string[]
  sidebarItemsRef: React.MutableRefObject<SidebarItem[]>
  activeTabKeyRef: React.MutableRefObject<TabKey>
  favoritesDocRef: React.MutableRefObject<HyperCortexFavoritesDocV1 | null>
  tabsInitReady: boolean
  activeWorkspaceIdRef: React.MutableRefObject<string>
  enqueueAppCommand: (command: string) => void
  defaultFaceKinds: readonly string[]
  faceKindOrder: readonly string[]
  updateSidebarItems: (
    updater: (prev: SidebarItem[]) => SidebarItem[],
    patch?: Partial<Pick<HyperCortexWorkspaceV1, 'activeTabKey' | 'title'>>,
  ) => void
  handleFavoritesDocChange: (nextDoc: HyperCortexFavoritesDocV1) => void
  navigatePage: (next: PageId, opts?: { recordHistory?: boolean }) => void
  setOpenNoteIds: React.Dispatch<React.SetStateAction<string[]>>
  setActiveNoteId: React.Dispatch<React.SetStateAction<string>>
  setActiveTabKey: React.Dispatch<React.SetStateAction<TabKey>>
  setDetailSelectionSource: React.Dispatch<React.SetStateAction<'tabs' | 'favorites'>>
}): {
  draftIdentity: DraftIdentity
  resolvedNoteIndex: Record<string, NoteMeta>
  openNoteTabs: NoteMeta[]
  consumeInitSnapshot: (noteId: string) => NoteDetailSnapshotV1 | null
  handleCreateDraftNote: () => void
  handleCreateDraftNoteInFolder: (folderId: string) => void
} {
  const {
    noteIndex,
    openNoteIds,
    sidebarItemsRef,
    activeTabKeyRef,
    favoritesDocRef,
    tabsInitReady,
    activeWorkspaceIdRef,
    enqueueAppCommand,
    defaultFaceKinds,
    faceKindOrder,
    updateSidebarItems,
    handleFavoritesDocChange,
    navigatePage,
    setOpenNoteIds,
    setActiveNoteId,
    setActiveTabKey,
    setDetailSelectionSource,
  } = opts

  // 草稿身份档案：草稿元数据/初始快照/归属侧/转正后标识的唯一内存事实源（不落盘）。
  const draftIdentity = React.useMemo(() => createDraftIdentity(), [])
  const draftIdentityVersion = useDraftIdentityVersion(draftIdentity)

  // 解析索引：正式笔记 + 内存草稿（草稿由档案派生，消费方无需感知草稿，按同一套 noteIndex 解析）。
  const resolvedNoteIndex = React.useMemo(() => {
    const base = noteIndex?.notes || {}
    const drafts: Record<string, NoteMeta> = {}
    for (const draft of draftIdentity.listLiveDrafts()) drafts[draft.id] = draft.meta
    return Object.keys(drafts).length ? { ...base, ...drafts } : base
  }, [draftIdentity, draftIdentityVersion, noteIndex])

  // 打开的会话列表：标识经档案解析（转正草稿自动指向真实笔记），元数据取自解析索引。
  const openNoteTabs = React.useMemo(() => {
    const out: NoteMeta[] = []
    const seen = new Set<string>()
    for (const rawId of openNoteIds) {
      const effectiveId = draftIdentity.resolveId(rawId)
      if (!effectiveId || seen.has(effectiveId)) continue
      const meta = resolvedNoteIndex[effectiveId]
      if (!meta) continue
      seen.add(effectiveId)
      out.push(meta)
    }
    return out
  }, [draftIdentity, draftIdentityVersion, openNoteIds, resolvedNoteIndex])

  const consumeInitSnapshot = React.useCallback((noteId: string): NoteDetailSnapshotV1 | null => {
    return draftIdentity.takeInitSnapshot(noteId)
  }, [draftIdentity])

  // 草稿笔记的诞生：档案登记元数据、初始快照与归属侧，返回可打开的 NoteMeta。
  // 左侧栏新建与右侧收藏夹新建共用同一登记入口，草稿语义单一。
  const registerDraftNote = React.useCallback((side: DraftSide): NoteMeta => {
    const now = Date.now()
    const draftId = `draft_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const meta: NoteMeta = {
      id: draftId,
      title: '未命名',
      description: '',
      dir: '',
      createdAtMs: now,
      updatedAtMs: now,
    }
    // 新笔记默认创建的面：按全局顺序排列，名单来自后端声明。
    const defaultFaceManifests = orderKindsByGlobalOrder(defaultFaceKinds, faceKindOrder).map(kind => faceManifestFromDeclaration(requireFaceDeclaration(kind)))
    draftIdentity.register({
      meta,
      side,
      initSnapshot: buildNoteInitSnapshot({
        faceManifests: Object.fromEntries(defaultFaceManifests.map(face => [face.id, face])),
        globalKindOrder: faceKindOrder,
        title: '未命名',
        noteTimes: { createdAtMs: now, updatedAtMs: now },
      }),
    })
    return meta
  }, [defaultFaceKinds, draftIdentity, faceKindOrder])

  // 打开草稿并激活：草稿归属哪一侧由档案记录决定——左侧栏新建只进左侧列表并选中左侧；
  // 右侧收藏夹新建只进右侧引用并选中右侧。会话列表两侧共用，与归属无关。
  const openDraftNoteTab = React.useCallback(
    (meta: NoteMeta) => {
      const source: DraftSide = draftIdentity.getSide(meta.id) || 'tabs'
      const draftKey = noteTabKey(meta.id)
      setOpenNoteIds(prev => (prev.includes(meta.id) ? prev : [...prev, meta.id]))
      setActiveNoteId(meta.id)
      setActiveTabKey(draftKey)
      setDetailSelectionSource(source)
      if (source === 'tabs') {
        updateSidebarItems(prev => insertTabAsUngrouped(prev, draftKey, prev.length), { activeTabKey: draftKey })
      }
      navigatePage('note-detail')
    },
    [draftIdentity, navigatePage, setActiveNoteId, setActiveTabKey, setDetailSelectionSource, setOpenNoteIds, updateSidebarItems],
  )

  const handleCreateDraftNote = React.useCallback(() => {
    if (!tabsInitReady || !activeWorkspaceIdRef.current) {
      enqueueAppCommand('new-note')
      return
    }
    openDraftNoteTab(registerDraftNote('tabs'))
  }, [enqueueAppCommand, openDraftNoteTab, registerDraftNote, tabsInitReady])

  // 在指定收藏夹创建草稿笔记并加入该收藏夹引用，同时打开草稿（归属右侧）。
  // 草稿引用只进内存收藏夹文档，落盘时被过滤；保存转正时由档案改指向，消费方自动跟随。
  const handleCreateDraftNoteInFolder = React.useCallback(
    (folderId: string) => {
      if (!tabsInitReady || !activeWorkspaceIdRef.current) {
        enqueueAppCommand('new-note')
        return
      }
      const baseDoc = favoritesDocRef.current
      if (!baseDoc) return
      const fid = String(folderId || '').trim() || 'root'
      const meta = registerDraftNote('favorites')
      const added = addRef(baseDoc, fid, 'note', meta.id)
      if (added) handleFavoritesDocChange(added.doc)
      openDraftNoteTab(meta)
    },
    [enqueueAppCommand, handleFavoritesDocChange, openDraftNoteTab, registerDraftNote, tabsInitReady],
  )

  // 草稿身份档案变化的统一订阅：转正让左侧标签键与收藏夹引用改指向真实笔记，
  // 放弃让两者自动清理。消费方不再各自手工搬运，只在档案变更后向档案查询一次。
  // 用 layout 时机执行，使转正/放弃与重命名在同一帧内完成，界面不见中间态。
  React.useLayoutEffect(() => {
    const reconciledItems = reconcileDraftSidebarItems(draftIdentity, sidebarItemsRef.current)
    if (reconciledItems !== sidebarItemsRef.current) {
      // 仅当当前激活键经档案解析后确实落在调和后的列表里才迁移（转正）；
      // 放弃场景由 closeTabKeysDirect 决定后继选中，这里不越权改写。
      const currentActive = String(activeTabKeyRef.current || '').trim()
      const resolvedActive = resolveDraftTabKey(draftIdentity, currentActive)
      const openKeys = deriveSidebarFields(reconciledItems).openTabKeys
      const canMigrateActive = !!resolvedActive && openKeys.includes(resolvedActive)
      updateSidebarItems(() => reconciledItems, canMigrateActive ? { activeTabKey: resolvedActive } : undefined)
      if (canMigrateActive && resolvedActive !== currentActive) setActiveTabKey(resolvedActive as any)
    }
    const currentDoc = favoritesDocRef.current
    if (currentDoc) {
      const reconciledDoc = reconcileDraftNoteRefs(draftIdentity, currentDoc)
      if (reconciledDoc !== currentDoc) handleFavoritesDocChange(reconciledDoc)
    }
  }, [draftIdentity, draftIdentityVersion, handleFavoritesDocChange, updateSidebarItems])

  return {
    draftIdentity,
    resolvedNoteIndex,
    openNoteTabs,
    consumeInitSnapshot,
    handleCreateDraftNote,
    handleCreateDraftNoteInFolder,
  }
}
