import type { DesktopGridDragMode } from './shared/desktop-grid/core/dragTypes'
import type { DesktopContainer, DesktopGridEntry, FolderGridLayout, FolderItem } from './types'

export type DesktopDragDropIntent =
  | { kind: 'container'; containerId: string }
  | { kind: 'new-container'; targetItemId: string; layout: FolderGridLayout }

export type DesktopDragState = {
  item: FolderItem
  mode: DesktopGridDragMode
  hoverTargetId?: string
  hoverTargetKind?: DesktopGridEntry['kind']
  dropIntent?: DesktopDragDropIntent
} | null

type DesktopDropIntentEvent = {
  dragMode: DesktopGridDragMode
  hoverTarget?: { entry: DesktopGridEntry; layout: FolderGridLayout }
}

export function resolveDesktopDropIntent(
  event: DesktopDropIntentEvent,
  currentDrag: DesktopDragState,
  openContainer: DesktopContainer | null,
): DesktopDragDropIntent | undefined {
  if (event.dragMode !== 'overlay') return undefined
  const openContainerIntent = resolveOpenContainerDropIntent(currentDrag, openContainer)
  if (openContainerIntent) return openContainerIntent
  return resolveDesktopHoverDropIntent(event)
}

export function resolveDesktopDragMode(event: DesktopDropIntentEvent, dropIntent: DesktopDragDropIntent | undefined): DesktopGridDragMode {
  return dropIntent ? 'overlay' : event.dragMode
}

export function isContainerDropTargetActive(drag: DesktopDragState, container: DesktopContainer | null): boolean {
  return Boolean(resolveOpenContainerDropIntent(drag, container))
}

function resolveOpenContainerDropIntent(
  currentDrag: DesktopDragState,
  openContainer: DesktopContainer | null,
): Extract<DesktopDragDropIntent, { kind: 'container' }> | undefined {
  const intent = currentDrag?.dropIntent
  if (!openContainer || currentDrag?.mode !== 'overlay' || intent?.kind !== 'container') return undefined
  return intent.containerId === openContainer.id ? intent : undefined
}

function resolveDesktopHoverDropIntent(event: DesktopDropIntentEvent): DesktopDragDropIntent | undefined {
  const hoverTarget = event.hoverTarget
  if (!hoverTarget) return undefined
  if (hoverTarget.entry.kind === 'container') return { kind: 'container', containerId: hoverTarget.entry.id }
  if (hoverTarget.entry.kind === 'folder' && hoverTarget.entry.item) return { kind: 'new-container', targetItemId: hoverTarget.entry.item.id, layout: hoverTarget.layout }
  return undefined
}
