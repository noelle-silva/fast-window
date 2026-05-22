import * as React from 'react'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import { Box } from '@mui/material'
import type { CollectionGridLayout, CollectionItem } from '../types'
import { CollectionItemIconTile } from './CollectionItemIconTile'
import { DEFAULT_CONTAINER_ICON_LAYOUT, createFolderGridMetrics, type FolderGridMetrics } from './iconLayout'
import {
  getFolderGridCanvasHeight,
  getFolderGridLayoutFromPixel,
  getFolderGridPixelRect,
  resolveFolderGridDragLayout,
  type FolderGridLayoutMap,
  type FolderGridLayoutPatch,
  type FolderGridLayoutSource,
} from './layout'
import { useMuuriFolderGrid, type FolderGridDragEndResult, type FolderGridDragEvent } from './useMuuriFolderGrid'

type ContainerGridPlacement = { id: string; layout: CollectionGridLayout }

type Props = {
  assetUrl?(assetId: string): string
  dropTargetActive?: boolean
  items: CollectionItem[]
  onLayoutCommit(patches: ContainerGridPlacement[]): void
  onDragCancel?(event: ContainerGridDragEvent): void
  onDragEnd?(event: ContainerGridDragEvent, patches: ContainerGridPlacement[]): FolderGridDragEndResult | void
  onDragMove?(event: ContainerGridDragEvent): void
  onDragStart?(event: ContainerGridDragEvent): void
  onContextMenu(item: CollectionItem, x: number, y: number): void
  onOpenItem(item: CollectionItem): void
  onRemoveItem(item: CollectionItem): void
  onReady?(api: ContainerGridApi | null): void
}

type ContainerGridDragEvent = FolderGridDragEvent & { item: CollectionItem }

type ContainerGridApi = {
  currentPlacements(): ContainerGridPlacement[]
  placementsForDrop(itemId: string, layout: CollectionGridLayout): ContainerGridPlacement[]
  layoutFromClientPoint(clientX: number, clientY: number, offsetX?: number, offsetY?: number): CollectionGridLayout | null
}

export type { ContainerGridApi, ContainerGridDragEvent, ContainerGridPlacement }

export function ContainerGridCanvas(props: Props): React.ReactNode {
  const layoutItems = React.useMemo<FolderGridLayoutSource[]>(() => props.items.map(item => ({ id: item.id, layout: item.containerLayout })), [props.items])
  const itemById = React.useMemo(() => new Map(props.items.map(item => [item.id, item])), [props.items])
  const metrics = React.useMemo(() => createFolderGridMetrics(DEFAULT_CONTAINER_ICON_LAYOUT), [])
  const editor = useMuuriFolderGrid({
    items: layoutItems,
    metrics,
    onCommit: patches => props.onLayoutCommit(toContainerPlacements(patches)),
    onDragCancel: event => props.onDragCancel?.(toContainerDragEvent(event, itemById)),
    onDragEnd: (event, patches) => props.onDragEnd?.(toContainerDragEvent(event, itemById), toContainerPlacements(patches)),
    onDragMove: event => props.onDragMove?.(toContainerDragEvent(event, itemById)),
    onDragStart: event => props.onDragStart?.(toContainerDragEvent(event, itemById)),
  })
  const canvasHeight = getFolderGridCanvasHeight(editor.activeLayouts.values(), metrics)

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
        return getFolderGridLayoutFromPixel(clientX - rect.left - offsetX, clientY - rect.top - offsetY, editor.columnCount)
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
        const rect = getFolderGridPixelRect(layout, metrics)
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
            <ContainerGridItem
              assetUrl={props.assetUrl}
              dragging={editor.draggingId === item.id}
              item={itemById.get(item.id) || item}
              metrics={metrics}
              onContextMenu={(x, y) => props.onContextMenu(item, x, y)}
              onOpen={() => {
                if (!editor.consumeSuppressedClick(item.id)) props.onOpenItem(item)
              }}
              onRemove={() => props.onRemoveItem(item)}
            />
          </Box>
        )
      })}
    </Box>
  )
}

function ContainerGridItem(props: { assetUrl?(assetId: string): string; dragging: boolean; item: CollectionItem; metrics: FolderGridMetrics; onContextMenu(x: number, y: number): void; onOpen(): void; onRemove(): void }) {
  return (
    <CollectionItemIconTile
      action={{
        ariaLabel: `移出收纳夹：${props.item.name}`,
        icon: <LogoutRoundedIcon fontSize="small" />,
        title: '移出到桌面',
        onClick: props.onRemove,
      }}
      assetUrl={props.assetUrl}
      dragging={props.dragging}
      item={props.item}
      metrics={props.metrics}
      variant="container"
      onContextMenu={props.onContextMenu}
      onOpen={props.onOpen}
    />
  )
}

function toContainerPlacements(patches: FolderGridLayoutPatch[]): ContainerGridPlacement[] {
  return patches.map(patch => ({ id: patch.id, layout: patch.layout }))
}

function toContainerDragEvent(event: FolderGridDragEvent, itemById: Map<string, CollectionItem>): ContainerGridDragEvent {
  const item = itemById.get(event.itemId)
  if (!item) throw new Error(`container drag item not found: ${event.itemId}`)
  return { ...event, item }
}

function currentPlacements(layouts: Map<string, CollectionGridLayout>): ContainerGridPlacement[] {
  return Array.from(layouts, ([id, layout]) => ({ id, layout }))
}

function currentPlacementsForDrop(items: FolderGridLayoutSource[], baseLayouts: FolderGridLayoutMap, itemId: string, layout: CollectionGridLayout, columnCount: number): ContainerGridPlacement[] {
  const hasItem = items.some(item => item.id === itemId)
  const nextItems = hasItem ? items : [...items, { id: itemId }]
  const nextBaseLayouts = new Map(baseLayouts)
  if (!nextBaseLayouts.has(itemId)) nextBaseLayouts.set(itemId, layout)
  return currentPlacements(resolveFolderGridDragLayout(nextItems, nextBaseLayouts, itemId, layout, columnCount))
}
