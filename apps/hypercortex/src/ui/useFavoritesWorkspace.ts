import * as React from 'react'
import { type HyperCortexFavoritesNavV1, type HyperCortexRepoStateV1, type NoteMeta } from '../core'
import type { HyperCortexGateway } from '../gateway'
import type { SidebarDisplayMode } from '../appSettingsModel'
import type { AssetEntry } from '../assetTypes'
import { addRef, collectRefsForTarget, createFolder, deleteFolder, findRefById, getFolderById, getRefsByFolderId, moveRef, removeRefsByIds, reorderRefsInFolder, type FavoriteItemRef, type HyperCortexFavoritesDocV1 } from '../favorites'
import { createFavoritesLedger, type FavoritesLedger } from '../favoritesLedger'
import { resolveAssetRef } from '../assetLookup'
import { startPickedLocalAssetUploadTask } from '../services/localAssetUpload'
import type { TabKey } from '../tabKey'
import {
  createFavoritesNav,
  goBackFavoritesNav,
  goForwardFavoritesNav,
  navigateFavoritesNav,
  reconcileFavoritesNav,
} from './favoritesNavigator'
import { buildFavoriteFolderView, type FavoriteFolderView } from './favoritesSidebarModel'
import { ASSET_UPLOAD_WAIT_INTERVAL_MS, assetKeyFromResource, sleep } from './useAssetPoolSessions'
import { useFavoritesEntityActions, type FavoritesEntityTarget } from './useFavoritesEntityActions'
import { resolveSidebarLayout } from './sidebarLayout'
import type { FavoritesForeignDrop, FavoritesForeignPayload } from './useFavoritesSidebarDnd'
import type { SidebarPreviewTarget } from './sidebar-preview/previewTarget'

// 收藏夹现场：收藏夹文档状态与落盘接线、主界面收藏夹页当前层与导航、右侧栏浏览位置（前进后退与文档调和）、
// 当前页视图组装、右侧栏悬停与布局状态、收藏夹实体操作（右键菜单、编辑信息、删除、拖拽排序、上传附件入索引）
// 与右侧栏条目激活入口。
// 中心文件先接状态（供装载与草稿编排消费），待打开/删除/更新等能力齐备后再接动作。
// 两段之间只经显式入参与回调连接，不引入隐式全局。

