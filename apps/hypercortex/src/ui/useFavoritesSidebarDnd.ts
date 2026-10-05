import * as React from 'react'
import type { DragStartEvent } from '@dnd-kit/core'
import type { FavoriteItemRef, HyperCortexFavoritesDocV1 } from '../favorites'
import { findRefById, resolveMoveDropTargetRefId } from '../favorites'

type UseFavoritesSidebarDndParams = {
  refs: FavoriteItemRef[]
  currentFolderId: string
  /** 收藏夹文档：移动模式的「可放入目标」判定依据。 */
  doc?: HyperCortexFavoritesDocV1 | null
  onReorderRefs?: (folderId: string, orderedRefIds: string[]) => void
  /** 提供时启用「Ctrl 拖动 = 移动到收藏夹」的移动模式，松手把引用交给目标收藏夹。 */
  onMoveRef?: (refId: string, targetFolderId: string) => void
}

/**
 * 收藏夹条目拖拽的统一交互逻辑：一个拖拽、两种模式。
 * - 排序（默认）：实时预览重排 + 浮层跟手，拖拽项禁用 transform，松手即最终顺序，避免落位闪烁。
 * - 移动（拖动中按住 Ctrl/Cmd）：只认收藏夹条目为可放入目标，悬停即高亮；松手把引用交给底层统一迁移。
 * 拖动途中按/松 Ctrl 实时切换两个模式：切换瞬间同步维护排序预览（松开即按当前悬停位置恢复预演），
 * 不依赖后续悬停变化；模式判定以修饰键的实时状态为准，与渲染时序解耦。
 * 未提供 onMoveRef 的一方（如排序专用调用）行为与原来完全一致。
 */
export function useFavoritesSidebarDnd(params: UseFavoritesSidebarDndParams) {
  const { refs, currentFolderId, doc, onReorderRefs, onMoveRef } = params

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

  // 排序预览：把拖拽项从当前位置预演移动到悬停位置；预览与松手提交共用同一条落点计算。
  const previewSortMove = React.useCallback(
    (activeId: string, overId: string) => {
      const base = dragBaseIdsRef.current.length ? dragBaseIdsRef.current : refs.map(ref => ref.id)
      const current = dragPreviewIdsRef.current || base
      const fromIndex = current.indexOf(activeId)
      const toIndex = current.indexOf(overId)
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return
      const next = current.slice()
      next.splice(toIndex, 0, next.splice(fromIndex, 1)[0])
      dragPreviewIdsRef.current = next
      setDragPreviewIds(next)
    },
    [refs],
  )

  const clearSortPreview = React.useCallback(() => {
    if (!dragPreviewIdsRef.current) return
    dragPreviewIdsRef.current = null
    setDragPreviewIds(null)
  }, [])

  // 修饰键状态切换：按下 Ctrl 即丢弃排序预览（移动模式无排序预演），
  // 松开 Ctrl 即按当前悬停位置立即恢复排序预演，保证切回排序模式后落点不丢失。
  // 以拖拽活动 ref 判定时机，拖拽结束瞬间的按键事件不会残留预演。
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
    if (!dragPreviewIds) return refs
    const byId = new Map(refs.map(ref => [ref.id, ref] as const))
    const ordered = dragPreviewIds.map(id => byId.get(id)).filter((ref): ref is FavoriteItemRef => Boolean(ref))
    return ordered.length === refs.length ? ordered : refs
  }, [dragPreviewIds, refs])

  // 当前悬停的「可放入」收藏夹目标行：仅移动模式且悬停行可迁入时非空，供渲染层高亮。
  const dropTargetRefId = React.useMemo(
    () => (moveMode && doc ? resolveMoveDropTargetRefId(doc, dragActiveId, dragOverId) : ''),
    [doc, dragActiveId, dragOverId, moveMode],
  )

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
      dragBaseIdsRef.current = refs.map(ref => ref.id)
      dragPreviewIdsRef.current = null
      setDragPreviewIds(null)
      dragOverIdRef.current = ''
      setDragOverId('')
      dragActiveIdRef.current = activeId
      setDragActiveId(activeId)
    },
    [refs],
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
      dragBaseIdsRef.current = []
      dragPreviewIdsRef.current = null
      dragOverIdRef.current = ''
      dragActiveIdRef.current = ''
      setDragPreviewIds(null)
      setDragOverId('')
      setDragActiveId('')
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
    [currentFolderId, doc, onMoveRef, onReorderRefs],
  )

  const handleDragCancel = React.useCallback(() => {
    dragSuppressClickRef.current = false
    dragBaseIdsRef.current = []
    dragPreviewIdsRef.current = null
    dragOverIdRef.current = ''
    dragActiveIdRef.current = ''
    setDragPreviewIds(null)
    setDragOverId('')
    setDragActiveId('')
  }, [])

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
  }
}
