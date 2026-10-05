import * as React from 'react'
import type { FavoriteItemRef } from '../favorites'

type UseFavoritesSidebarDndParams = {
  refs: FavoriteItemRef[]
  currentFolderId: string
  onReorderRefs?: (folderId: string, orderedRefIds: string[]) => void
}

/** 收藏夹条目拖拽排序的交互逻辑：实时预览重排 + 松手提交，与左侧标签栏同源。 */
export function useFavoritesSidebarDnd(params: UseFavoritesSidebarDndParams) {
  const { refs, currentFolderId, onReorderRefs } = params

  // 条目拖拽排序：实时预览重排 + 浮层跟手，拖拽项禁用 transform，松手即最终顺序，避免落位闪烁。
  const dragSuppressClickRef = React.useRef(false)
  const [dragPreviewIds, setDragPreviewIds] = React.useState<string[] | null>(null)
  const [dragActiveId, setDragActiveId] = React.useState('')
  const dragBaseIdsRef = React.useRef<string[]>([])
  const dragPreviewIdsRef = React.useRef<string[] | null>(null)

  const effectiveRefs = React.useMemo(() => {
    if (!dragPreviewIds) return refs
    const byId = new Map(refs.map(ref => [ref.id, ref] as const))
    const ordered = dragPreviewIds.map(id => byId.get(id)).filter((ref): ref is FavoriteItemRef => Boolean(ref))
    return ordered.length === refs.length ? ordered : refs
  }, [dragPreviewIds, refs])

  const handleDragStart = React.useCallback(
    (activeId: string) => {
      dragBaseIdsRef.current = refs.map(ref => ref.id)
      dragPreviewIdsRef.current = null
      setDragPreviewIds(null)
      setDragActiveId(activeId)
    },
    [refs],
  )

  const handleDragOver = React.useCallback(
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

  const handleDragEnd = React.useCallback(() => {
    dragSuppressClickRef.current = true
    window.setTimeout(() => {
      dragSuppressClickRef.current = false
    }, 0)
    const next = dragPreviewIdsRef.current
    const base = dragBaseIdsRef.current
    dragBaseIdsRef.current = []
    dragPreviewIdsRef.current = null
    setDragPreviewIds(null)
    setDragActiveId('')
    if (!next || !base.length) return
    if (next.length === base.length && next.every((id, index) => id === base[index])) return
    onReorderRefs?.(currentFolderId, next)
  }, [currentFolderId, onReorderRefs])

  const handleDragCancel = React.useCallback(() => {
    dragSuppressClickRef.current = false
    dragBaseIdsRef.current = []
    dragPreviewIdsRef.current = null
    setDragPreviewIds(null)
    setDragActiveId('')
  }, [])

  return {
    activeId: dragActiveId,
    effectiveRefs,
    suppressClickRef: dragSuppressClickRef,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  }
}
