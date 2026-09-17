import type { DesktopGridDragMode } from './shared/desktop-grid/core/dragTypes'
import type { CollectionContainer, CollectionGridLayout, CollectionItem, DesktopGridEntry } from './types'

export type DesktopDragDropIntent =
  | { kind: 'container'; containerId: string }
  | { kind: 'new-container'; targetItemId: string; layout: CollectionGridLayout }

export type DesktopDragState = {
  item: CollectionItem
  mode: DesktopGridDragMode
  hoverTargetId?: string
  hoverTargetKind?: DesktopGridEntry['kind']
  dropIntent?: DesktopDragDropIntent
} | null

type DesktopDropIntentEvent = {
  dragMode: DesktopGridDragMode
  hoverTarget?: { entry: DesktopGridEntry; layout: CollectionGridLayout }
}

export function resolveDesktopDropIntent(
  event: DesktopDropIntentEvent,
  currentDrag: DesktopDragState,
  openContainer: CollectionContainer | null,
): DesktopDragDropIntent | undefined {
  if (event.dragMode !== 'overlay') return undefined
  const openContainerIntent = resolveOpenContainerDropIntent(currentDrag, openContainer)
  if (openContainerIntent) return openContainerIntent
  return resolveDesktopHoverDropIntent(event)
}

export function resolveDesktopDragMode(event: DesktopDropIntentEvent, dropIntent: DesktopDragDropIntent | undefined): DesktopGridDragMode {
  return dropIntent ? 'overlay' : event.dragMode
}

export function isContainerDropTargetActive(drag: DesktopDragState, container: CollectionContainer | null): boolean {
  return Boolean(resolveOpenContainerDropIntent(drag, container))
}

function resolveOpenContainerDropIntent(
  currentDrag: DesktopDragState,
  openContainer: CollectionContainer | null,
): Extract<DesktopDragDropIntent, { kind: 'container' }> | undefined {
  const intent = currentDrag?.dropIntent
  if (!openContainer || currentDrag?.mode !== 'overlay' || intent?.kind !== 'container') return undefined
  return intent.containerId === openContainer.id ? intent : undefined
}

function resolveDesktopHoverDropIntent(event: DesktopDropIntentEvent): DesktopDragDropIntent | undefined {
  const hoverTarget = event.hoverTarget
  if (!hoverTarget) return undefined
  if (hoverTarget.entry.kind === 'container') return { kind: 'container', containerId: hoverTarget.entry.id }
  if (hoverTarget.entry.kind === 'item' && hoverTarget.entry.item) return { kind: 'new-container', targetItemId: hoverTarget.entry.item.id, layout: hoverTarget.layout }
  return undefined
}
