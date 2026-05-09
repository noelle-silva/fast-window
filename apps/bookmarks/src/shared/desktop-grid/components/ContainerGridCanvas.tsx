import * as React from 'react'
import { Box } from '@mui/material'
import {
  getDesktopGridCanvasHeight,
  getDesktopGridLayoutFromPixel,
  getDesktopGridPixelRect,
  resolveDesktopGridDragLayout,
  type DesktopGridLayoutMap,
  type DesktopGridLayoutSource,
} from '../core/layout'
import type {
  DesktopGridContainerApi,
  DesktopGridContainerItem,
  DesktopGridLayout,
  DesktopGridPlacement,
  DesktopGridRenderContainerItem,
} from '../core/types'
import { useMuuriDesktopGrid } from '../drag/useMuuriDesktopGrid'

type Props<TItem extends DesktopGridContainerItem> = {
  dropTargetActive?: boolean
  items: TItem[]
  onLayoutCommit(patches: DesktopGridPlacement[]): void
  onReady?(api: DesktopGridContainerApi | null): void
  renderItem: DesktopGridRenderContainerItem<TItem>
}

export function ContainerGridCanvas<TItem extends DesktopGridContainerItem>(props: Props<TItem>): React.ReactNode {
  const layoutItems = React.useMemo<DesktopGridLayoutSource[]>(() => props.items.map(item => ({ id: item.id, layout: item.layout })), [props.items])
  const itemById = React.useMemo(() => new Map(props.items.map(item => [item.id, item])), [props.items])
  const editor = useMuuriDesktopGrid({
    items: layoutItems,
    onCommit: patches => props.onLayoutCommit(patches),
  })
  const canvasHeight = getDesktopGridCanvasHeight(editor.activeLayouts.values())

  React.useLayoutEffect(() => {
    if (!props.onReady) return undefined
    if (!editor.gridNode) {
      props.onReady(null)
      return undefined
    }
    props.onReady({
      currentPlacements: () => currentPlacements(editor.activeLayouts),
      placementsForDrop: (itemId, layout) => currentPlacementsForDrop(layoutItems, editor.baseLayouts, itemId, layout, editor.columnCount),
      layoutFromClientPoint: (clientX, clientY, offsetX = 0, offsetY = 0) => {
        const rect = editor.gridNode?.getBoundingClientRect()
        if (!rect) return null
        if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null
        return getDesktopGridLayoutFromPixel(clientX - rect.left - offsetX, clientY - rect.top - offsetY, editor.columnCount)
      },
    })
    return () => props.onReady?.(null)
  }, [editor.activeLayouts, editor.baseLayouts, editor.columnCount, editor.gridNode, layoutItems, props.onReady])

  return (
    <Box
      ref={editor.setGridNode}
      sx={{
        position: 'relative',
        minHeight: Math.max(canvasHeight, 230),
        outline: props.dropTargetActive ? '2px solid rgba(37, 99, 235, 0.38)' : '0 solid transparent',
        outlineOffset: 10,
        borderRadius: 8,
        transition: 'outline-color .18s ease, outline-width .18s ease',
      }}
    >
      {props.items.map(item => {
        const layout = editor.activeLayouts.get(item.id)
        if (!layout) return null
        const rect = getDesktopGridPixelRect(layout)
        const renderedItem = itemById.get(item.id) || item
        return (
          <Box
            key={item.id}
            className={editor.muuriItemClassName}
            data-entry-key={item.id}
            sx={{
              position: 'absolute',
              width: rect.width,
              height: rect.height,
              zIndex: editor.draggingId === item.id ? 3 : 1,
              '&.muuri-item-releasing': { zIndex: 2 },
              '&.muuri-item-dragging': { zIndex: theme => theme.zIndex.modal + 2 },
            }}
          >
            {props.renderItem(renderedItem, {
              dragging: editor.draggingId === item.id,
              consumeClick: () => editor.consumeSuppressedClick(item.id),
            })}
          </Box>
        )
      })}
    </Box>
  )
}

function currentPlacements(layouts: Map<string, DesktopGridLayout>): DesktopGridPlacement[] {
  return Array.from(layouts, ([id, layout]) => ({ id, layout }))
}

function currentPlacementsForDrop(items: DesktopGridLayoutSource[], baseLayouts: DesktopGridLayoutMap, itemId: string, layout: DesktopGridLayout, columnCount: number): DesktopGridPlacement[] {
  const hasItem = items.some(item => item.id === itemId)
  const nextItems = hasItem ? items : [...items, { id: itemId }]
  const nextBaseLayouts = new Map(baseLayouts)
  if (!nextBaseLayouts.has(itemId)) nextBaseLayouts.set(itemId, layout)
  return currentPlacements(resolveDesktopGridDragLayout(nextItems, nextBaseLayouts, itemId, layout, columnCount))
}
