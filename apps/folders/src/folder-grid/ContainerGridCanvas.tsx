import * as React from 'react'
import RemoveCircleOutlineRoundedIcon from '@mui/icons-material/RemoveCircleOutlineRounded'
import { Box, ButtonBase, IconButton, Stack, Typography } from '@mui/material'
import type { FolderGridLayout, FolderItem } from '../types'
import { DesktopIconVisual } from './DesktopIconVisual'
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

type ContainerGridPlacement = { id: string; layout: FolderGridLayout }

type Props = {
  assetUrl?(assetId: string): string
  dropTargetActive?: boolean
  items: FolderItem[]
  onLayoutCommit(patches: ContainerGridPlacement[]): void
  onDragCancel?(event: ContainerGridDragEvent): void
  onDragEnd?(event: ContainerGridDragEvent, patches: ContainerGridPlacement[]): FolderGridDragEndResult | void
  onDragMove?(event: ContainerGridDragEvent): void
  onDragStart?(event: ContainerGridDragEvent): void
  onOpenFolder(item: FolderItem): void
  onRemoveItem(item: FolderItem): void
  onReady?(api: ContainerGridApi | null): void
}

type ContainerGridDragEvent = FolderGridDragEvent & { item: FolderItem }

type ContainerGridApi = {
  currentPlacements(): ContainerGridPlacement[]
  placementsForDrop(itemId: string, layout: FolderGridLayout): ContainerGridPlacement[]
  layoutFromClientPoint(clientX: number, clientY: number, offsetX?: number, offsetY?: number): FolderGridLayout | null
}

export type { ContainerGridApi, ContainerGridDragEvent, ContainerGridPlacement }

export function ContainerGridCanvas(props: Props): React.ReactNode {
  const layoutItems = React.useMemo<FolderGridLayoutSource[]>(() => props.items.map(item => ({ id: item.id, layout: item.containerLayout })), [props.items])
  const itemById = React.useMemo(() => new Map(props.items.map(item => [item.id, item])), [props.items])
  const editor = useMuuriFolderGrid({
    items: layoutItems,
    onCommit: patches => props.onLayoutCommit(toContainerPlacements(patches)),
    onDragCancel: event => props.onDragCancel?.(toContainerDragEvent(event, itemById)),
    onDragEnd: (event, patches) => props.onDragEnd?.(toContainerDragEvent(event, itemById), toContainerPlacements(patches)),
    onDragMove: event => props.onDragMove?.(toContainerDragEvent(event, itemById)),
    onDragStart: event => props.onDragStart?.(toContainerDragEvent(event, itemById)),
  })
  const canvasHeight = getFolderGridCanvasHeight(editor.activeLayouts.values())

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
        const rect = getFolderGridPixelRect(layout)
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
              onOpen={() => {
                if (!editor.consumeSuppressedClick(item.id)) props.onOpenFolder(item)
              }}
              onRemove={() => props.onRemoveItem(item)}
            />
          </Box>
        )
      })}
    </Box>
  )
}

function ContainerGridItem(props: { assetUrl?(assetId: string): string; dragging: boolean; item: FolderItem; onOpen(): void; onRemove(): void }) {
  return (
    <Box
      sx={{
        position: 'relative',
        width: 148,
        height: 164,
        display: 'grid',
        justifyItems: 'center',
        alignContent: 'start',
        pt: 0.5,
        gap: 1,
        cursor: props.dragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        touchAction: 'none',
        transform: props.dragging ? 'scale(1.05)' : 'scale(1)',
        transition: props.dragging ? 'none' : 'transform .16s ease',
        '&:hover .container-folder-remove, &:focus-within .container-folder-remove': { opacity: 1, transform: 'translateY(0) scale(1)' },
      }}
    >
      <ButtonBase
        disableRipple
        onClick={props.onOpen}
        aria-label={`打开：${props.item.name}`}
        sx={{
          width: 132,
          display: 'grid',
          justifyItems: 'center',
          gap: 1,
          p: 0.5,
          borderRadius: 5,
          textAlign: 'center',
          '&:focus-visible': { outline: '2px solid rgba(37, 99, 235, 0.75)', outlineOffset: 4 },
        }}
      >
        <DesktopIconVisual
          assetUrl={props.assetUrl}
          icon={props.item.icon}
          seed={`folder:${props.item.id}:${props.item.name}`}
          size={86}
          radius={24}
        />
        <Stack spacing={0.25} sx={{ minWidth: 0, width: '100%' }}>
          <Typography noWrap fontWeight={850} title={props.item.name} sx={{ color: 'text.primary', fontSize: 15 }}>
            {props.item.name}
          </Typography>
          <Typography noWrap title={props.item.path} variant="caption" sx={{ display: 'block', color: 'rgba(15, 23, 42, 0.45)' }}>
            {props.item.path}
          </Typography>
        </Stack>
      </ButtonBase>
      <IconButton
        className="container-folder-remove"
        data-folder-grid-no-drag="1"
        aria-label={`移出收纳夹：${props.item.name}`}
        onClick={props.onRemove}
        size="small"
        sx={{
          position: 'absolute',
          top: -4,
          right: 18,
          opacity: { xs: 1, sm: 0 },
          transform: { xs: 'translateY(0) scale(1)', sm: 'translateY(-4px) scale(0.92)' },
          transition: 'opacity .16s ease, transform .16s ease, background-color .16s ease',
          bgcolor: 'rgba(255, 255, 255, 0.92)',
          boxShadow: '0 10px 22px rgba(15, 23, 42, 0.16)',
          '&:hover': { bgcolor: '#FFFFFF', color: 'error.main' },
        }}
      >
        <RemoveCircleOutlineRoundedIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}

function toContainerPlacements(patches: FolderGridLayoutPatch[]): ContainerGridPlacement[] {
  return patches.map(patch => ({ id: patch.id, layout: patch.layout }))
}

function toContainerDragEvent(event: FolderGridDragEvent, itemById: Map<string, FolderItem>): ContainerGridDragEvent {
  const item = itemById.get(event.itemId)
  if (!item) throw new Error(`container drag item not found: ${event.itemId}`)
  return { ...event, item }
}

function currentPlacements(layouts: Map<string, FolderGridLayout>): ContainerGridPlacement[] {
  return Array.from(layouts, ([id, layout]) => ({ id, layout }))
}

function currentPlacementsForDrop(items: FolderGridLayoutSource[], baseLayouts: FolderGridLayoutMap, itemId: string, layout: FolderGridLayout, columnCount: number): ContainerGridPlacement[] {
  const hasItem = items.some(item => item.id === itemId)
  const nextItems = hasItem ? items : [...items, { id: itemId }]
  const nextBaseLayouts = new Map(baseLayouts)
  if (!nextBaseLayouts.has(itemId)) nextBaseLayouts.set(itemId, layout)
  return currentPlacements(resolveFolderGridDragLayout(nextItems, nextBaseLayouts, itemId, layout, columnCount))
}
