import * as React from 'react'
import type { DragEndEvent, DragOverEvent } from '@dnd-kit/core'
import type { SidebarItem } from './sidebarModel'
import { closeTabsInSidebar } from './sidebarModel'
import { applySortableMoveIntent, buildSortableMoveIntent, parseSortableId } from './openTabsSortableModel'

type UseOpenTabsSortableDndParams = {
  enabled: boolean
  sidebarItems: SidebarItem[]
  onCommitSidebarItems: (sidebarItems: SidebarItem[]) => void
}

export function useOpenTabsSortableDnd(params: UseOpenTabsSortableDndParams) {
  const { enabled, sidebarItems, onCommitSidebarItems } = params
  const [previewItems, setPreviewItems] = React.useState<SidebarItem[] | null>(null)
  const [activeId, setActiveId] = React.useState('')
  const [crossId, setCrossId] = React.useState('')
  const baseItemsRef = React.useRef<SidebarItem[] | null>(null)
  const previewItemsRef = React.useRef<SidebarItem[] | null>(null)
  const crossIdRef = React.useRef('')

  const updatePreviewItems = React.useCallback((next: SidebarItem[] | null) => {
    previewItemsRef.current = next
    setPreviewItems(next)
  }, [])

  const updateCrossId = React.useCallback((next: string) => {
    crossIdRef.current = next
    setCrossId(next)
  }, [])

  React.useEffect(() => {
    if (enabled) return
    baseItemsRef.current = null
    updatePreviewItems(null)
    updateCrossId('')
    setActiveId('')
  }, [enabled, updateCrossId, updatePreviewItems])

  React.useEffect(() => {
    if (!baseItemsRef.current) updatePreviewItems(null)
  }, [sidebarItems, updatePreviewItems])

  const handleMove = React.useCallback(
    (activeRawId: string, overRawId: string, _event: DragEndEvent) => {
      const base = baseItemsRef.current
      const preview = previewItemsRef.current
      const finalItems = preview || (base ? applySortableMoveIntent(base, buildSortableMoveIntent(base, activeRawId, overRawId)) : null)
      baseItemsRef.current = null
      updatePreviewItems(null)
      updateCrossId('')
      setActiveId('')
      if (!finalItems) return
      onCommitSidebarItems(finalItems)
    },
    [onCommitSidebarItems, updateCrossId, updatePreviewItems],
  )

  const handlePreviewMove = React.useCallback(
    (activeRawId: string, overRawId: string, _event: DragOverEvent) => {
      const base = baseItemsRef.current || sidebarItems
      if (!baseItemsRef.current) baseItemsRef.current = base
      // 指针回到本侧：先解除跨栏接管把条目交还本栏，再按悬停位置重建排序预览。
      if (crossIdRef.current) updateCrossId('')
      const current = previewItemsRef.current || base
      const intent = buildSortableMoveIntent(current, activeRawId, overRawId)
      const nextPreview = applySortableMoveIntent(current, intent)
      updatePreviewItems(nextPreview === base ? null : nextPreview)
    },
    [sidebarItems, updateCrossId, updatePreviewItems],
  )

  const handleDragStart = React.useCallback(
    (activeRawId: string) => {
      baseItemsRef.current = sidebarItems
      updatePreviewItems(null)
      updateCrossId('')
      setActiveId(activeRawId)
    },
    [sidebarItems, updateCrossId, updatePreviewItems],
  )

  const handleDragCancel = React.useCallback(() => {
    baseItemsRef.current = null
    updatePreviewItems(null)
    updateCrossId('')
    setActiveId('')
  }, [updateCrossId, updatePreviewItems])

  // 跨栏接管：条目进入右侧时把它从本栏移出，交给右侧以同一身份接管，保证同一身份同一时刻只属于一侧。
  // 指针回到本侧时由后续悬停自动交还并重建排序预览。
  const beginCrossTakeover = React.useCallback(() => {
    if (!baseItemsRef.current || !activeId) return
    updatePreviewItems(null)
    updateCrossId(activeId)
  }, [activeId, updateCrossId, updatePreviewItems])

  const shouldDisableItemTransform = React.useCallback((id: string) => !!activeId && activeId === id, [activeId])

  // 跨栏接管期间把被拖条目从本栏移出；其余时刻按排序预览呈现。
  const effectiveSidebarItems = React.useMemo(() => {
    if (crossId) {
      const parsed = parseSortableId(crossId)
      if (parsed?.kind === 'tab') return closeTabsInSidebar(sidebarItems, [parsed.tabKey])
    }
    return previewItems || sidebarItems
  }, [crossId, previewItems, sidebarItems])

  return React.useMemo(
    () => ({
      activeId,
      effectiveSidebarItems,
      handleMove,
      handlePreviewMove,
      handleDragStart,
      handleDragCancel,
      beginCrossTakeover,
      shouldDisableItemTransform,
    }),
    [activeId, beginCrossTakeover, effectiveSidebarItems, handleDragCancel, handleDragStart, handleMove, handlePreviewMove, shouldDisableItemTransform],
  )
}
