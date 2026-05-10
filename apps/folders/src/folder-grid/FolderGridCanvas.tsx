import * as React from 'react'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import { Box, Button, Paper, Stack, Typography, alpha } from '@mui/material'
import type { CategoryDefinition } from '../categoryRegistry'
import type { CategoryWorkspace, CollectionContainer, ContextMenuState, DesktopGridEntry, DesktopIconLayout, Phase } from '../types'
import type { DesktopDragState } from '../desktopDragState'
import { DesktopGridIcon } from './DesktopGridIcon'
import { ScrollArea } from '../shared/scroll-area'
import { desktopEntryKey, type DesktopGridLayoutPatch } from './desktopEntries'
import {
  projectExternalItemDrag,
  toDesktopDragEvent,
  toDesktopGridLayoutPatch,
  type DesktopGridDragEvent,
  type DesktopGridExternalDragProjection,
  type DesktopGridExternalItemDrag,
  type DesktopGridHoverTarget,
} from './desktopDragProjection'
import { createFolderGridMetrics, type FolderGridMetrics } from './iconLayout'
import { getFolderGridCanvasHeight, getFolderGridPixelRect, type FolderGridLayoutMap, type FolderGridLayoutSource } from './layout'
import { useMuuriFolderGrid, type FolderGridDragEndResult, type FolderGridDragEvent } from './useMuuriFolderGrid'

type Props = {
  category: CategoryDefinition
  workspace: CategoryWorkspace
  entries: DesktopGridEntry[]
  allEntries: DesktopGridEntry[]
  iconLayout: DesktopIconLayout
  phase: Phase
  search: string
  assetUrl?(assetId: string): string
  onAdd(): void
  onOpen(entry: DesktopGridEntry): void
  onContextMenu(menu: ContextMenuState): void
  onLayoutCommit(patches: DesktopGridLayoutPatch[]): void
  onDragCancel?(event: DesktopGridDragEvent): void
  onDragEnd?(event: DesktopGridDragEvent, patches: DesktopGridLayoutPatch[]): FolderGridDragEndResult | void
  onDragMove?(event: DesktopGridDragEvent): void
  onDragStart?(event: DesktopGridDragEvent): void
  onReady?(api: DesktopGridApi | null): void
  externalDragPreview?: DesktopGridExternalItemDrag | null
  externalDragState?: DesktopDragState
  openContainer?: CollectionContainer | null
}

export type { DesktopGridLayoutPatch }
export type { DesktopGridDragEvent, DesktopGridExternalDragProjection, DesktopGridExternalItemDrag, DesktopGridHoverTarget }
export type DesktopGridApi = {
  projectExternalItemDrag(drag: DesktopGridExternalItemDrag, currentDrag: DesktopDragState, openContainer: CollectionContainer | null): DesktopGridExternalDragProjection | null
}

