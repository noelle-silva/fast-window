import * as React from 'react'
import type { SidebarItem } from './sidebarModel'
import { closeTabsInSidebar } from './sidebarModel'
import { applySortableMoveIntent, buildSortableMoveIntent, parseSortableId } from './openTabsSortableModel'

type UseOpenTabsSortableDndParams = {
  enabled: boolean
  sidebarItems: SidebarItem[]
  onCommitSidebarItems: (sidebarItems: SidebarItem[]) => void
  /** 当前拖拽的活动条目标识（仅本侧为拖拽来源时非空）。 */
  activeId: string
  /** 已跨栏到右侧、当前不在本栏的条目标识：从本栏渲染中移出。 */
  crossedActiveId: string
}

export function useOpenTabsSortableDnd(params: UseOpenTabsSortableDndParams) {
  const { enabled, sidebarItems, onCommitSidebarItems, activeId, crossedActiveId } = params
  const [previewItems, setPreviewItems] = React.useState<SidebarItem[] | null>(null)
  const baseItemsRef = React.useRef<SidebarItem[] | null>(null)
  const previewItemsRef = React.useRef<SidebarItem[] | null>(null)

  const updatePreviewItems = React.useCallback((next: SidebarItem[] | null) => {
    previewItemsRef.current = next
    setPreviewItems(next)
  }, [])

  React.useEffect(() => {
    if (enabled) return
    baseItemsRef.current = null
    updatePreviewItems(null)
  }, [enabled, updatePreviewItems])

  React.useEffect(() => {
    if (!baseItemsRef.current) updatePreviewItems(null)
  }, [sidebarItems, updatePreviewItems])

  // 条目跨栏离开本栏时丢弃排序预演，回到本栏后由后续悬停按基准重建。
  React.useEffect(() => {
    if (!crossedActiveId) return
    updatePreviewItems(null)
  }, [crossedActiveId, updatePreviewItems])

  const handleMove = React.useCallback(
    (activeRawId: string, overRawId: string) => {
      const base = baseItemsRef.current
      const preview = previewItemsRef.current
      const finalItems = preview || (base ? applySortableMoveIntent(base, buildSortableMoveIntent(base, activeRawId, overRawId)) : null)
      baseItemsRef.current = null
      updatePreviewItems(null)
      if (!finalItems) return
      onCommitSidebarItems(finalItems)
    },
    [onCommitSidebarItems, updatePreviewItems],
  )

  const handlePreviewMove = React.useCallback(
    (activeRawId: string, overRawId: string) => {
      const base = baseItemsRef.current || sidebarItems
      if (!baseItemsRef.current) baseItemsRef.current = base
      const current = previewItemsRef.current || base
      const intent = buildSortableMoveIntent(current, activeRawId, overRawId)
      const nextPreview = applySortableMoveIntent(current, intent)
      updatePreviewItems(nextPreview === base ? null : nextPreview)
    },
    [sidebarItems, updatePreviewItems],
  )

  const handleDragStart = React.useCallback(() => {
    baseItemsRef.current = sidebarItems
    updatePreviewItems(null)
  }, [sidebarItems, updatePreviewItems])

  const handleDragCancel = React.useCallback(() => {
    baseItemsRef.current = null
    updatePreviewItems(null)
  }, [updatePreviewItems])

  const shouldDisableItemTransform = React.useCallback((id: string) => !!activeId && activeId === id, [activeId])

  // 跨栏期间把被拖条目从本栏移出（同一身份同一时刻只属于一侧）；其余时刻按排序预览呈现。
  const effectiveSidebarItems = React.useMemo(() => {
    if (crossedActiveId) {
      const parsed = parseSortableId(crossedActiveId)
      if (parsed?.kind === 'tab') return closeTabsInSidebar(sidebarItems, [parsed.tabKey])
    }
    return previewItems || sidebarItems
  }, [crossedActiveId, previewItems, sidebarItems])

  return React.useMemo(
    () => ({
      effectiveSidebarItems,
      handleMove,
      handlePreviewMove,
      handleDragStart,
      handleDragCancel,
      shouldDisableItemTransform,
    }),
    [effectiveSidebarItems, handleDragCancel, handleDragStart, handleMove, handlePreviewMove, shouldDisableItemTransform],
  )
}
