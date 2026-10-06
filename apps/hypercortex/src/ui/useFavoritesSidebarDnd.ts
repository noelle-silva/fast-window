import * as React from 'react'
import type { FavoriteItemRef, HyperCortexFavoritesDocV1 } from '../favorites'
import { findRefById, resolveMoveDropTargetRefId } from '../favorites'
import type { WorkspaceTransferItem } from './workspaceDnd'

/** 跨栏松手落点：默认模式给出插入下标，放入模式给出悬停收藏夹引用。 */
export type FavoritesForeignDrop = {
  moveMode: boolean
  overRefId: string
  insertIndex: number
}

type UseFavoritesSidebarDndParams = {
  refs: FavoriteItemRef[]
  currentFolderId: string
  /** 收藏夹文档：移动模式的「可放入目标」判定依据。 */
  doc?: HyperCortexFavoritesDocV1 | null
  onReorderRefs?: (folderId: string, orderedRefIds: string[]) => void
  /** 提供时启用「Ctrl 拖动 = 移动到收藏夹」的移动模式，松手把引用交给目标收藏夹。 */
  onMoveRef?: (refId: string, targetFolderId: string) => void
  /** 跨栏外来条目松手提交：按落点写入（默认插到当前收藏夹、Ctrl 放进悬停收藏夹）。 */
  onCommitForeign?: (item: WorkspaceTransferItem, target: FavoritesForeignDrop) => void
  /** 当前拖拽的活动条目标识（本栏自身条目或跨栏外来条目）。 */
  activeId: string
  /** 跨栏外来条目载荷（来自其它容器）；本栏自身拖拽时为空。 */
  foreignItem: WorkspaceTransferItem | null
  /** 拖拽期间的修饰键状态（统一来源）。 */
  modifierHeld: boolean
}

/**
 * 收藏夹条目拖拽的统一交互逻辑：一个拖拽、两种模式。
 * - 排序（默认）：实时预览重排 + 浮层跟手，拖拽项禁用 transform，松手即最终顺序，避免落位闪烁。
 * - 移动（拖动中按住 Ctrl/Cmd）：只认收藏夹条目为可放入目标，悬停即高亮；松手把引用交给底层统一迁移。
 * 拖动途中按/松 Ctrl 实时切换两个模式；模式判定以修饰键的实时状态为准。
 * 跨栏外来条目以同一身份加入本栏，成为本栏排序体系的一员，走同一套排序/移动预览与落点提交。
 */
