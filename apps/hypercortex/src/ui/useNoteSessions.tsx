import * as React from 'react'
import { type HyperCortexIndexV1, type HyperCortexRepoStateV1, type HyperCortexWorkspaceV1, type NoteMeta } from '../core'
import type { HyperCortexGateway } from '../gateway'
import { isDraftNoteId } from '../drafts'
import { addRef, type FavoriteItemRef, type HyperCortexFavoritesDocV1 } from '../favorites'
import { orderKindsByGlobalOrder } from '../facePreferences'
import { noteIdFromTabKey, noteTabKey, tabKind, type TabKey } from '../tabKey'
import { assetTabId, type AssetEntry } from '../assetTypes'
import type { DraftIdentity } from './draftIdentity'
import type { NoteDetailSnapshotV1 } from './NoteDetailSession'
import { closeTabsInSidebar, deriveSidebarFields, insertTabAsUngrouped, type SidebarItem } from './sidebarModel'
import { nextFavoriteEntryAfterClose, type FavoriteFolderView } from './favoritesSidebarModel'
import { buildNoteInitSnapshot, filterOpenNoteIdsForClose } from './useDraftOrchestration'
import { useNoteCardMenus } from './useNoteCardMenus'
import { useNoteSessionHandles } from './useNoteSessionHandles'
import type { PageId } from './workspacePages'

// 笔记会话现场：会话句柄注册与脏/保存状态、引用关系版本、全部笔记映射与卡片信息缓存（加载刷新预取）、
// 面切换请求、打开笔记与在索引页新建笔记、激活已开标签、关闭标签与未保存确认、会话保存与笔记删除、
// 回收站恢复、笔记卡片菜单与对应对话框。
// 页面导航、工作区/侧边栏接线、草稿身份、滚动记忆与附件会话等能力由中心文件经显式入参/回调 ref 连接。

type Params = {
  visible: boolean
  visiblePage: PageId
  gateway: HyperCortexGateway
  activeNoteId: string
  faceKindOrder: readonly string[]
  defaultFaceKinds: readonly string[]
  trashEnabled: boolean
  allNotes: NoteMeta[]
  openNoteTabs: NoteMeta[]
  favoritesDoc: HyperCortexFavoritesDocV1 | null
  favoritesDocRef: React.MutableRefObject<HyperCortexFavoritesDocV1 | null>
  handleFavoritesDocChange: (nextDoc: HyperCortexFavoritesDocV1) => void
  draftIdentity: DraftIdentity
  /** 外部改动信号：仓库笔记被外部改动时自增，用于清空卡片摘要缓存以就地重载。 */
  externalNotesSignal: number
  openTabKeysRef: React.MutableRefObject<TabKey[]>
  activeTabKeyRef: React.MutableRefObject<TabKey>
  pageRef: React.MutableRefObject<PageId>
  openNoteIdsRef: React.MutableRefObject<string[]>
  noteScrollTopByIdRef: React.MutableRefObject<Record<string, number>>
  repoReadyRef: React.MutableRefObject<boolean>
  /** 右侧收藏夹栏当前页视图：关闭从收藏栏打开的内容时据此续接下一条/上一条（只认笔记与附件）。 */
  favoritesFolderViewRef: React.MutableRefObject<FavoriteFolderView>
  /** 当前选中是否归属右侧收藏夹栏：决定关闭后是否走收藏夹页续接。 */
  resolvedSelectionSourceRef: React.MutableRefObject<'tabs' | 'favorites'>
  /** 激活右侧收藏夹栏条目的入口：续接打开时选中留在右侧栏。实现定义晚于本模块，经 ref 连接。 */
  activateFavoritesEntryKeyRef: React.MutableRefObject<(tabKey: string) => boolean>
  /** 关闭标签直接执行的入口：实现定义晚于附件会话等消费方，经 ref 连接。 */
  closeTabKeysDirectRef: React.MutableRefObject<(tabKeys: string[]) => void>
  /** 激活已开标签的入口：实现定义晚于装载流程，经 ref 连接。 */
  activateExistingTabKeyRef: React.MutableRefObject<(tabKey: string, opts?: { recordHistory?: boolean }) => boolean>
  setDetailSelectionSource: React.Dispatch<React.SetStateAction<'tabs' | 'favorites'>>
  setOpenModalPage: React.Dispatch<React.SetStateAction<PageId | null>>
  setOpenNoteIds: React.Dispatch<React.SetStateAction<string[]>>
  setActiveNoteId: React.Dispatch<React.SetStateAction<string>>
  setActiveTabKey: React.Dispatch<React.SetStateAction<TabKey>>
  setOpenAssetTabs: React.Dispatch<React.SetStateAction<AssetEntry[]>>
  setNoteIndex: React.Dispatch<React.SetStateAction<HyperCortexIndexV1 | null>>
  updateSidebarItems: (
    updater: (prev: SidebarItem[]) => SidebarItem[],
    patch?: Partial<Pick<HyperCortexWorkspaceV1, 'activeTabKey' | 'title'>>,
  ) => void
  commitActiveWorkspacePatch: (patch: { activeTabKey: string }) => void
  recordNewNavLocation: (entry: { page: PageId; tabKey?: string }) => void
  navigatePage: (next: PageId, opts?: { recordHistory?: boolean }) => void
  persistRepoStatePatch: (patch: Partial<HyperCortexRepoStateV1>) => Promise<void>
}