export function useFavoritesWorkspaceState(opts: {
  gateway: HyperCortexGateway
  assetIndex?: Record<string, any>
  activeTabKey: TabKey
  detailSelectionSource: 'tabs' | 'favorites'
  favoritesSidebarMode: SidebarDisplayMode
  favoritesSidebarCollapsed: boolean
  favoritesSidebarWidth: number
  handleSidebarPreviewHover: (target: SidebarPreviewTarget | null) => void
}): {
  favoritesLedger: FavoritesLedger
  favoritesDoc: HyperCortexFavoritesDocV1 | null
  setFavoritesDoc: React.Dispatch<React.SetStateAction<HyperCortexFavoritesDocV1 | null>>
  favoritesDocRef: React.MutableRefObject<HyperCortexFavoritesDocV1 | null>
  handleFavoritesDocChange: (nextDoc: HyperCortexFavoritesDocV1) => void
  currentFolderId: string
  setCurrentFolderId: React.Dispatch<React.SetStateAction<string>>
  favoritesNav: HyperCortexFavoritesNavV1
  setFavoritesNav: React.Dispatch<React.SetStateAction<HyperCortexFavoritesNavV1>>
  favoritesFolderView: FavoriteFolderView
  favoritesFolderViewRef: React.MutableRefObject<FavoriteFolderView>
  resolvedSelectionSource: 'tabs' | 'favorites'
  resolvedSelectionSourceRef: React.MutableRefObject<'tabs' | 'favorites'>
  setFavoritesHoverOpen: React.Dispatch<React.SetStateAction<boolean>>
  favoritesHoverRef: React.MutableRefObject<boolean>
  favoritesSidebarShortcutHoldRef: React.MutableRefObject<boolean>
  rightSidebarLayout: ReturnType<typeof resolveSidebarLayout>
  onFavoritesSidebarMouseEnter: () => void
  onFavoritesSidebarMouseLeave: () => void
} {
  const {
    gateway,
    assetIndex,
    activeTabKey,
    detailSelectionSource,
    favoritesSidebarMode,
    favoritesSidebarCollapsed,
    favoritesSidebarWidth,
    handleSidebarPreviewHover,
  } = opts

  // 收藏夹账本管理员：收藏夹文档的唯一读写入口（装载 + 落盘）。
  const favoritesLedger = React.useMemo(() => createFavoritesLedger(gateway, 'library'), [gateway])

  const [favoritesDoc, setFavoritesDoc] = React.useState<HyperCortexFavoritesDocV1 | null>(null)
  const [currentFolderId, setCurrentFolderId] = React.useState<string>('root')
  // 收藏夹导航栏（右侧栏）的独立浏览位置：与主界面收藏夹页互不干扰，随仓库持久化。
  const [favoritesNav, setFavoritesNav] = React.useState<HyperCortexFavoritesNavV1>(() => createFavoritesNav())
  // 快捷键切换列表时的「最新值」引用：键盘回调常驻挂载，必须从 ref 读取当前数据。
  const favoritesDocRef = React.useRef(favoritesDoc)
  React.useEffect(() => {
    favoritesDocRef.current = favoritesDoc
  }, [favoritesDoc])

  // 右侧收藏夹栏当前页的唯一视图：渲染与键盘切换共用同一份组装，避免配方重复。
  const favoritesFolderView = React.useMemo(
    () => buildFavoriteFolderView({ doc: favoritesDoc, folderId: favoritesNav.currentFolderId, assetIndex }),
    [favoritesDoc, favoritesNav.currentFolderId, assetIndex],
  )
  const favoritesFolderViewRef = React.useRef(favoritesFolderView)
  React.useEffect(() => {
    favoritesFolderViewRef.current = favoritesFolderView
  }, [favoritesFolderView])

  // 选中归属的最终事实：来源为右且当前目标确实在右侧当前页里，才算右；否则回落左。
  // 高亮与快捷键切换共用这一个派生值，保证任何时刻有且仅有一处选中。
  const favoritesEntryTabKeys = React.useMemo(
    () => new Set(favoritesFolderView.entries.map(entry => entry.tabKey)),
    [favoritesFolderView],
  )
  const resolvedSelectionSource: 'tabs' | 'favorites' =
    detailSelectionSource === 'favorites' && !!activeTabKey && favoritesEntryTabKeys.has(activeTabKey) ? 'favorites' : 'tabs'
  const resolvedSelectionSourceRef = React.useRef(resolvedSelectionSource)
  React.useEffect(() => {
    resolvedSelectionSourceRef.current = resolvedSelectionSource
  }, [resolvedSelectionSource])

  // ---- 收藏夹导航栏（右侧栏）
  const [favoritesHoverOpen, setFavoritesHoverOpen] = React.useState(false)
  const favoritesHoverRef = React.useRef(false)
  const favoritesSidebarShortcutHoldRef = React.useRef(false)
  const isHoverFavoritesMode = favoritesSidebarMode === 'hover'
  const rightSidebarLayout = resolveSidebarLayout({
    mode: favoritesSidebarMode,
    collapsed: favoritesSidebarCollapsed,
    hoverOpen: favoritesHoverOpen,
    expandedWidth: favoritesSidebarWidth,
  })

  const onFavoritesSidebarMouseEnter = React.useCallback(() => {
    favoritesHoverRef.current = true
    if (isHoverFavoritesMode) setFavoritesHoverOpen(true)
  }, [isHoverFavoritesMode])

  const onFavoritesSidebarMouseLeave = React.useCallback(() => {
    favoritesHoverRef.current = false
    handleSidebarPreviewHover(null)
    if (!isHoverFavoritesMode) return
    if (favoritesSidebarShortcutHoldRef.current) return
    setFavoritesHoverOpen(false)
  }, [handleSidebarPreviewHover, isHoverFavoritesMode])

  const handleFavoritesDocChange = React.useCallback(
    (nextDoc: HyperCortexFavoritesDocV1) => {
      setFavoritesDoc(nextDoc)
      // 内存保留草稿引用；落盘由账本管理员统一转换（磁盘态过滤草稿引用）。
      favoritesLedger.commit(nextDoc)
    },
    [favoritesLedger],
  )

  return {
    favoritesLedger,
    favoritesDoc,
    setFavoritesDoc,
    favoritesDocRef,
    handleFavoritesDocChange,
    currentFolderId,
    setCurrentFolderId,
    favoritesNav,
    setFavoritesNav,
    favoritesFolderView,
    favoritesFolderViewRef,
    resolvedSelectionSource,
    resolvedSelectionSourceRef,
    setFavoritesHoverOpen,
    favoritesHoverRef,
    favoritesSidebarShortcutHoldRef,
    rightSidebarLayout,
    onFavoritesSidebarMouseEnter,
    onFavoritesSidebarMouseLeave,
  }
}

