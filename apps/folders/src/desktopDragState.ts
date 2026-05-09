import type { DesktopGridDragMode } from './shared/desktop-grid/core/dragTypes'
import type { DesktopGridEntry, FolderGridLayout, FolderItem } from './types'

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
