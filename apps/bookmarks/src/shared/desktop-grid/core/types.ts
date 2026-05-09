import type * as React from 'react'

export type DesktopGridLayout = {
  x: number
  y: number
}

export type DesktopGridItemKind = 'item' | 'container'

export type DesktopGridEntry = {
  id: string
  kind: DesktopGridItemKind
  name: string
  layout?: DesktopGridLayout
  disabled?: boolean
}

export type DesktopGridContainerItem = {
  id: string
  name: string
  layout?: DesktopGridLayout
  disabled?: boolean
}

export type DesktopGridLayoutPatch = {
  id: string
  layout: DesktopGridLayout
}

export type DesktopGridPlacement = DesktopGridLayoutPatch

export type DesktopGridDragEvent<TEntry extends DesktopGridEntry = DesktopGridEntry> = {
  itemId: string
  clientX: number
  clientY: number
  offsetX: number
  offsetY: number
  targetLayout?: DesktopGridLayout
  entry: TEntry
  hoverContainer?: TEntry
}

export type DesktopGridRenderItemState = {
  dragging: boolean
  consumeClick(): boolean
}

export type DesktopGridRenderItem<TEntry> = (entry: TEntry, state: DesktopGridRenderItemState) => React.ReactNode

export type DesktopGridRenderContainerPreview<TEntry, TContainerItem> = (entry: TEntry, items: TContainerItem[], state: DesktopGridRenderItemState) => React.ReactNode

export type DesktopGridRenderContainerItemState = {
  dragging: boolean
  consumeClick(): boolean
}

export type DesktopGridRenderContainerItem<TContainerItem> = (item: TContainerItem, state: DesktopGridRenderContainerItemState) => React.ReactNode

export type DesktopGridContainerApi = {
  currentPlacements(): DesktopGridPlacement[]
  placementsForDrop(itemId: string, layout: DesktopGridLayout): DesktopGridPlacement[]
  layoutFromClientPoint(clientX: number, clientY: number, offsetX?: number, offsetY?: number): DesktopGridLayout | null
}
