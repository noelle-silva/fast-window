import { resolveDesktopDragMode, resolveDesktopDropIntent } from '../desktopDragState'
import type { DesktopDragDropIntent, DesktopDragState } from '../desktopDragState'
import { getDesktopGridDragMode } from '../shared/desktop-grid/drag/dragModifiers'
import type { CollectionContainer, CollectionGridLayout, CollectionItem, DesktopGridEntry } from '../types'
import { desktopEntryKey, parseDesktopEntryKey, type DesktopGridLayoutPatch } from './desktopEntries'
import type { FolderGridMetrics } from './iconLayout'
import {
  diffFolderGridLayouts,
  getFolderGridLayoutFromPixel,
  getFolderGridPixelRect,
  resolveFolderGridDragLayout,
  resolveFolderGridOverlayLayout,
  type FolderGridLayoutMap,
  type FolderGridLayoutPatch,
  type FolderGridLayoutSource,
} from './layout'
import type { FolderGridDragEvent } from './useMuuriFolderGrid'

type RectLike = {
  bottom: number
  left: number
  right: number
  top: number
}

export type DesktopGridHoverTarget = { entry: DesktopGridEntry; layout: CollectionGridLayout }
export type DesktopGridDragEvent = FolderGridDragEvent & { entry: DesktopGridEntry; hoverContainer?: DesktopGridEntry; hoverTarget?: DesktopGridHoverTarget }
export type DesktopGridExternalItemDrag = { item: CollectionItem; clientX: number; clientY: number; offsetX: number; offsetY: number; modifiers: FolderGridDragEvent['modifiers'] }
export type DesktopGridExternalDragProjection = { dropIntent?: DesktopDragDropIntent; event: DesktopGridDragEvent; layouts: FolderGridLayoutMap; patches: DesktopGridLayoutPatch[] }

export function toDesktopGridLayoutPatch(patch: FolderGridLayoutPatch): DesktopGridLayoutPatch | null {
  const parsed = parseDesktopEntryKey(patch.id)
  return parsed ? { ...parsed, layout: patch.layout } : null
}

export function toDesktopDragEvent(event: FolderGridDragEvent, entries: Map<string, DesktopGridEntry>, hoverEntries: Map<string, DesktopGridEntry>, gridRect: RectLike | null, layouts: FolderGridLayoutMap, metrics: FolderGridMetrics): DesktopGridDragEvent {
  const entry = entries.get(event.itemId)
  if (!entry) throw new Error(`desktop drag entry not found: ${event.itemId}`)
  const hoverTarget = findDesktopHoverTarget(event, entry, hoverEntries, gridRect, layouts, metrics)
  const hoverContainer = hoverTarget?.entry.kind === 'container' ? hoverTarget.entry : undefined
  return { ...event, entry, hoverContainer, hoverTarget }
}

export function projectExternalItemDrag(
  drag: DesktopGridExternalItemDrag,
  currentDrag: DesktopDragState,
  openContainer: CollectionContainer | null,
  baseItems: FolderGridLayoutSource[],
  baseLayouts: FolderGridLayoutMap,
  columnCount: number,
  gridRect: RectLike,
  boundsRect: RectLike,
  allEntries: Map<string, DesktopGridEntry>,
  hoverEntries: Map<string, DesktopGridEntry>,
  metrics: FolderGridMetrics,
): DesktopGridExternalDragProjection | null {
  if (drag.clientX < boundsRect.left || drag.clientX > boundsRect.right || drag.clientY < boundsRect.top || drag.clientY > boundsRect.bottom) return null
  const activeId = desktopEntryKey('item', drag.item.id)
  const targetLayout = getFolderGridLayoutFromPixel(drag.clientX - gridRect.left - drag.offsetX, drag.clientY - gridRect.top - drag.offsetY, columnCount, metrics)
  const nextItems = baseItems.some(item => item.id === activeId) ? baseItems : [...baseItems, { id: activeId }]
  const dragMode = getDesktopGridDragMode(drag.modifiers)
  const probeEvent = buildExternalDesktopDragEvent(drag, activeId, targetLayout, dragMode, allEntries, hoverEntries, gridRect, baseLayouts, metrics)
  const dropIntent = resolveDesktopDropIntent(probeEvent, currentDrag, openContainer)
  const resolvedDragMode = resolveDesktopDragMode(probeEvent, dropIntent)
  const layouts = resolvedDragMode === 'overlay'
    ? resolveFolderGridOverlayLayout(baseLayouts, activeId, targetLayout, columnCount)
    : resolveFolderGridDragLayout(nextItems, baseLayouts, activeId, targetLayout, columnCount)
  const patches = diffFolderGridLayouts(baseLayouts, layouts).map(toDesktopGridLayoutPatch).filter((patch): patch is DesktopGridLayoutPatch => Boolean(patch))
  const event = buildExternalDesktopDragEvent(drag, activeId, targetLayout, resolvedDragMode, allEntries, hoverEntries, gridRect, baseLayouts, metrics)
  return { dropIntent, event, layouts, patches }
}

function buildExternalDesktopDragEvent(
  drag: DesktopGridExternalItemDrag,
  activeId: string,
  targetLayout: CollectionGridLayout,
  dragMode: FolderGridDragEvent['dragMode'],
  allEntries: Map<string, DesktopGridEntry>,
  hoverEntries: Map<string, DesktopGridEntry>,
  gridRect: RectLike,
  layouts: FolderGridLayoutMap,
  metrics: FolderGridMetrics,
): DesktopGridDragEvent {
  const entry = allEntries.get(activeId) || {
    kind: 'item' as const,
    id: drag.item.id,
    name: drag.item.name,
    item: drag.item,
  }
  const entries = new Map(allEntries)
  entries.set(activeId, entry)
  const baseEvent: FolderGridDragEvent = {
    itemId: activeId,
    clientX: drag.clientX,
    clientY: drag.clientY,
    offsetX: drag.offsetX,
    offsetY: drag.offsetY,
    dragMode,
    modifiers: drag.modifiers,
    targetLayout,
  }
  return toDesktopDragEvent(baseEvent, entries, hoverEntries, gridRect, layouts, metrics)
}

function findDesktopHoverTarget(event: FolderGridDragEvent, activeEntry: DesktopGridEntry, entries: Map<string, DesktopGridEntry>, gridRect: RectLike | null, layouts: FolderGridLayoutMap, metrics: FolderGridMetrics): DesktopGridHoverTarget | undefined {
  if (!gridRect) return undefined
  const x = event.clientX - gridRect.left
  const y = event.clientY - gridRect.top
  for (const entry of entries.values()) {
    if (entry.id === activeEntry.id) continue
    const layout = layouts.get(desktopEntryKey(entry.kind, entry.id))
    if (!layout) continue
    const rect = getFolderGridPixelRect(layout, metrics)
    if (x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height) return { entry, layout }
  }
  return undefined
}