export function useNoteSessions(params: Params) {
  const {
    visible,
    visiblePage,
    gateway,
    activeNoteId,
    faceKindOrder,
    defaultFaceKinds,
    trashEnabled,
    allNotes,
    openNoteTabs,
    favoritesDoc,
    favoritesDocRef,
    handleFavoritesDocChange,
    draftIdentity,
    externalNotesSignal,
    openTabKeysRef,
    activeTabKeyRef,
    pageRef,
    openNoteIdsRef,
    noteScrollTopByIdRef,
    repoReadyRef,
    favoritesFolderViewRef,
    resolvedSelectionSourceRef,
    activateFavoritesEntryKeyRef,
    closeTabKeysDirectRef,
    activateExistingTabKeyRef,
    setDetailSelectionSource,
    setOpenModalPage,
    setOpenNoteIds,
    setActiveNoteId,
    setActiveTabKey,
    setOpenAssetTabs,
    setNoteIndex,
    updateSidebarItems,
    commitActiveWorkspacePatch,
    recordNewNavLocation,
    navigatePage,
    persistRepoStatePatch,
  } = params

  const {
    noteSessionHandlesRef,
    handleNoteDirtyChange,
    getNoteSessionRefCallback,
    isNoteDirtyById,
    isNoteSavingById,
    noteCardInfoById,
    refreshNoteCardInfo,
    ensureNoteCardInfoLoaded,
    noteIndexMap,
  } = useNoteSessionHandles({ visible, visiblePage, gateway, faceKindOrder, allNotes, externalNotesSignal })

  // ---- 引用关系版本号：任何笔记保存/删除/恢复后自增，打开的会话据此重取反向引用。
  const [refRelationsEpoch, setRefRelationsEpoch] = React.useState(0)
  const bumpRefRelationsEpoch = React.useCallback(() => {
    setRefRelationsEpoch(prev => prev + 1)
  }, [])
  const allNotesById = React.useMemo(() => {
    const map: Record<string, NoteMeta> = {}
    for (const n of allNotes) map[n.id] = n
    return map
  }, [allNotes])

  // ---- 面切换请求（点击引用跳转指定面：复用同一标签页）
  const faceSwitchSeqRef = React.useRef(0)
  const [faceSwitchLatestSeq, setFaceSwitchLatestSeq] = React.useState(0)
  const [faceSwitchRequest, setFaceSwitchRequest] = React.useState<{ noteId: string; faceId: string; seq: number } | null>(null)

  const handleFaceSwitchConsumed = React.useCallback((seq: number) => {
    setFaceSwitchRequest(prev => (prev && prev.seq === seq ? null : prev))
  }, [])

  const handleDeleteNote = React.useCallback(
    async (payload: { note: NoteMeta; mode: 'trash' | 'permanent'; refs?: FavoriteItemRef[] }) => {
      const note = payload.note
      const nid = String(note?.id || '').trim()
      if (!nid) return

      if (isDraftNoteId(nid) || !String(note?.dir || '').trim()) {
        closeTabKeysDirectRef.current([noteTabKey(nid)])
        setNoteIndex(prev => {
          const current = prev || { version: 1, notes: {} }
          const nextNotes = { ...(current.notes || {}) }
          delete nextNotes[nid]
          return { ...current, notes: nextNotes }
        })
        bumpRefRelationsEpoch()
        return
      }

      try {
        if (payload.mode === 'trash') await gateway.trash.moveNoteToTrash('library', note, payload.refs)
        else await gateway.trash.permanentlyDeleteNoteDir('library', nid, note.dir)

        closeTabKeysDirectRef.current([noteTabKey(nid)])
        setNoteIndex(prev => {
          const current = prev || { version: 1, notes: {} }
          const nextNotes = { ...(current.notes || {}) }
          delete nextNotes[nid]
          return { ...current, notes: nextNotes }
        })
        bumpRefRelationsEpoch()
      } catch (e: any) {
        // 失败向上抛出：由调用方保留确认界面并提示，避免「删除失败但对话框已关」。
        throw e
      }
    },
    [bumpRefRelationsEpoch, gateway],
  )

  const handleTrashRestored = React.useCallback(
    (meta: NoteMeta, kind: 'note' | 'asset' | 'face' = 'note') => {
      if (!meta?.id) return
      setNoteIndex(prev => {
        const current = prev || { version: 1, notes: {} }
        const nextNotes = { ...(current.notes || {}) }
        nextNotes[meta.id] = meta
        return { ...current, notes: nextNotes }
      })
      void refreshNoteCardInfo(meta).catch(() => {})
      // 恢复会带回该笔记（或其面）发出的引用，反向引用需重取。
      bumpRefRelationsEpoch()
      if (kind === 'face') {
        const handle = noteSessionHandlesRef.current[meta.id]
        if (handle && !handle.isDirty() && !handle.isSaving()) {
          void handle.reload().catch(() => {})
        }
      }
      void gateway.host.toast(kind === 'face' ? '已恢复笔记面' : '已恢复笔记')
    },
    [bumpRefRelationsEpoch, gateway, refreshNoteCardInfo],
  )

  const handleOpenNote = React.useCallback(
    (note: NoteMeta, faceId?: string, source: 'tabs' | 'favorites' = 'tabs', opts?: { recordHistory?: boolean }) => {
      const nid = draftIdentity.resolveId(String(note?.id || '').trim())
      if (!nid) return
      setDetailSelectionSource(source)
      // 打开笔记统一收浮层：无论从模态页、侧栏、引用还是创建流程进入。
      setOpenModalPage(null)
      const nextKey = noteTabKey(nid)
      const prevActiveKey = String(activeTabKeyRef.current || '').trim()
      const recordHistory = opts?.recordHistory !== false
      if (recordHistory && (pageRef.current === 'note-detail' || pageRef.current === 'asset-detail') && prevActiveKey && prevActiveKey !== nextKey) {
        recordNewNavLocation({ page: pageRef.current, tabKey: prevActiveKey })
      }
      setOpenNoteIds(prev => {
        return prev.includes(nid) ? prev : [...prev, nid]
      })
      setActiveNoteId(nid)
      setActiveTabKey(nextKey)
      // 来源为右侧收藏夹时不改动左侧列表：右侧选中只是切换详情目标，
      // 不应把条目塞进左侧「已打开笔记」；仅持久化当前目标键（草稿键落盘时被过滤）。
      if (source === 'tabs') {
        updateSidebarItems(prev => (deriveSidebarFields(prev).openTabKeys.includes(nextKey) ? prev : insertTabAsUngrouped(prev, nextKey, prev.length)), { activeTabKey: nextKey })
      } else {
        commitActiveWorkspacePatch({ activeTabKey: nextKey })
      }
      navigatePage('note-detail', { recordHistory })
      const targetFace = String(faceId || '').trim()
      if (targetFace) {
        faceSwitchSeqRef.current += 1
        const seq = faceSwitchSeqRef.current
        setFaceSwitchLatestSeq(seq)
        setFaceSwitchRequest({ noteId: nid, faceId: targetFace, seq })
      }
    },
    [commitActiveWorkspacePatch, draftIdentity, navigatePage, recordNewNavLocation, updateSidebarItems],
  )

  const handleCreateNoteInIndex = React.useCallback(
    async (folderId: string) => {
      const fid = String(folderId || '').trim() || 'root'

      try {
        const result = await gateway.notes.createEmptyNote('library', {
          title: '未命名',
          description: '',
          tags: [],
          faceKinds: orderKindsByGlobalOrder(defaultFaceKinds, faceKindOrder),
        })
        const meta = result.meta
        // 以创建完成时刻的最新文档为基：等待期间的外部改动不被误当作本地删除而覆盖。
        const baseDoc = favoritesDocRef.current
        if (!baseDoc) {
          void gateway.host.toast('笔记已创建，但收藏夹尚未就绪')
          return
        }
        const added = addRef(baseDoc, fid, 'note', meta.id)
        if (!added) {
          void gateway.host.toast('笔记已创建，但无法添加到当前索引页')
          return
        }

        handleFavoritesDocChange(added.doc)
        setNoteIndex(prev => {
          const current = prev || { version: 1, notes: {} }
          return { ...current, notes: { ...(current.notes || {}), [meta.id]: meta } }
        })
        // 会话初始状态与普通新建共用同一构造入口；面清单取自后端已创建的真实清单。
        draftIdentity.putInitSnapshot(meta.id, buildNoteInitSnapshot({
          faceManifests: result.manifest.faces,
          faceOrder: result.manifest.faceOrder,
          globalKindOrder: faceKindOrder,
          title: meta.title || '未命名',
          description: meta.description || '',
          tags: [],
          resources: [],
          noteTimes: {
            createdAtMs: Number(meta.createdAtMs) > 0 ? Number(meta.createdAtMs) : Date.now(),
            updatedAtMs: Number(meta.updatedAtMs) > 0 ? Number(meta.updatedAtMs) : Date.now(),
          },
        }))
        handleOpenNote(meta)
        void gateway.host.toast('已创建空白笔记并添加到索引页')
      } catch (e: any) {
        void gateway.host.toast(String(e?.message || e || '创建笔记失败'))
      }
    },
    [defaultFaceKinds, draftIdentity, faceKindOrder, favoritesDocRef, gateway, handleFavoritesDocChange, handleOpenNote],
  )

  const activateExistingTabKey = React.useCallback(
    (tabKey: string, opts?: { recordHistory?: boolean }) => {
      const key = String(tabKey || '').trim()
      if (!key) return false
      if (!openTabKeysRef.current.includes(key)) return false

      const kind = tabKind(key)
      if (kind === 'note') {
        const nid = noteIdFromTabKey(key)
        if (!nid) return false
        setDetailSelectionSource('tabs')
        setActiveTabKey(key)
        setActiveNoteId(nid)
        commitActiveWorkspacePatch({ activeTabKey: key })
        navigatePage('note-detail', opts)
        return true
      }

      if (kind === 'asset') {
        setDetailSelectionSource('tabs')
        setActiveTabKey(key)
        setActiveNoteId('')
        commitActiveWorkspacePatch({ activeTabKey: key })
        navigatePage('asset-detail', opts)
        return true
      }

      return false
    },
    [commitActiveWorkspacePatch, navigatePage],
  )

  React.useEffect(() => {
    activateExistingTabKeyRef.current = activateExistingTabKey
  }, [activateExistingTabKey])

  const closeTabKeysDirect = React.useCallback(
    (tabKeys: string[]) => {
      const closing = new Set(tabKeys.map(s => String(s || '').trim()).filter(Boolean))
      if (!closing.size) return

      const prevKeys = openTabKeysRef.current || []
      const nextKeys = prevKeys.filter(k => !closing.has(k))
      const currentActive = String(activeTabKeyRef.current || '').trim()

      // 先按档案解析再过滤打开列表：转正草稿的原始标识经解析落到真实标识，随真实标签一并关闭。
      // 必须同步求值（函数式更新会被推迟到 discard 之后执行，届时解析已失效）。
      const nextOpenNoteIds = filterOpenNoteIdsForClose(draftIdentity, openNoteIdsRef.current, closing)

      for (const key of closing) {
        if (tabKind(key) !== 'note') continue
        const nid = noteIdFromTabKey(key)
        if (!nid) continue
        // 草稿被放弃：只在档案注销一次，收藏夹引用等消费方订阅后自动清理。
        draftIdentity.discard(nid)
        delete noteSessionHandlesRef.current[nid]
        delete noteScrollTopByIdRef.current[nid]
      }

      let nextActive = currentActive
      const didCloseActive = currentActive && closing.has(currentActive)
      if (didCloseActive) {
        const prevIdx = prevKeys.indexOf(currentActive)
        nextActive = nextKeys[prevIdx] || nextKeys[prevIdx - 1] || ''
      }

      updateSidebarItems(prev => closeTabsInSidebar(prev, Array.from(closing)), { activeTabKey: nextActive })

      setOpenNoteIds(nextOpenNoteIds)
      setOpenAssetTabs(prev => prev.filter(a => !closing.has(assetTabId(a))))

      setActiveTabKey(nextActive as any)

      if (!didCloseActive) return

      // 关闭的是从右侧收藏夹栏打开的内容：在当前收藏夹页按原位置续接下一条/上一条
      // （只认笔记与附件；跳过同批被关闭的），接着打开，选中留在右侧栏。
      if (resolvedSelectionSourceRef.current === 'favorites') {
        const nextKey = nextFavoriteEntryAfterClose(favoritesFolderViewRef.current.entries, currentActive, closing)
        if (nextKey && activateFavoritesEntryKeyRef.current(nextKey)) return
      }

      // 选中态回到左侧标签栏（右侧栏没有可切换的条目）。
      setDetailSelectionSource('tabs')

      if (!nextActive) {
        setActiveNoteId('')
        if (pageRef.current === 'note-detail') navigatePage('home', { recordHistory: false })
        if (pageRef.current === 'asset-detail') navigatePage('attachments', { recordHistory: false })
        if (repoReadyRef.current) void persistRepoStatePatch({ activeTabKey: '' }).catch(() => {})
        return
      }

      activateExistingTabKey(nextActive, { recordHistory: false })
    },
    [activateExistingTabKey, draftIdentity, navigatePage, persistRepoStatePatch, updateSidebarItems],
  )

  React.useEffect(() => {
    closeTabKeysDirectRef.current = closeTabKeysDirect
  }, [closeTabKeysDirect])

  const handleCloseAssetTab = React.useCallback(
    (tabKey: string) => {
      const closingKey = String(tabKey || '').trim()
      if (!closingKey) return
      closeTabKeysDirect([closingKey])
    },
    [closeTabKeysDirect],
  )

  const handleCloseTabs = React.useCallback(
    (noteIds: string[]) => {
      const keys = (Array.isArray(noteIds) ? noteIds : []).map(id => noteTabKey(String(id || '').trim())).filter(Boolean)
      closeTabKeysDirect(keys)
    },
    [closeTabKeysDirect],
  )

  const {
    openNoteCardMenu,
    noteCardMenuNode,
    noteCardDeleteDialog,
    requestCloseTabRef,
    handleCloseTab,
    closeTabPromptDialog,
    setCloseTabPrompt,
  } = useNoteCardMenus({
    visible,
    gateway,
    trashEnabled,
    allNotes,
    openNoteTabs,
    noteSessionHandlesRef,
    isNoteDirtyById,
    isNoteSavingById,
    handleDeleteNote,
    handleCloseTabs,
    setDetailSelectionSource,
    setActiveNoteId,
    setActiveTabKey,
    commitActiveWorkspacePatch,
    navigatePage,
  })

  const handleNoteSessionSaved = React.useCallback((payload: {
    originalId: string
    meta: NoteMeta
    snapshotForNewId?: NoteDetailSnapshotV1
  }) => {
    const originalId = String(payload.originalId || '').trim()
    const meta = payload.meta
    if (!originalId || !meta?.id) return

    const didMigrateId = meta.id !== originalId
    if (didMigrateId) {
      // 草稿转正：只在档案内把标识改指向真实笔记（带上新会话快照）。
      // 打开的标签列表保留草稿标识，读取时经档案解析自动指向真实笔记，消费方无需搬运。
      draftIdentity.promote(originalId, meta.id, payload.snapshotForNewId)
      delete noteSessionHandlesRef.current[originalId]
      if (noteScrollTopByIdRef.current[originalId] != null) {
        noteScrollTopByIdRef.current[meta.id] = noteScrollTopByIdRef.current[originalId]
        delete noteScrollTopByIdRef.current[originalId]
      }
      setCloseTabPrompt(p => (p?.noteId === originalId ? { noteId: meta.id } : p))
    }

    setNoteIndex(prev => {
      const current = prev || { version: 1, notes: {} }
      const nextNotes = { ...(current.notes || {}) }
      if (didMigrateId) delete nextNotes[originalId]
      nextNotes[meta.id] = meta
      return { ...current, notes: nextNotes }
    })

    void refreshNoteCardInfo(meta).catch(() => {})

    // 保存（含面删除、版本恢复）会改变该笔记发出的引用，打开的会话重取反向引用。
    bumpRefRelationsEpoch()

    if (activeNoteId === originalId) setActiveNoteId(meta.id)
  }, [activeNoteId, bumpRefRelationsEpoch, draftIdentity, refreshNoteCardInfo, setCloseTabPrompt])

  return {
    noteSessionHandlesRef,
    requestCloseTabRef,
    getNoteSessionRefCallback,
    handleNoteDirtyChange,
    isNoteDirtyById,
    refRelationsEpoch,
    bumpRefRelationsEpoch,
    allNotesById,
    faceSwitchRequest,
    faceSwitchLatestSeq,
    handleFaceSwitchConsumed,
    noteCardInfoById,
    refreshNoteCardInfo,
    ensureNoteCardInfoLoaded,
    noteIndexMap,
    handleOpenNote,
    handleCreateNoteInIndex,
    handleDeleteNote,
    handleTrashRestored,
    closeTabKeysDirect,
    handleCloseAssetTab,
    handleCloseTab,
    handleNoteSessionSaved,
    openNoteCardMenu,
    noteCardMenuNode,
    noteCardDeleteDialog,
    closeTabPromptDialog,
  }
}
