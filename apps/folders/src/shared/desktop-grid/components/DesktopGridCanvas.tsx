import * as React from 'react'
import { Box } from '@mui/material'
import { ScrollArea } from '../../scroll-area'
import {
  getDesktopGridCanvasHeight,
  getDesktopGridPixelRect,
  type DesktopGridLayoutMap,
  type DesktopGridLayoutSource,
} from '../core/layout'
import type {
  DesktopGridDragEndResult,
  DesktopGridDragEvent,
  DesktopGridEntry,
  DesktopGridLayoutPatch,
  DesktopGridRenderContainerPreview,
  DesktopGridRenderItem,
} from '../core/types'
import { useMuuriDesktopGrid, type MuuriDesktopGridDragEvent } from '../drag/useMuuriDesktopGrid'

type Props<TEntry extends DesktopGridEntry, TContainerItem> = {
  allEntries?: TEntry[]
  ariaLabel?: string
  enableOverlayDrag?: boolean
  entries: TEntry[]
  getContainerPreviewItems?(entry: TEntry): TContainerItem[]
  onDragCancel?(event: DesktopGridDragEvent<TEntry>): void
  onDragEnd?(event: DesktopGridDragEvent<TEntry>, patches: DesktopGridLayoutPatch[]): DesktopGridDragEndResult | void
  onDragMove?(event: DesktopGridDragEvent<TEntry>): void
  onDragStart?(event: DesktopGridDragEvent<TEntry>): void
  onLayoutCommit(patches: DesktopGridLayoutPatch[]): void
  renderContainerPreview?: DesktopGridRenderContainerPreview<TEntry, TContainerItem>
  renderEmpty?(): React.ReactNode
  renderItem: DesktopGridRenderItem<TEntry>
}

export function DesktopGridCanvas<TEntry extends DesktopGridEntry, TContainerItem = never>(props: Props<TEntry, TContainerItem>): React.ReactNode {
  const allEntries = props.allEntries || props.entries
  const layoutItems = React.useMemo<DesktopGridLayoutSource[]>(() => allEntries.map(entry => ({ id: entry.id, layout: entry.layout })), [allEntries])
  const renderedItemIds = React.useMemo(() => props.entries.map(entry => entry.id), [props.entries])
  const visibleEntryById = React.useMemo(() => new Map(props.entries.map(entry => [entry.id, entry])), [props.entries])
  const entryById = React.useMemo(() => new Map(allEntries.map(entry => [entry.id, entry])), [allEntries])
  const gridNodeRef = React.useRef<HTMLDivElement | null>(null)
  const hoverLayoutsRef = React.useRef<DesktopGridLayoutMap>(new Map())
  const editor = useMuuriDesktopGrid({
    enableOverlayDrag: props.enableOverlayDrag,
    items: layoutItems,
    renderedItemIds,
    onCommit: props.onLayoutCommit,
    onDragCancel: event => props.onDragCancel?.(toDesktopDragEvent(event, entryById, visibleEntryById, gridNodeRef.current, hoverLayoutsRef.current)),
    onDragEnd: (event, patches) => props.onDragEnd?.(toDesktopDragEvent(event, entryById, visibleEntryById, gridNodeRef.current, hoverLayoutsRef.current), patches),
    onDragMove: event => props.onDragMove?.(toDesktopDragEvent(event, entryById, visibleEntryById, gridNodeRef.current, hoverLayoutsRef.current)),
    onDragStart: event => props.onDragStart?.(toDesktopDragEvent(event, entryById, visibleEntryById, gridNodeRef.current, hoverLayoutsRef.current)),
  })
  gridNodeRef.current = editor.gridNode
  hoverLayoutsRef.current = editor.baseLayouts

  if (!props.entries.length) return props.renderEmpty?.() || null

  const canvasHeight = getDesktopGridCanvasHeight(editor.activeLayouts.values())

  return (
    <ScrollArea component="section" ariaLabel={props.ariaLabel || 'Desktop icon grid'} sx={{ flex: 1, minHeight: 0 }} viewportSx={{ px: { xs: 1, sm: 1.5 }, pb: { xs: 1.5, sm: 2 }, pt: 1 }}>
      <Box ref={editor.setGridNode} sx={{ position: 'relative', minHeight: canvasHeight }}>
        {props.entries.map(entry => {
          const layout = editor.activeLayouts.get(entry.id)
          if (!layout) return null
          const rect = getDesktopGridPixelRect(layout)
          const state = {
            dragging: editor.draggingId === entry.id,
            consumeClick: () => editor.consumeSuppressedClick(entry.id),
          }
          return (
            <Box
              key={entry.id}
              className={editor.muuriItemClassName}
              data-entry-key={entry.id}
              sx={{
                position: 'absolute',
                display: 'block',
                width: rect.width,
                height: rect.height,
                minWidth: 0,
                minHeight: 0,
                boxSizing: 'border-box',
                zIndex: editor.draggingId === entry.id ? 3 : 1,
                '&.muuri-item-releasing': { zIndex: 2 },
                '&.muuri-item-dragging': { zIndex: theme => theme.zIndex.modal + 2 },
                '&.muuri-item-hidden': { zIndex: 0 },
              }}
            >
              {entry.kind === 'container' && props.renderContainerPreview
                ? props.renderContainerPreview(entry, props.getContainerPreviewItems?.(entry) || [], state)
                : props.renderItem(entry, state)}
            </Box>
          )
        })}
      </Box>
    </ScrollArea>
  )
}

function toDesktopDragEvent<TEntry extends DesktopGridEntry>(
  event: MuuriDesktopGridDragEvent,
  entries: Map<string, TEntry>,
  hoverEntries: Map<string, TEntry>,
  gridNode: HTMLDivElement | null,
  layouts: DesktopGridLayoutMap,
): DesktopGridDragEvent<TEntry> {
  const entry = entries.get(event.itemId)
  if (!entry) throw new Error(`desktop grid drag entry not found: ${event.itemId}`)
  const hoverContainer = findHoverContainer(event, entry, hoverEntries, gridNode, layouts)
  return { ...event, entry, hoverContainer }
}

function findHoverContainer<TEntry extends DesktopGridEntry>(
  event: MuuriDesktopGridDragEvent,
  activeEntry: TEntry,
  entries: Map<string, TEntry>,
  gridNode: HTMLDivElement | null,
  layouts: DesktopGridLayoutMap,
): TEntry | undefined {
  if (!gridNode) return undefined
  const gridRect = gridNode.getBoundingClientRect()
  const x = event.clientX - gridRect.left
  const y = event.clientY - gridRect.top
  for (const entry of entries.values()) {
    if (entry.kind !== 'container' || entry.id === activeEntry.id) continue
    const layout = layouts.get(entry.id)
    if (!layout) continue
    const rect = getDesktopGridPixelRect(layout)
    if (x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height) return entry
  }
  return undefined
}
