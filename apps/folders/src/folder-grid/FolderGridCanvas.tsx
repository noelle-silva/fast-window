import * as React from 'react'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DriveFolderUploadRoundedIcon from '@mui/icons-material/DriveFolderUploadRounded'
import { Box, Button, Paper, Stack, Typography, alpha } from '@mui/material'
import type { ContextMenuState, DesktopContainer, DesktopGridEntry, DesktopIconLayout, FolderGridLayout, FolderItem, FoldersDoc, Phase } from '../types'
import type { DesktopDragState } from '../desktopDragState'
import { DesktopGridIcon } from './DesktopGridIcon'
import { ScrollArea } from '../shared/scroll-area'
import { desktopEntryKey, type DesktopGridLayoutPatch } from './desktopEntries'
import {
  projectExternalFolderDrag,
  toDesktopDragEvent,
  toDesktopGridLayoutPatch,
  type DesktopGridDragEvent,
  type DesktopGridExternalDragProjection,
  type DesktopGridExternalFolderDrag,
  type DesktopGridHoverTarget,
} from './desktopDragProjection'
import { createFolderGridMetrics, type FolderGridMetrics } from './iconLayout'
import { getFolderGridCanvasHeight, getFolderGridPixelRect, type FolderGridLayoutMap, type FolderGridLayoutSource } from './layout'
import { useMuuriFolderGrid, type FolderGridDragEndResult, type FolderGridDragEvent } from './useMuuriFolderGrid'

type Props = {
  doc: FoldersDoc
  entries: DesktopGridEntry[]
  allEntries: DesktopGridEntry[]
  groupCount: number
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
  externalDragPreview?: DesktopGridExternalFolderDrag | null
  externalDragState?: DesktopDragState
  openContainer?: DesktopContainer | null
}

export type { DesktopGridLayoutPatch }
export type { DesktopGridDragEvent, DesktopGridExternalDragProjection, DesktopGridExternalFolderDrag, DesktopGridHoverTarget }
export type DesktopGridApi = {
  projectExternalFolderDrag(drag: DesktopGridExternalFolderDrag, currentDrag: DesktopDragState, openContainer: DesktopContainer | null): DesktopGridExternalDragProjection | null
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
    return projectExternalFolderDrag(props.externalDragPreview, props.externalDragState || null, props.openContainer || null, layoutItems, editor.baseLayouts, editor.columnCount, gridRect, boundsRect, entryByKey, visibleEntryByKey, metrics)
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
      projectExternalFolderDrag: (drag, currentDrag, openContainer) => {
        const gridRect = gridNode.getBoundingClientRect()
        const boundsRect = gridNode.parentElement?.getBoundingClientRect() || gridRect
        return projectExternalFolderDrag(drag, currentDrag, openContainer, layoutItems, editor.baseLayouts, editor.columnCount, gridRect, boundsRect, entryByKey, visibleEntryByKey, metrics)
      },
    })
    return () => props.onReady?.(null)
  }, [editor.baseLayouts, editor.columnCount, editor.gridNode, entryByKey, layoutItems, metrics, props.onReady, visibleEntryByKey])

  if (!props.entries.length && !props.externalDragPreview) {
    return (
      <ScrollArea sx={{ flex: 1, minHeight: 0 }} viewportSx={{ p: { xs: 1.5, sm: 2 }, pt: 1 }}>
        <EmptyState phase={props.phase} search={props.search} onAdd={props.onAdd} />
      </ScrollArea>
    )
  }

  const canvasHeight = getFolderGridCanvasHeight(displayLayouts.values(), metrics)

  return (
    <ScrollArea
      component="section"
      ariaLabel="收藏文件夹图标布局"
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
                doc={props.doc}
                dragging={editor.draggingId === key}
                entry={entry}
                groupCount={props.groupCount}
                metrics={metrics}
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

function EmptyState(props: { phase: Phase; search: string; onAdd(): void }) {
  return (
    <Paper sx={{ minHeight: '100%', p: { xs: 3, sm: 5 }, borderRadius: 4, display: 'grid', placeItems: 'center', textAlign: 'center', bgcolor: 'background.paper' }}>
      <Stack spacing={1.5} alignItems="center" sx={{ maxWidth: 420 }}>
        <Box sx={{ width: 72, height: 72, borderRadius: 4, display: 'grid', placeItems: 'center', color: 'primary.main', bgcolor: theme => alpha(theme.palette.primary.main, 0.1) }}>
          <DriveFolderUploadRoundedIcon fontSize="large" />
        </Box>
        <Typography variant="h2">{props.search ? '未找到匹配的文件夹' : '暂无收藏文件夹'}</Typography>
        <Typography color="text.secondary">{props.search ? '换个关键词试试，或者把这个目录添加到收藏。' : '添加常用目录后，可以从这里一键打开、分组管理和快速搜索。'}</Typography>
        <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={props.onAdd} disabled={props.phase !== 'ready'}>添加文件夹</Button>
      </Stack>
    </Paper>
  )
}