export function useFavoritesSidebarDnd(params: UseFavoritesSidebarDndParams) {
  const { refs, currentFolderId, doc, onReorderRefs, onMoveRef, onCommitForeign, activeId, foreignItem, modifierHeld } = params

  const foreignRef = React.useMemo<FavoriteItemRef | null>(
    () =>
      foreignItem
        ? {
            id: foreignItem.id,
            folderId: currentFolderId,
            kind: foreignItem.kind,
            targetId: foreignItem.targetId,
            layout: { x: 0, y: 0, w: 2, h: 2 },
            createdAtMs: 0,
            updatedAtMs: 0,
          }
        : null,
    [currentFolderId, foreignItem],
  )
  // 本栏参与拖拽的完整引用集：接管外来条目时以同一身份追加，随预览一起参与本栏原生排序。
  const allRefs = React.useMemo(() => (foreignRef ? [...refs, foreignRef] : refs), [foreignRef, refs])

  const [dragPreviewIds, setDragPreviewIds] = React.useState<string[] | null>(null)
  const [dragOverId, setDragOverId] = React.useState('')
  const dragSuppressClickRef = React.useRef(false)
  const dragBaseIdsRef = React.useRef<string[]>([])
  const dragPreviewIdsRef = React.useRef<string[] | null>(null)
  const dragOverIdRef = React.useRef('')

  // 排序预览：把拖拽项从当前位置预演移动到悬停位置；预览与松手提交共用同一条落点计算。
  // 跨栏外来条目可能在首次事件时尚未进入 allRefs（渲染尚未跟上），故按活动标识补齐基准，保证即刻落进空位。
  const previewSortMove = React.useCallback(
    (active: string, over: string) => {
      const stored = dragBaseIdsRef.current
      const base = stored.length
        ? stored
        : (() => {
            const ids = allRefs.map(ref => ref.id)
            return ids.includes(active) ? ids : [...ids, active]
          })()
      const current = dragPreviewIdsRef.current || base
      const fromIndex = current.indexOf(active)
      const toIndex = current.indexOf(over)
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return
      const next = current.slice()
      next.splice(toIndex, 0, next.splice(fromIndex, 1)[0])
      dragPreviewIdsRef.current = next
      setDragPreviewIds(next)
    },
    [allRefs],
  )

  const clearSortPreview = React.useCallback(() => {
    if (!dragPreviewIdsRef.current) return
    dragPreviewIdsRef.current = null
    setDragPreviewIds(null)
  }, [])

  // 修饰键状态切换：按下 Ctrl 即丢弃排序预览（移动模式无排序预演），
  // 松开 Ctrl 即按当前悬停位置立即恢复排序预演，保证切回排序模式后落点不丢失。
  const previousModifierRef = React.useRef(modifierHeld)
  React.useEffect(() => {
    if (previousModifierRef.current === modifierHeld) return
    previousModifierRef.current = modifierHeld
    if (!activeId || !onMoveRef) return
    if (modifierHeld) {
      clearSortPreview()
      return
    }
    previewSortMove(activeId, dragOverIdRef.current)
  }, [activeId, clearSortPreview, modifierHeld, onMoveRef, previewSortMove])

  const moveMode = !!onMoveRef && !!activeId && modifierHeld

  const effectiveRefs = React.useMemo(() => {
    if (!dragPreviewIds) return allRefs
    const byId = new Map(allRefs.map(ref => [ref.id, ref] as const))
    const ordered = dragPreviewIds.map(id => byId.get(id)).filter((ref): ref is FavoriteItemRef => Boolean(ref))
    return ordered.length === allRefs.length ? ordered : allRefs
  }, [allRefs, dragPreviewIds])

  // 当前悬停的「可放入」收藏夹目标行：仅移动模式且悬停行可迁入时非空，供渲染层高亮。
  // 外来条目以同一身份加入本栏，落点判定与本栏条目一致。
  const dropTargetRefId = React.useMemo(() => {
    if (!moveMode || !doc) return ''
    if (foreignItem && activeId === foreignItem.id) {
      const over = findRefById(doc, dragOverId)
      return over && over.kind === 'folder' ? over.id : ''
    }
    return resolveMoveDropTargetRefId(doc, activeId, dragOverId)
  }, [doc, activeId, dragOverId, foreignItem, moveMode])

  const resetDragState = React.useCallback(() => {
    dragBaseIdsRef.current = []
    dragPreviewIdsRef.current = null
    dragOverIdRef.current = ''
    setDragPreviewIds(null)
    setDragOverId('')
  }, [])

  const handleDragStart = React.useCallback(() => {
    dragBaseIdsRef.current = allRefs.map(ref => ref.id)
    dragPreviewIdsRef.current = null
    setDragPreviewIds(null)
    dragOverIdRef.current = ''
    setDragOverId('')
  }, [allRefs])

  const handleDragOver = React.useCallback(
    (active: string, over: string) => {
      dragOverIdRef.current = over
      setDragOverId(over)
      // 以修饰键的实时状态判定模式：移动模式只记录悬停目标，不建立排序预览。
      if (onMoveRef && modifierHeld) return
      previewSortMove(active, over)
    },
    [modifierHeld, onMoveRef, previewSortMove],
  )

  const handleDragEnd = React.useCallback(
    (activeRawId?: string, overRawId?: string) => {
      dragSuppressClickRef.current = true
      window.setTimeout(() => {
        dragSuppressClickRef.current = false
      }, 0)

      const active = String(activeRawId || '').trim()
      const over = String(overRawId || '').trim()
      const next = dragPreviewIdsRef.current
      const base = dragBaseIdsRef.current
      const isForeign = !!foreignItem && active === foreignItem.id
      resetDragState()

      // 跨栏外来条目：以同一身份参与本栏排序，松手按落点写入，不参与本栏重排。
      if (isForeign && foreignItem) {
        if (onCommitForeign) {
          if (modifierHeld) {
            const target = doc ? findRefById(doc, over) : undefined
            if (target && target.kind === 'folder') {
              onCommitForeign(foreignItem, { moveMode: true, overRefId: target.id, insertIndex: -1 })
            }
          } else {
            const insertIndex = next ? next.indexOf(foreignItem.id) : allRefs.length - 1
            onCommitForeign(foreignItem, { moveMode: false, overRefId: over, insertIndex: insertIndex >= 0 ? insertIndex : allRefs.length - 1 })
          }
        }
        return
      }

      if (!active) return

      // 以修饰键的实时事实判定模式：悬停在收藏夹行即交给底层统一规则，成败由底层拦截与提示。
      if (onMoveRef && modifierHeld) {
        const target = doc ? findRefById(doc, over) : undefined
        if (target && target.kind === 'folder') onMoveRef(active, target.targetId)
        return
      }

      if (!next || !base.length) return
      if (next.length === base.length && next.every((id, index) => id === base[index])) return
      onReorderRefs?.(currentFolderId, next)
    },
    [allRefs.length, currentFolderId, doc, foreignItem, modifierHeld, onCommitForeign, onMoveRef, onReorderRefs, resetDragState],
  )

  const handleDragCancel = React.useCallback(() => {
    dragSuppressClickRef.current = false
    resetDragState()
  }, [resetDragState])

  // 本栏不再有活动条目（跨栏条目离开本栏、拖拽结束或取消）时清除拖拽残留。
  React.useEffect(() => {
    if (activeId) return
    resetDragState()
  }, [activeId, resetDragState])

  return {
    activeId,
    effectiveRefs,
    moveMode,
    dropTargetRefId,
    suppressClickRef: dragSuppressClickRef,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  }
}
