import * as React from 'react'
import type { DragStartEvent } from '@dnd-kit/core'
import type { FavoriteItemRef, HyperCortexFavoritesDocV1 } from '../favorites'
import { findRefById, resolveMoveDropTargetRefId } from '../favorites'

/** 跨栏拖拽载荷：左侧被拖入的笔记或附件，携带其原始拖拽标识以同一身份加入右侧。 */
export type FavoritesForeignPayload = {
  id: string
  kind: 'note' | 'asset'
  targetId: string
}

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
  onCommitForeign?: (payload: FavoritesForeignPayload, target: FavoritesForeignDrop) => void
}

/**
 * 收藏夹条目拖拽的统一交互逻辑：一个拖拽、两种模式。
 * - 排序（默认）：实时预览重排 + 浮层跟手，拖拽项禁用 transform，松手即最终顺序，避免落位闪烁。
 * - 移动（拖动中按住 Ctrl/Cmd）：只认收藏夹条目为可放入目标，悬停即高亮；松手把引用交给底层统一迁移。
 * 拖动途中按/松 Ctrl 实时切换两个模式；模式判定以修饰键的实时状态为准。
 * 另提供跨栏接管：左侧条目进入右侧时以同一身份加入本栏，成为本栏排序体系的一员，走同一套排序/移动预览与落点提交。
 */