export function useFavoritesWorkspaceActions(opts: {
  gateway: HyperCortexGateway
  trashEnabled: boolean
  favoritesDoc: HyperCortexFavoritesDocV1 | null
  favoritesDocRef: React.MutableRefObject<HyperCortexFavoritesDocV1 | null>
  handleFavoritesDocChange: (nextDoc: HyperCortexFavoritesDocV1) => void
  currentFolderId: string
  setCurrentFolderId: React.Dispatch<React.SetStateAction<string>>
  setFavoritesNav: React.Dispatch<React.SetStateAction<HyperCortexFavoritesNavV1>>
  favoritesNavRef: React.MutableRefObject<HyperCortexFavoritesNavV1>
  persistRepoStatePatch: (patch: Partial<HyperCortexRepoStateV1>) => Promise<void>
  repoReadyRef: React.MutableRefObject<boolean>
  clearFavoritesScrollMemory: (key: string) => void
  setAssetPoolIndex: React.Dispatch<React.SetStateAction<Record<string, any> | null>>
  favoritesFolderView: FavoriteFolderView
  favoritesFolderViewRef: React.MutableRefObject<FavoriteFolderView>
  resolvedNoteIndex: Record<string, NoteMeta>
  noteIndexRef: React.MutableRefObject<{ notes?: Record<string, NoteMeta> }>
  activateFavoritesEntryKeyRef: React.MutableRefObject<(tabKey: string) => boolean>
  handleOpenNote: (note: NoteMeta, faceId?: string, source?: 'tabs' | 'favorites', opts?: { recordHistory?: boolean }) => void
  handleOpenAssetTab: (asset: AssetEntry, source?: 'tabs' | 'favorites', opts?: { recordHistory?: boolean }) => void
  handleUpdateNoteInfo: (note: NoteMeta, patch: { title: string; description: string }) => Promise<void>
  handleUpdateAssetInfo: (asset: AssetEntry, patch: { displayName: string; remark: string }) => Promise<void>
  handleDeleteNote: (payload: { note: NoteMeta; mode: 'trash' | 'permanent'; refs?: FavoriteItemRef[] }) => Promise<void>
  requestDeleteAssetEntity: (asset: AssetEntry, opts?: { refs?: FavoriteItemRef[]; mode?: 'trash' | 'permanent' }) => Promise<boolean>
}): {
  handleNavigateFolder: (folderId: string) => void
  handleDeleteFolderEntity: (folderId: string) => void
  handleCreateFolderInFavorites: (info: { title: string; description: string }) => void
  handleUploadAssetsIntoIndex: (folderId: string) => Promise<void>
  handleFavoritesSidebarNavigate: (folderId: string) => void
  handleFavoritesSidebarBack: () => void
  handleFavoritesSidebarForward: () => void
  handleFavoritesSidebarContextMenu: (event: React.MouseEvent, ref: FavoriteItemRef) => void
  handleFavoritesSidebarReorder: (folderId: string, orderedRefIds: string[]) => void
  handleFavoritesSidebarMoveRef: (refId: string, targetFolderId: string) => void
  /** 左侧工作区侧栏条目的同源实体菜单：笔记/附件条目右键，仅保留打开、收藏到…、编辑信息。 */
  handleWorkspaceNoteContextMenu: (event: React.MouseEvent, note: NoteMeta) => void
  handleWorkspaceAssetContextMenu: (event: React.MouseEvent, asset: AssetEntry) => void
  /** 跨栏拖拽落点写入：默认插到当前收藏夹的落点位置，Ctrl 放入悬停收藏夹；复用既有收藏能力，复制引用。 */
  handleCrossColumnDrop: (payload: FavoritesForeignPayload, target: FavoritesForeignDrop) => void
  favoritesEntityNode: React.ReactNode
  workspaceTabEntityNode: React.ReactNode
} {
  const {
    gateway,
    trashEnabled,
    favoritesDoc,
    favoritesDocRef,
    handleFavoritesDocChange,
    currentFolderId,
    setCurrentFolderId,
    setFavoritesNav,
    favoritesNavRef,
    persistRepoStatePatch,
    repoReadyRef,
    clearFavoritesScrollMemory,
    setAssetPoolIndex,
    favoritesFolderView,
    favoritesFolderViewRef,
    resolvedNoteIndex,
    noteIndexRef,
    activateFavoritesEntryKeyRef,
    handleOpenNote,
    handleOpenAssetTab,
    handleUpdateNoteInfo,
    handleUpdateAssetInfo,
    handleDeleteNote,
    requestDeleteAssetEntity,
  } = opts

  const persistFavoritesNav = React.useCallback(
    (next: HyperCortexFavoritesNavV1) => {
      setFavoritesNav(next)
      if (repoReadyRef.current) void persistRepoStatePatch({ favoritesNav: next }).catch(() => {})
    },
    [persistRepoStatePatch],
  )

  const handleFavoritesSidebarNavigate = React.useCallback(
    (folderId: string) => {
      const next = navigateFavoritesNav(favoritesNavRef.current, folderId)
      if (next === favoritesNavRef.current) return
      persistFavoritesNav(next)
    },
    [persistFavoritesNav],
  )

  const handleFavoritesSidebarBack = React.useCallback(() => {
    const next = goBackFavoritesNav(favoritesNavRef.current)
    if (next === favoritesNavRef.current) return
    persistFavoritesNav(next)
  }, [persistFavoritesNav])

  const handleFavoritesSidebarForward = React.useCallback(() => {
    const next = goForwardFavoritesNav(favoritesNavRef.current)
    if (next === favoritesNavRef.current) return
    persistFavoritesNav(next)
  }, [persistFavoritesNav])

  // 收藏夹文档变化（含实体删除）后调和导航位置：失效层回到根，历史剔除失效条目。
  React.useEffect(() => {
    if (!favoritesDoc) return
    const existing = new Set(Object.keys(favoritesDoc.folders || {}))
    const current = favoritesNavRef.current
    const next = reconcileFavoritesNav(current, existing)
    if (next === current) return
    persistFavoritesNav(next)
  }, [favoritesDoc, persistFavoritesNav])

  const handleNavigateFolder = React.useCallback(
    (folderId: string) => {
      setCurrentFolderId(folderId)
      if (repoReadyRef.current) void persistRepoStatePatch({ currentFolderId: folderId }).catch(() => {})
    },
    [persistRepoStatePatch],
  )

  // 删除收藏夹实体：回收站启用时先把完整快照（收藏夹信息 + 页面条目清单 + 别处指向它的引用）移入回收站，
  // 再移除文档中的收藏夹本体、页面条目与别处指向它的引用；恢复时本体与引用一起原样放回。
  // 引用移除与实体移除在这里合并为一次文档更新，避免连续两次提交丢更新。
  const handleDeleteFolderEntity = React.useCallback(
    (folderId: string) => {
      const id = String(folderId || '').trim()
      if (!id || id === 'root') return
      const base = favoritesDocRef.current
      const folder = base?.folders[id]
      if (!base || !folder) return

      const refs = getRefsByFolderId(base, id)
      // 别处指向本收藏夹的引用：随本体一并移除并打包，恢复时原样放回。
      const inboundRefs = collectRefsForTarget(base, 'folder', id)
      const withoutEntity = deleteFolder(removeRefsByIds(base, inboundRefs.map(ref => ref.id)), id)
      if (!withoutEntity) return

      const finish = () => {
        handleFavoritesDocChange(withoutEntity)
        // 删除收藏夹时丢弃其滚动记账，避免陈旧记忆残留。
        clearFavoritesScrollMemory(id)
        if (currentFolderId === id) {
          setCurrentFolderId('root')
          if (repoReadyRef.current) void persistRepoStatePatch({ currentFolderId: 'root' }).catch(() => {})
        }
      }

      if (!trashEnabled) {
        finish()
        return
      }
      void gateway.trash
        .moveFolderToTrash('library', { folder, refs, inboundRefs })
        .then(finish)
        .catch((e: any) => void gateway.host.toast(`删除收藏夹失败：${String(e?.message || e || '未知错误')}`))
    },
    [clearFavoritesScrollMemory, currentFolderId, favoritesDocRef, gateway, handleFavoritesDocChange, persistRepoStatePatch, repoReadyRef, setCurrentFolderId, trashEnabled],
  )

  // 右侧栏当前层级新建真实收藏夹：先建实体，再在当前浏览层挂上引用；确认即经统一文档入口落盘，不自动跳转。
  const handleCreateFolderInFavorites = React.useCallback(
    (info: { title: string; description: string }) => {
      const base = favoritesDoc
      if (!base) return
      const created = createFolder(base, info.title, info.description)
      const added = addRef(created.doc, favoritesNavRef.current.currentFolderId, 'folder', created.folder.id)
      handleFavoritesDocChange(added?.doc || created.doc)
    },
    [favoritesDoc, handleFavoritesDocChange],
  )

  // 右侧收藏夹导航栏条目的实体操作：解析条目引用为统一目标，复用与索引页相同的菜单与对话框。
  // 附件查找表复用当前页视图，避免各处重复组装。
  const favoritesAssetLookup = favoritesFolderView.lookup
  const favoritesEntity = useFavoritesEntityActions({
    doc: favoritesDoc || { version: 1, rootFolderId: 'root', folders: {}, refsByFolderId: {} },
    onDocChange: handleFavoritesDocChange,
    toast: message => void gateway.host.toast(message),
    onOpenFolder: handleFavoritesSidebarNavigate,
    onOpenNote: note => void handleOpenNote(note, undefined, 'favorites'),
    onOpenAsset: asset => handleOpenAssetTab(asset, 'favorites'),
    canMoveRefs: true,
    canDeleteRefs: true,
    onUpdateNoteInfo: handleUpdateNoteInfo,
    onUpdateAssetInfo: handleUpdateAssetInfo,
    onDeleteFolderEntity: handleDeleteFolderEntity,
    onDeleteNoteEntity: (note, refs) =>
      handleDeleteNote({ note, mode: trashEnabled ? 'trash' : 'permanent', refs })
        .then(() => true)
        .catch((e: any) => {
          void gateway.host.toast(String(e?.message || e || '删除失败'))
          return false
        }),
    onDeleteAssetEntity: (asset, refs) => requestDeleteAssetEntity(asset, { refs, mode: trashEnabled ? 'trash' : 'permanent' }),
  })

  // 左侧工作区侧栏条目复用同一套实体操作菜单：只保留打开、收藏到…、编辑信息，
  // 不含「移动到…」与「删除」（条目没有引用身份，删除/移动无意义）。
  const workspaceTabEntity = useFavoritesEntityActions({
    doc: favoritesDoc || { version: 1, rootFolderId: 'root', folders: {}, refsByFolderId: {} },
    onDocChange: handleFavoritesDocChange,
    toast: message => void gateway.host.toast(message),
    onOpenNote: note => void handleOpenNote(note),
    onOpenAsset: asset => handleOpenAssetTab(asset),
    onUpdateNoteInfo: handleUpdateNoteInfo,
    onUpdateAssetInfo: handleUpdateAssetInfo,
  })

  const handleWorkspaceNoteContextMenu = React.useCallback(
    (event: React.MouseEvent, note: NoteMeta) => {
      workspaceTabEntity.openMenu(event, { kind: 'note', refId: '', note })
    },
    [workspaceTabEntity.openMenu],
  )

  const handleWorkspaceAssetContextMenu = React.useCallback(
    (event: React.MouseEvent, asset: AssetEntry) => {
      workspaceTabEntity.openMenu(event, { kind: 'asset', refId: '', asset })
    },
    [workspaceTabEntity.openMenu],
  )

  // 跨栏拖拽松手：复用既有收藏写入能力复制引用，左侧标签不动；已收藏则提示不重复添加。
  // 默认模式把条目插到当前收藏夹的落点位置；放入模式（Ctrl）放进悬停的收藏夹。
  const handleCrossColumnDrop = React.useCallback(
    (payload: FavoritesForeignPayload, target: FavoritesForeignDrop) => {
      const base = favoritesDocRef.current
      if (!base) return

      const alreadyIn = (folderId: string) =>
        getRefsByFolderId(base, folderId).some(ref => ref.kind === payload.kind && ref.targetId === payload.targetId)

      if (target.moveMode) {
        const overRef = findRefById(base, target.overRefId)
        if (!overRef || overRef.kind !== 'folder') return
        const folderId = overRef.targetId
        if (!base.folders[folderId]) return
        if (alreadyIn(folderId)) {
          void gateway.host.toast('该条目已收藏到该收藏夹')
          return
        }
        const added = addRef(base, folderId, payload.kind, payload.targetId)
        if (!added) {
          void gateway.host.toast('收藏失败')
          return
        }
        handleFavoritesDocChange(added.doc)
        void gateway.host.toast(`已收藏到 ${getFolderById(added.doc, folderId)?.title || '未命名收藏夹'}`)
        return
      }

      const folderId = String(favoritesNavRef.current?.currentFolderId || '').trim() || 'root'
      if (!base.folders[folderId]) return
      if (alreadyIn(folderId)) {
        void gateway.host.toast('该条目已收藏到该收藏夹')
        return
      }
      const refs = getRefsByFolderId(base, folderId)
      const insertIndex = Math.max(0, Math.min(target.insertIndex < 0 ? refs.length : target.insertIndex, refs.length))
      const added = addRef(base, folderId, payload.kind, payload.targetId)
      if (!added) {
        void gateway.host.toast('收藏失败')
        return
      }
      const orderedRefIds = refs.map(ref => ref.id)
      orderedRefIds.splice(insertIndex, 0, added.ref.id)
      const next = reorderRefsInFolder(added.doc, folderId, orderedRefIds)
      handleFavoritesDocChange(next)
      void gateway.host.toast(`已收藏到 ${getFolderById(next, folderId)?.title || '未命名收藏夹'}`)
    },
    [favoritesDocRef, favoritesNavRef, gateway, handleFavoritesDocChange],
  )

  const handleFavoritesSidebarContextMenu = React.useCallback(
    (event: React.MouseEvent, ref: FavoriteItemRef) => {
      let target: FavoritesEntityTarget
      if (ref.kind === 'folder') {
        target = { kind: 'folder', refId: ref.id, folderId: ref.targetId }
      } else if (ref.kind === 'note') {
        const note = resolvedNoteIndex[ref.targetId]
        target = note ? { kind: 'note', refId: ref.id, note } : { kind: 'stale', refId: ref.id }
      } else if (ref.kind === 'asset') {
        const asset = resolveAssetRef(favoritesAssetLookup, ref.targetId)
        target = asset ? { kind: 'asset', refId: ref.id, asset } : { kind: 'stale', refId: ref.id }
      } else {
        target = { kind: 'stale', refId: ref.id }
      }
      favoritesEntity.openMenu(event, target)
    },
    [favoritesAssetLookup, favoritesEntity, resolvedNoteIndex],
  )

  const handleFavoritesSidebarReorder = React.useCallback(
    (folderId: string, orderedRefIds: string[]) => {
      const base = favoritesDoc
      if (!base) return
      const next = reorderRefsInFolder(base, folderId, orderedRefIds)
      if (next !== base) handleFavoritesDocChange(next)
    },
    [favoritesDoc, handleFavoritesDocChange],
  )

  // 拖拽移动的落点提交：底层与右键「移动到…」共用 moveRef；自我拖放、循环引用等非法目标由底层统一拦截，
  // 这里按结果给出提示不静默，成功后提示「已移动到 目标名」。
  const handleFavoritesSidebarMoveRef = React.useCallback(
    (refId: string, targetFolderId: string) => {
      const base = favoritesDoc
      if (!base) return
      const result = moveRef(base, refId, [targetFolderId])
      if (result.outcome !== 'moved') {
        void gateway.host.toast('不能移动到该收藏夹')
        return
      }
      if (result.doc !== base) handleFavoritesDocChange(result.doc)
      const targetTitle = getFolderById(result.doc, targetFolderId)?.title || '未命名收藏夹'
      void gateway.host.toast(`已移动到 ${targetTitle}`)
    },
    [favoritesDoc, gateway, handleFavoritesDocChange],
  )

  const handleUploadAssetsIntoIndex = React.useCallback(
    async (folderId: string) => {
      const fid = String(folderId || '').trim() || 'root'
      const baseDoc = favoritesDoc
      if (!baseDoc) return

      try {
        const task = await startPickedLocalAssetUploadTask(gateway, 'library')
        if (!task) return
        void gateway.host.toast('上传任务已开始，完成后会添加到当前索引')

        let completed = task
        while (completed.status === 'queued' || completed.status === 'running' || completed.status === 'paused') {
          await sleep(ASSET_UPLOAD_WAIT_INTERVAL_MS)
          const tasks = await gateway.assets.listUploadTasks()
          completed = tasks.find(item => item.id === task.id) || completed
        }

        if (completed.status === 'failed') throw new Error(completed.error || '上传任务失败')
        if (completed.status === 'canceled') {
          void gateway.host.toast('上传任务已取消')
          return
        }

        const imported = completed.result || []
        if (!imported.length) return
        let nextDoc = baseDoc
        let addedCount = 0
        for (const resource of imported) {
          const key = assetKeyFromResource(resource)
          if (!key) continue
          const added = addRef(nextDoc, fid, 'asset', key)
          if (!added) continue
          nextDoc = added.doc
          addedCount += 1
        }

        if (nextDoc !== baseDoc) handleFavoritesDocChange(nextDoc)
        const nextAssetIndex = await gateway.assets.ensureAssetsIndex('library').catch(() => null)
        if (nextAssetIndex) setAssetPoolIndex(nextAssetIndex as any)
        void gateway.host.toast(addedCount > 0 ? `已上传并添加 ${addedCount} 个附件` : '附件已上传，但没有新增索引卡片')
      } catch (err: any) {
        void gateway.host.toast(`上传附件失败：${String(err?.message || err || '未知错误')}`)
      }
    },
    [favoritesDoc, gateway, handleFavoritesDocChange],
  )

  // 右侧条目激活：命中当前页条目时打开详情，并把选中来源归到右侧栏。
  const activateFavoritesEntryKey = React.useCallback(
    (tabKey: string) => {
      const key = String(tabKey || '').trim()
      if (!key) return false
      const view = favoritesFolderViewRef.current
      const entry = view.entries.find(item => item.tabKey === key)
      if (!entry) return false
      if (entry.ref.kind === 'note') {
        const note = noteIndexRef.current?.notes?.[entry.ref.targetId]
        if (!note) return false
        handleOpenNote(note, undefined, 'favorites', { recordHistory: false })
        return true
      }
      if (entry.ref.kind === 'asset') {
        const asset = resolveAssetRef(view.lookup, entry.ref.targetId)
        if (!asset) return false
        handleOpenAssetTab(asset, 'favorites', { recordHistory: false })
        return true
      }
      return false
    },
    [handleOpenAssetTab, handleOpenNote],
  )

  React.useEffect(() => {
    activateFavoritesEntryKeyRef.current = activateFavoritesEntryKey
  }, [activateFavoritesEntryKey])

  return {
    handleNavigateFolder,
    handleDeleteFolderEntity,
    handleCreateFolderInFavorites,
    handleUploadAssetsIntoIndex,
    handleFavoritesSidebarNavigate,
    handleFavoritesSidebarBack,
    handleFavoritesSidebarForward,
    handleFavoritesSidebarContextMenu,
    handleFavoritesSidebarReorder,
    handleFavoritesSidebarMoveRef,
    handleWorkspaceNoteContextMenu,
    handleWorkspaceAssetContextMenu,
    handleCrossColumnDrop,
    favoritesEntityNode: favoritesEntity.node,
    workspaceTabEntityNode: workspaceTabEntity.node,
  }
}
