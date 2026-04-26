import * as React from 'react'
import type { DragEndEvent, DragOverEvent } from '@dnd-kit/core'
import type { SidebarItem } from './sidebarModel'
import { applySortableMoveIntent, buildSortableMoveIntent } from './openTabsSortableModel'

type UseOpenTabsSortableDndParams = {
  enabled: boolean
  sidebarItems: SidebarItem[]
  onCommitSidebarItems: (sidebarItems: SidebarItem[]) => void
}

export function useOpenTabsSortableDnd(params: UseOpenTabsSortableDndParams) {
  const { enabled, sidebarItems, onCommitSidebarItems } = params
  const [previewItems, setPreviewItems] = React.useState<SidebarItem[] | null>(null)
  const [activeId, setActiveId] = React.useState('')
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
    setActiveId('')
  }, [enabled, updatePreviewItems])

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
      setActiveId('')
      if (!finalItems) return
      onCommitSidebarItems(finalItems)
    },
    [onCommitSidebarItems, updatePreviewItems],
  )

  const handlePreviewMove = React.useCallback(
    (activeRawId: string, overRawId: string, _event: DragOverEvent) => {
      const base = baseItemsRef.current || sidebarItems
      if (!baseItemsRef.current) baseItemsRef.current = base
      const current = previewItemsRef.current || base
      const intent = buildSortableMoveIntent(current, activeRawId, overRawId)
      const nextPreview = applySortableMoveIntent(current, intent)
      updatePreviewItems(nextPreview === base ? null : nextPreview)
    },
    [sidebarItems, updatePreviewItems],
  )

  const handleDragStart = React.useCallback(
    (activeRawId: string) => {
      baseItemsRef.current = sidebarItems
      updatePreviewItems(null)
      setActiveId(activeRawId)
    },
    [sidebarItems, updatePreviewItems],
  )

  const handleDragCancel = React.useCallback(() => {
    baseItemsRef.current = null
    updatePreviewItems(null)
    setActiveId('')
  }, [updatePreviewItems])

  const shouldDisableItemTransform = React.useCallback((id: string) => !!activeId && activeId === id, [activeId])

  return React.useMemo(
    () => ({
      activeId,
      effectiveSidebarItems: previewItems || sidebarItems,
      handleMove,
      handlePreviewMove,
      handleDragStart,
      handleDragCancel,
      shouldDisableItemTransform,
    }),
    [activeId, handleDragCancel, handleDragStart, handleMove, handlePreviewMove, previewItems, shouldDisableItemTransform, sidebarItems],
  )
}