export function useFavoritesSidebarDnd(params: UseFavoritesSidebarDndParams) {
  const { refs, currentFolderId, doc, onReorderRefs, onMoveRef, onCommitForeign } = params

  const [foreign, setForeign] = React.useState<FavoritesForeignPayload | null>(null)
  const foreignRef = React.useMemo<FavoriteItemRef | null>(
    () =>
      foreign
        ? {
            id: foreign.id,
            folderId: currentFolderId,
            kind: foreign.kind,
            targetId: foreign.targetId,
            layout: { x: 0, y: 0, w: 2, h: 2 },
            createdAtMs: 0,
            updatedAtMs: 0,
          }
        : null,
    [currentFolderId, foreign],
  )
  // 本栏参与拖拽的完整引用集：接管外来条目时以同一身份追加，随预览一起参与本栏原生排序。
  const allRefs = React.useMemo(() => (foreignRef ? [...refs, foreignRef] : refs), [foreignRef, refs])

  const [dragPreviewIds, setDragPreviewIds] = React.useState<string[] | null>(null)
  const [dragActiveId, setDragActiveId] = React.useState('')
  const [dragOverId, setDragOverId] = React.useState('')
  const [modifierHeld, setModifierHeld] = React.useState(false)
  const dragSuppressClickRef = React.useRef(false)
  const dragBaseIdsRef = React.useRef<string[]>([])
  const dragPreviewIdsRef = React.useRef<string[] | null>(null)
  const modifierHeldRef = React.useRef(false)
  const dragOverIdRef = React.useRef('')
  const dragActiveIdRef = React.useRef('')
  const foreignActiveRef = React.useRef(false)

  // 排序预览：把拖拽项从当前位置预演移动到悬停位置；预览与松手提交共用同一条落点计算。
  const previewSortMove = React.useCallback(
    (activeId: string, overId: string) => {
      const base = dragBaseIdsRef.current.length ? dragBaseIdsRef.current : allRefs.map(ref => ref.id)
      const current = dragPreviewIdsRef.current || base
      const fromIndex = current.indexOf(activeId)
      const toIndex = current.indexOf(overId)
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
  const applyModifierHeld = React.useCallback(
    (held: boolean) => {
      if (held === modifierHeldRef.current) return
      modifierHeldRef.current = held
      setModifierHeld(held)
      if (!onMoveRef) return
      const activeId = dragActiveIdRef.current
      if (!activeId) return
      if (held) {
        clearSortPreview()
        return
      }
      previewSortMove(activeId, dragOverIdRef.current)
    },
    [clearSortPreview, onMoveRef, previewSortMove],
  )

  // 拖拽期间监听修饰键按下与松开，两种模式即时切换。
  React.useEffect(() => {
    if (!dragActiveId) return
    const handleKey = (event: KeyboardEvent) => applyModifierHeld(!!event.ctrlKey || !!event.metaKey)
    window.addEventListener('keydown', handleKey, true)
    window.addEventListener('keyup', handleKey, true)
    return () => {
      window.removeEventListener('keydown', handleKey, true)
      window.removeEventListener('keyup', handleKey, true)
    }
  }, [applyModifierHeld, dragActiveId])

  const moveMode = !!onMoveRef && !!dragActiveId && modifierHeld

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
    if (foreign && dragActiveId === foreign.id) {
      const over = findRefById(doc, dragOverId)
      return over && over.kind === 'folder' ? over.id : ''
    }
    return resolveMoveDropTargetRefId(doc, dragActiveId, dragOverId)
  }, [doc, dragActiveId, dragOverId, foreign, moveMode])

  const resetDragState = React.useCallback(() => {
    dragBaseIdsRef.current = []
    dragPreviewIdsRef.current = null
    dragOverIdRef.current = ''
    dragActiveIdRef.current = ''
    setDragPreviewIds(null)
    setDragOverId('')
    setDragActiveId('')
  }, [])

  const handleDragStart = React.useCallback(
    (activeRawId: string, event?: DragStartEvent) => {
      const activeId = String(activeRawId || '').trim()
      if (!activeId) return
      // 以原始激活事件校准修饰键状态：拖拽开始瞬间的模式与用户按键一致（无修饰键信息的激活视为未按）。
      const activator = event?.activatorEvent
      const keyed = activator && 'ctrlKey' in activator ? (activator as KeyboardEvent | MouseEvent) : null
      const held = !!keyed && (!!keyed.ctrlKey || !!keyed.metaKey)
      modifierHeldRef.current = held
      setModifierHeld(held)
      dragBaseIdsRef.current = allRefs.map(ref => ref.id)
      dragPreviewIdsRef.current = null
      setDragPreviewIds(null)
      dragOverIdRef.current = ''
      setDragOverId('')
      dragActiveIdRef.current = activeId
      setDragActiveId(activeId)
    },
    [allRefs],
  )

  const handleDragOver = React.useCallback(
    (activeId: string, overId: string) => {
      dragOverIdRef.current = overId
      setDragOverId(overId)
      // 以修饰键的实时状态判定模式：移动模式只记录悬停目标，不建立排序预览。
      if (onMoveRef && modifierHeldRef.current) return
      previewSortMove(activeId, overId)
    },
    [onMoveRef, previewSortMove],
  )

  const handleDragEnd = React.useCallback(
    (activeRawId?: string, overRawId?: string) => {
      dragSuppressClickRef.current = true
      window.setTimeout(() => {
        dragSuppressClickRef.current = false
      }, 0)

      const activeId = String(activeRawId || '').trim()
      const overId = String(overRawId || '').trim()
      const next = dragPreviewIdsRef.current
      const base = dragBaseIdsRef.current
      const wasForeign = foreignActiveRef.current
      resetDragState()

      // 跨栏外来条目：以同一身份参与本栏排序，松手按落点写入，不参与本栏重排。
      if (wasForeign || (foreign && activeId === foreign.id)) {
        if (onCommitForeign && foreign) {
          if (modifierHeldRef.current) {
            const over = doc ? findRefById(doc, overId) : undefined
            if (over && over.kind === 'folder') {
              onCommitForeign(foreign, { moveMode: true, overRefId: over.id, insertIndex: -1 })
            }
          } else {
            const insertIndex = next ? next.indexOf(foreign.id) : allRefs.length - 1
            onCommitForeign(foreign, { moveMode: false, overRefId: overId, insertIndex: insertIndex >= 0 ? insertIndex : allRefs.length - 1 })
          }
        }
        foreignActiveRef.current = false
        setForeign(null)
        return
      }

      if (!activeId) return

      // 以修饰键的实时事实判定模式：悬停在收藏夹行即交给底层统一规则，成败由底层拦截与提示。
      if (onMoveRef && modifierHeldRef.current) {
        const target = doc ? findRefById(doc, overId) : undefined
        if (target && target.kind === 'folder') onMoveRef(activeId, target.targetId)
        return
      }

      if (!next || !base.length) return
      if (next.length === base.length && next.every((id, index) => id === base[index])) return
      onReorderRefs?.(currentFolderId, next)
    },
    [allRefs.length, currentFolderId, doc, foreign, onCommitForeign, onMoveRef, onReorderRefs, resetDragState],
  )

  const handleDragCancel = React.useCallback(() => {
    dragSuppressClickRef.current = false
    foreignActiveRef.current = false
    setForeign(null)
    resetDragState()
  }, [resetDragState])

  // 跨栏接管：左侧条目进入右侧时登记外来载荷，并以同一身份参与本栏原生排序预览。
  // 已在接管中时直接返回，避免每次落点变化都重复写状态。
  const beginForeign = React.useCallback(
    (payload: FavoritesForeignPayload, modifierHeldAtStart: boolean) => {
      if (foreignActiveRef.current) return
      modifierHeldRef.current = modifierHeldAtStart
      setModifierHeld(modifierHeldAtStart)
      foreignActiveRef.current = true
      setForeign(payload)
      dragBaseIdsRef.current = [...refs.map(ref => ref.id), payload.id]
      dragPreviewIdsRef.current = null
      setDragPreviewIds(null)
      dragOverIdRef.current = ''
      setDragOverId('')
      dragActiveIdRef.current = payload.id
      setDragActiveId(payload.id)
    },
    [refs],
  )

  const endForeign = React.useCallback(() => {
    if (!foreignActiveRef.current) return
    foreignActiveRef.current = false
    setForeign(null)
    resetDragState()
  }, [resetDragState])

  return {
    activeId: dragActiveId,
    effectiveRefs,
    moveMode,
    dropTargetRefId,
    suppressClickRef: dragSuppressClickRef,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
    beginForeign,
    endForeign,
  }
}
