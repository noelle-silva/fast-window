import * as React from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Menu, MenuItem, Typography } from '@mui/material'
import { type HyperCortexIndexV1, type HyperCortexRepoStateV1, type HyperCortexWorkspaceV1, type NoteMeta } from '../core'
import type { HyperCortexGateway } from '../gateway'
import { isDraftNoteId } from '../drafts'
import { addRef, type HyperCortexFavoritesDocV1 } from '../favorites'
import { orderKindsByGlobalOrder } from '../facePreferences'
import { noteIdFromTabKey, noteTabKey, tabKind, type TabKey } from '../tabKey'
import { assetTabId, type AssetEntry } from '../assetTypes'
import type { DraftIdentity } from './draftIdentity'
import type { NoteCardInfo } from './noteCardInfo'
import { loadNoteCardInfo, startPrefetchNoteCardInfo } from './noteCardInfoLoader'
import { menuDangerItemSx, menuPaperSx, softButtonSx } from './pluginUiStyles'
import type { NoteDetailSessionHandle, NoteDetailSnapshotV1 } from './NoteDetailSession'
import { closeTabsInSidebar, deriveSidebarFields, insertTabAsUngrouped, type SidebarItem } from './sidebarModel'
import { buildNoteInitSnapshot, filterOpenNoteIdsForClose } from './useDraftOrchestration'
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
  handleFavoritesDocChange: (nextDoc: HyperCortexFavoritesDocV1) => void
  draftIdentity: DraftIdentity
  openTabKeysRef: React.MutableRefObject<TabKey[]>
  activeTabKeyRef: React.MutableRefObject<TabKey>
  pageRef: React.MutableRefObject<PageId>
  openNoteIdsRef: React.MutableRefObject<string[]>
  noteScrollTopByIdRef: React.MutableRefObject<Record<string, number>>
  repoReadyRef: React.MutableRefObject<boolean>
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
    handleFavoritesDocChange,
    draftIdentity,
    openTabKeysRef,
    activeTabKeyRef,
    pageRef,
    openNoteIdsRef,
    noteScrollTopByIdRef,
    repoReadyRef,
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

  const [noteCardMenu, setNoteCardMenu] = React.useState<{ anchorEl: HTMLElement; note: NoteMeta } | null>(null)
  const openNoteCardMenu = React.useCallback((e: React.MouseEvent, note: NoteMeta) => {
    e.stopPropagation()
    setNoteCardMenu({ anchorEl: e.currentTarget as HTMLElement, note })
  }, [])
  const closeNoteCardMenu = React.useCallback(() => setNoteCardMenu(null), [])

  const [noteCardDeleteTarget, setNoteCardDeleteTarget] = React.useState<NoteMeta | null>(null)

  const noteSessionHandlesRef = React.useRef<Record<string, NoteDetailSessionHandle | null>>({})
  const [closeTabPrompt, setCloseTabPrompt] = React.useState<{ noteId: string } | null>(null)
  const requestCloseTabRef = React.useRef<(noteId: string) => void>(() => {})

  const [noteDirtyById, setNoteDirtyById] = React.useState<Record<string, boolean>>({})
  const handleNoteDirtyChange = React.useCallback((payload: { noteId: string; dirty: boolean }) => {
    const nid = String(payload?.noteId || '').trim()
    if (!nid) return
    const nextDirty = payload?.dirty === true
    setNoteDirtyById(prev => {
      const had = Object.prototype.hasOwnProperty.call(prev, nid)
      const prevValue = had ? prev[nid] === true : false
      if (had && prevValue === nextDirty) return prev
      return { ...prev, [nid]: nextDirty }
    })
  }, [])

  const noteSessionRefCallbacksRef = React.useRef<Record<string, (handle: NoteDetailSessionHandle | null) => void>>({})
  const setNoteSessionHandle = React.useCallback((noteId: string, handle: NoteDetailSessionHandle | null) => {
    const nid = String(noteId || '').trim()
    if (!nid) return
    if (!handle) {
      delete noteSessionHandlesRef.current[nid]
      setNoteDirtyById(prev => {
        if (!Object.prototype.hasOwnProperty.call(prev, nid)) return prev
        const next = { ...prev }
        delete next[nid]
        return next
      })
      return
    }
    noteSessionHandlesRef.current[nid] = handle
  }, [])

  const getNoteSessionRefCallback = React.useCallback((noteId: string) => {
    const nid = String(noteId || '').trim()
    if (!nid) return undefined
    if (!noteSessionRefCallbacksRef.current[nid]) {
      noteSessionRefCallbacksRef.current[nid] = (handle: NoteDetailSessionHandle | null) => {
        setNoteSessionHandle(nid, handle)
      }
    }
    return noteSessionRefCallbacksRef.current[nid]
  }, [setNoteSessionHandle])

  const isNoteDirtyById = React.useCallback((noteId: string): boolean => {
    const nid = String(noteId || '').trim()
    if (!nid) return false
    if (Object.prototype.hasOwnProperty.call(noteDirtyById, nid)) return noteDirtyById[nid] === true
    return noteSessionHandlesRef.current[nid]?.isDirty?.() === true
  }, [noteDirtyById])

  const isNoteSavingById = React.useCallback((noteId: string): boolean => {
    const nid = String(noteId || '').trim()
    if (!nid) return false
    return noteSessionHandlesRef.current[nid]?.isSaving?.() === true
  }, [])

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

  // ---- 全部笔记：卡片摘要（tags / faces）
  const [noteCardInfoById, setNoteCardInfoById] = React.useState<Record<string, NoteCardInfo>>({})
  const noteCardInfoByIdRef = React.useRef<Record<string, NoteCardInfo>>({})
  React.useEffect(() => {
    noteCardInfoByIdRef.current = noteCardInfoById
  }, [noteCardInfoById])

  const upsertNoteCardInfo = React.useCallback((noteId: string, nextInfo: NoteCardInfo) => {
    const nid = String(noteId || '').trim()
    if (!nid) return
    setNoteCardInfoById(prev => {
      const existed = prev[nid]
      if (
        existed &&
        existed.faceLabels.join('\n') === nextInfo.faceLabels.join('\n') &&
        existed.faceIds.join('\n') === nextInfo.faceIds.join('\n') &&
        existed.tags.join('\n') === nextInfo.tags.join('\n')
      ) return prev
      return { ...prev, [nid]: nextInfo }
    })
  }, [])

  const refreshNoteCardInfo = React.useCallback(
    async (meta: NoteMeta) => {
      const nid = String(meta?.id || '').trim()
      if (!nid) return
      const info = await loadNoteCardInfo(gateway.notes, 'library', meta, faceKindOrder).catch(() => null)
      if (!info) return
      upsertNoteCardInfo(nid, info)
    },
    [faceKindOrder, gateway, upsertNoteCardInfo],
  )

  const ensureNoteCardInfoLoaded = React.useCallback(
    async (meta: NoteMeta) => {
      const nid = String(meta?.id || '').trim()
      if (!nid) return
      if (noteCardInfoByIdRef.current[nid]) return
      await refreshNoteCardInfo(meta)
    },
    [refreshNoteCardInfo],
  )

  React.useEffect(() => {
    if (!visible) return
    if (visiblePage !== 'all-notes') return
    const ctl = startPrefetchNoteCardInfo({
      notes: allNotes,
      getInfoById: id => noteCardInfoByIdRef.current[id],
      refresh: ensureNoteCardInfoLoaded,
      maxWorkers: 6,
    })
    return () => ctl.cancel()
  }, [allNotes, ensureNoteCardInfoLoaded, visible, visiblePage])

  const noteIndexMap = React.useMemo(() => {
    const map: Record<string, { title: string; faceIds: string[] }> = {}
    for (const n of allNotes) {
      map[n.id] = { title: n.title, faceIds: noteCardInfoById[n.id]?.faceIds || [] }
    }
    return map
  }, [allNotes, noteCardInfoById])

  const handleDeleteNote = React.useCallback(
    async (payload: { note: NoteMeta; mode: 'trash' | 'permanent' }) => {
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
        if (payload.mode === 'trash') await gateway.trash.moveNoteToTrash('library', note)
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

  const confirmDeleteNoteFromCard = React.useCallback(async () => {
    const target = noteCardDeleteTarget
    if (!target) return
    closeNoteCardMenu()
    const mode: 'trash' | 'permanent' = trashEnabled ? 'trash' : 'permanent'
    try {
      await handleDeleteNote({ note: target, mode })
      setNoteCardDeleteTarget(null)
    } catch (e: any) {
      void gateway.host.toast(String(e?.message || e || '删除失败'))
    }
  }, [closeNoteCardMenu, gateway.host, handleDeleteNote, noteCardDeleteTarget, trashEnabled])

  const requestCopyTitleFromCardMenu = React.useCallback(async () => {
    const note = noteCardMenu?.note
    if (!note) return
    closeNoteCardMenu()
    const title = String(note.title || '').trim() || '未命名'
    try {
      await gateway.clipboard.writeText(title)
      void gateway.host.toast('已复制标题')
    } catch (e: any) {
      void gateway.host.toast(String(e?.message || e || '复制失败'))
    }
  }, [gateway, closeNoteCardMenu, noteCardMenu])

  const requestOpenDirFromCardMenu = React.useCallback(async () => {
    const note = noteCardMenu?.note
    if (!note) return
    closeNoteCardMenu()
    if (isDraftNoteId(note.id) || !String(note.dir || '').trim()) {
      void gateway.host.toast('草稿暂无所在目录（请先保存）')
      return
    }
    try {
      await gateway.host.openVaultDir('library', note.dir)
    } catch (e: any) {
      void gateway.host.toast(String(e?.message || e || '打开目录失败'))
    }
  }, [gateway, closeNoteCardMenu, noteCardMenu])

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
      const baseDoc = favoritesDoc
      if (!baseDoc) return

      try {
        const result = await gateway.notes.createEmptyNote('library', {
          title: '未命名',
          description: '',
          tags: [],
          faceKinds: orderKindsByGlobalOrder(defaultFaceKinds, faceKindOrder),
        })
        const meta = result.meta
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
    [defaultFaceKinds, draftIdentity, faceKindOrder, favoritesDoc, gateway, handleFavoritesDocChange, handleOpenNote],
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

      // 关闭了当前激活目标：选中态回到左侧标签栏（右侧栏引用已不在当前详情）。
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

  React.useEffect(() => {
    requestCloseTabRef.current = requestCloseTab
  }, [requestCloseTab])

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
  }, [activeNoteId, bumpRefRelationsEpoch, draftIdentity, refreshNoteCardInfo])

  const closeTabPromptTargetSaving = !!closeTabPrompt && isNoteSavingById(closeTabPrompt.noteId)

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
    setDetailSelectionSource('tabs')
    setActiveNoteId(nid)
    setActiveTabKey(noteTabKey(nid))
    commitActiveWorkspacePatch({ activeTabKey: noteTabKey(nid) })
    navigatePage('note-detail')
    noteSessionHandlesRef.current[nid]?.enterEditMode?.()
  }, [closeTabPrompt?.noteId, commitActiveWorkspacePatch, navigatePage])

  const handleCloseTabPromptDiscardAndClose = React.useCallback(() => {
    const nid = String(closeTabPrompt?.noteId || '').trim()
    if (!nid) return
    setCloseTabPrompt(null)
    noteSessionHandlesRef.current[nid]?.discardChanges?.()
    handleCloseTabs([nid])
  }, [closeTabPrompt?.noteId, handleCloseTabs])

  const noteCardMenuNode = (
    <Menu
      open={visible && !!noteCardMenu}
      onClose={closeNoteCardMenu}
      anchorEl={noteCardMenu?.anchorEl}
      PaperProps={{ sx: menuPaperSx }}
    >
      <MenuItem onClick={() => void requestCopyTitleFromCardMenu()}>
        复制标题
      </MenuItem>
      <MenuItem
        onClick={() => void requestOpenDirFromCardMenu()}
        disabled={!noteCardMenu?.note || isDraftNoteId(noteCardMenu.note.id) || !String(noteCardMenu.note.dir || '').trim()}
      >
        打开所在目录
      </MenuItem>
      <MenuItem
        onClick={() => {
          const target = noteCardMenu?.note
          if (!target) return
          setNoteCardDeleteTarget(target)
          closeNoteCardMenu()
        }}
        sx={menuDangerItemSx}
      >
        删除此笔记…
      </MenuItem>
    </Menu>
  )

  const noteCardDeleteDialog = (
    <Dialog open={visible && !!noteCardDeleteTarget} onClose={() => setNoteCardDeleteTarget(null)} maxWidth="xs" fullWidth>
      <DialogTitle>
        {noteCardDeleteTarget && isDraftNoteId(noteCardDeleteTarget.id)
          ? '删除草稿'
          : trashEnabled
            ? '移入回收站'
            : '永久删除'}
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.72)' }}>
          {noteCardDeleteTarget && isDraftNoteId(noteCardDeleteTarget.id)
            ? `确定删除草稿「${noteCardDeleteTarget.title || '未命名'}」吗？这会丢弃当前内容。`
            : trashEnabled
              ? `确定将笔记「${noteCardDeleteTarget?.title || '未命名'}」移入回收站吗？`
              : `回收站当前未启用。确定永久删除笔记「${noteCardDeleteTarget?.title || '未命名'}」吗？此操作不可撤销。`}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setNoteCardDeleteTarget(null)}>取消</Button>
        <Button variant="contained" color="error" onClick={() => void confirmDeleteNoteFromCard()}>
          {noteCardDeleteTarget && isDraftNoteId(noteCardDeleteTarget.id)
            ? '删除'
            : trashEnabled
              ? '移入回收站'
              : '永久删除'}
        </Button>
      </DialogActions>
    </Dialog>
  )

  const closeTabPromptDialog = (
    <Dialog open={visible && !!closeTabPrompt} onClose={handleCloseTabPromptCancel} maxWidth="xs" fullWidth>
      <DialogTitle>未保存改动</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.72)' }}>
          笔记「{closeTabPromptTitle}」还有未保存的改动。关闭标签页会丢失这些改动，请先保存或放弃改动。
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCloseTabPromptCancel}>取消</Button>
        <Button variant="text" onClick={handleCloseTabPromptGoSave} sx={softButtonSx}>去保存</Button>
        <Button variant="contained" color="error" onClick={handleCloseTabPromptDiscardAndClose} disabled={closeTabPromptTargetSaving}>放弃改动并关闭</Button>
      </DialogActions>
    </Dialog>
  )

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