export function FolderGridCanvas(props: Props): React.ReactNode {
  const layoutItems = React.useMemo<FolderGridLayoutSource[]>(() => props.allEntries.map(entry => ({ id: desktopEntryKey(entry.kind, entry.id), layout: entry.layout })), [props.allEntries])
  const renderedItemIds = React.useMemo(() => props.entries.map(entry => desktopEntryKey(entry.kind, entry.id)), [props.entries])
  const visibleEntryByKey = React.useMemo(() => new Map(props.entries.map(entry => [desktopEntryKey(entry.kind, entry.id), entry])), [props.entries])
  const entryByKey = React.useMemo(() => new Map(props.allEntries.map(entry => [desktopEntryKey(entry.kind, entry.id), entry])), [props.allEntries])
  const gridNodeRef = React.useRef<HTMLDivElement | null>(null)
  const hoverLayoutsRef = React.useRef<FolderGridLayoutMap>(new Map())
  const metrics = React.useMemo(() => createFolderGridMetrics(props.iconLayout), [props.iconLayout])

  const editor = useMuuriFolderGrid({
    enableOverlayDrag: true,
    items: layoutItems,
    metrics,
    renderedItemIds,
    onCommit: patches => props.onLayoutCommit(patches.map(toDesktopGridLayoutPatch).filter((patch): patch is DesktopGridLayoutPatch => Boolean(patch))),
    onDragCancel: event => props.onDragCancel?.(toDesktopDragEvent(event, entryByKey, visibleEntryByKey, gridNodeRef.current?.getBoundingClientRect() || null, hoverLayoutsRef.current, metrics)),
    onDragEnd: (event, patches) => props.onDragEnd?.(
      toDesktopDragEvent(event, entryByKey, visibleEntryByKey, gridNodeRef.current?.getBoundingClientRect() || null, hoverLayoutsRef.current, metrics),
      patches.map(toDesktopGridLayoutPatch).filter((patch): patch is DesktopGridLayoutPatch => Boolean(patch)),
    ),
    onDragMove: event => props.onDragMove?.(toDesktopDragEvent(event, entryByKey, visibleEntryByKey, gridNodeRef.current?.getBoundingClientRect() || null, hoverLayoutsRef.current, metrics)),
    onDragStart: event => props.onDragStart?.(toDesktopDragEvent(event, entryByKey, visibleEntryByKey, gridNodeRef.current?.getBoundingClientRect() || null, hoverLayoutsRef.current, metrics)),
  })
  gridNodeRef.current = editor.gridNode
  hoverLayoutsRef.current = editor.baseLayouts
  const externalDragProjection = React.useMemo(() => {
    if (!props.externalDragPreview || !editor.gridNode) return null
    const gridRect = editor.gridNode.getBoundingClientRect()
    const boundsRect = editor.gridNode.parentElement?.getBoundingClientRect() || gridRect
    return projectExternalItemDrag(props.externalDragPreview, props.externalDragState || null, props.openContainer || null, layoutItems, editor.baseLayouts, editor.columnCount, gridRect, boundsRect, entryByKey, visibleEntryByKey, metrics)
  }, [editor.baseLayouts, editor.columnCount, editor.gridNode, entryByKey, layoutItems, metrics, props.externalDragPreview, props.externalDragState, props.openContainer, visibleEntryByKey])
  const displayLayouts = editor.activeLayouts
  const setProjectedLayouts = editor.setProjectedLayouts

  React.useLayoutEffect(() => {
    setProjectedLayouts(externalDragProjection?.layouts || null)
  }, [externalDragProjection?.layouts, setProjectedLayouts])

  React.useLayoutEffect(() => {
    if (!props.onReady) return undefined
    const gridNode = editor.gridNode
    if (!gridNode) {
      props.onReady(null)
      return undefined
    }
    props.onReady({
      projectExternalItemDrag: (drag, currentDrag, openContainer) => {
        const gridRect = gridNode.getBoundingClientRect()
        const boundsRect = gridNode.parentElement?.getBoundingClientRect() || gridRect
        return projectExternalItemDrag(drag, currentDrag, openContainer, layoutItems, editor.baseLayouts, editor.columnCount, gridRect, boundsRect, entryByKey, visibleEntryByKey, metrics)
      },
    })
    return () => props.onReady?.(null)
  }, [editor.baseLayouts, editor.columnCount, editor.gridNode, entryByKey, layoutItems, metrics, props.onReady, visibleEntryByKey])

  if (!props.entries.length && !props.externalDragPreview) {
    return (
      <ScrollArea sx={{ flex: 1, minHeight: 0 }} viewportSx={{ p: { xs: 1.5, sm: 2 }, pt: 1 }}>
        <EmptyState category={props.category} phase={props.phase} search={props.search} onAdd={props.onAdd} />
      </ScrollArea>
    )
  }

  const canvasHeight = getFolderGridCanvasHeight(displayLayouts.values(), metrics)

  return (
    <ScrollArea
      component="section"
      ariaLabel={`${props.category.label}收藏图标布局`}
      sx={{ flex: 1, minHeight: 0 }}
      viewportSx={{ px: { xs: 1, sm: 1.5 }, pb: { xs: 1.5, sm: 2 }, pt: 1 }}
    >
      <Box
        ref={editor.setGridNode}
        sx={{
          position: 'relative',
          minHeight: canvasHeight,
        }}
      >
        {props.entries.map(entry => {
          const key = desktopEntryKey(entry.kind, entry.id)
          const layout = displayLayouts.get(key)
          if (!layout) return null
          const rect = getFolderGridPixelRect(layout, metrics)
          return (
            <Box
              key={key}
              className={editor.muuriItemClassName}
              data-entry-key={key}
              sx={{
                position: 'absolute',
                display: 'block',
                width: rect.width,
                height: rect.height,
                minWidth: 0,
                minHeight: 0,
                boxSizing: 'border-box',
                zIndex: editor.draggingId === key ? 3 : 1,
                '&.muuri-item-releasing': { zIndex: 2 },
                '&.muuri-item-dragging': { zIndex: theme => theme.zIndex.modal + 2 },
                '&.muuri-item-hidden': { zIndex: 0 },
              }}
            >
              <DesktopGridIcon
                assetUrl={props.assetUrl}
                dragging={editor.draggingId === key}
                entry={entry}
                metrics={metrics}
                workspace={props.workspace}
                onOpen={() => {
                  if (!editor.consumeSuppressedClick(key)) props.onOpen(entry)
                }}
                onContextMenu={(x, y) => props.onContextMenu({ entry: visibleEntryByKey.get(key) || entry, x, y })}
              />
            </Box>
          )
        })}
      </Box>
    </ScrollArea>
  )
}

function EmptyState(props: { category: CategoryDefinition; phase: Phase; search: string; onAdd(): void }) {
  const EmptyIcon = props.category.icon
  return (
    <Paper elevation={0} sx={{ minHeight: '100%', p: { xs: 3, sm: 5 }, borderRadius: 4, display: 'grid', placeItems: 'center', textAlign: 'center', bgcolor: 'transparent', boxShadow: 'none' }}>
      <Stack spacing={1.5} alignItems="center" sx={{ maxWidth: 420 }}>
        <Box sx={{ width: 72, height: 72, borderRadius: 4, display: 'grid', placeItems: 'center', color: 'primary.main', bgcolor: theme => alpha(theme.palette.primary.main, 0.1) }}>
          <EmptyIcon fontSize="large" />
        </Box>
        <Typography variant="h2">{props.search ? `未找到匹配的${props.category.label}` : props.category.emptyTitle}</Typography>
        <Typography color="text.secondary">{props.search ? '换个关键词试试，或者添加新的收藏项目。' : props.category.emptyDescription}</Typography>
        <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={props.onAdd} disabled={props.phase !== 'ready'}>{props.category.addLabel}</Button>
      </Stack>
    </Paper>
  )
}
