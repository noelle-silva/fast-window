import type { DesktopGridLayout, DesktopGridLayoutPatch } from './types'
import {
  DESKTOP_GRID_CELL_HEIGHT,
  DESKTOP_GRID_CELL_WIDTH,
  DESKTOP_GRID_ITEM_HEIGHT,
  DESKTOP_GRID_ITEM_WIDTH,
  DESKTOP_GRID_MAX_COORD,
  DESKTOP_GRID_MIN_HEIGHT,
  DESKTOP_GRID_PADDING,
} from './constants'

export type DesktopGridLayoutMap = Map<string, DesktopGridLayout>
export type DesktopGridPixelRect = { left: number; top: number; width: number; height: number }
export type DesktopGridLayoutSource = { id: string; layout?: DesktopGridLayout }

export function getDesktopGridColumnCount(containerWidth: number): number {
  const usableWidth = Math.max(DESKTOP_GRID_ITEM_WIDTH, Math.floor(containerWidth) - DESKTOP_GRID_PADDING * 2)
  return Math.max(1, Math.floor((usableWidth + DESKTOP_GRID_CELL_WIDTH - DESKTOP_GRID_ITEM_WIDTH) / DESKTOP_GRID_CELL_WIDTH))
}

export function normalizeDesktopGridLayout(layout: Partial<DesktopGridLayout> | null | undefined, columnCount: number): DesktopGridLayout {
  const columns = Math.max(1, Math.floor(columnCount))
  const rawX = Number(layout?.x ?? 0)
  const rawY = Number(layout?.y ?? 0)
  const x = Number.isFinite(rawX) ? Math.max(0, Math.min(columns - 1, Math.floor(rawX))) : 0
  const y = Number.isFinite(rawY) ? Math.max(0, Math.min(DESKTOP_GRID_MAX_COORD, Math.floor(rawY))) : 0
  return { x, y }
}

export function desktopGridLayoutEquals(a: DesktopGridLayout | undefined, b: DesktopGridLayout | undefined): boolean {
  return Boolean(a && b && a.x === b.x && a.y === b.y)
}

export function desktopGridSlot(layout: DesktopGridLayout, columnCount: number): number {
  return layout.y * Math.max(1, columnCount) + layout.x
}

export function desktopGridLayoutFromSlot(slot: number, columnCount: number): DesktopGridLayout {
  const columns = Math.max(1, columnCount)
  const safeSlot = Math.max(0, Math.floor(slot))
  return { x: safeSlot % columns, y: Math.floor(safeSlot / columns) }
}

function firstFreeLayout(occupiedSlots: Set<number>, startSlot: number, columnCount: number): DesktopGridLayout {
  let slot = Math.max(0, startSlot)
  while (occupiedSlots.has(slot)) slot += 1
  return desktopGridLayoutFromSlot(slot, columnCount)
}

export function buildDesktopGridLayoutMap(items: DesktopGridLayoutSource[], columnCount: number): DesktopGridLayoutMap {
  const occupiedSlots = new Set<number>()
  const layoutMap: DesktopGridLayoutMap = new Map()

  const persistedItems = items
    .map((item, index) => ({ item, index, layout: item.layout ? normalizeDesktopGridLayout(item.layout, columnCount) : null }))
    .filter((entry): entry is { item: DesktopGridLayoutSource; index: number; layout: DesktopGridLayout } => Boolean(entry.layout))
    .sort((a, b) => desktopGridSlot(a.layout, columnCount) - desktopGridSlot(b.layout, columnCount) || a.index - b.index)

  for (const { item, layout: desired } of persistedItems) {
    const layout = firstFreeLayout(occupiedSlots, desktopGridSlot(desired, columnCount), columnCount)
    layoutMap.set(item.id, layout)
    occupiedSlots.add(desktopGridSlot(layout, columnCount))
  }

  items.forEach((item, index) => {
    if (layoutMap.has(item.id)) return
    const desired = desktopGridLayoutFromSlot(index, columnCount)
    const layout = firstFreeLayout(occupiedSlots, desktopGridSlot(desired, columnCount), columnCount)
    layoutMap.set(item.id, layout)
    occupiedSlots.add(desktopGridSlot(layout, columnCount))
  })

  return layoutMap
}

export function resolveDesktopGridDragLayout(
  items: DesktopGridLayoutSource[],
  baseLayouts: DesktopGridLayoutMap,
  activeId: string,
  targetLayout: DesktopGridLayout,
  columnCount: number,
): DesktopGridLayoutMap {
  const activeLayout = normalizeDesktopGridLayout(targetLayout, columnCount)
  const activeSlot = desktopGridSlot(activeLayout, columnCount)
  const occupiedSlots = new Set<number>([activeSlot])
  const nextLayouts: DesktopGridLayoutMap = new Map([[activeId, activeLayout]])

  items
    .filter(item => item.id !== activeId)
    .map((item, index) => {
      const layout = baseLayouts.get(item.id) || desktopGridLayoutFromSlot(index, columnCount)
      return { item, index, slot: desktopGridSlot(layout, columnCount) }
    })
    .sort((a, b) => a.slot - b.slot || a.index - b.index)
    .forEach(({ item, slot }) => {
      const layout = firstFreeLayout(occupiedSlots, slot, columnCount)
      nextLayouts.set(item.id, layout)
      occupiedSlots.add(desktopGridSlot(layout, columnCount))
    })

  return nextLayouts
}

export function getDesktopGridPixelRect(layout: DesktopGridLayout): DesktopGridPixelRect {
  return {
    left: DESKTOP_GRID_PADDING + layout.x * DESKTOP_GRID_CELL_WIDTH,
    top: DESKTOP_GRID_PADDING + layout.y * DESKTOP_GRID_CELL_HEIGHT,
    width: DESKTOP_GRID_ITEM_WIDTH,
    height: DESKTOP_GRID_ITEM_HEIGHT,
  }
}

export function getDesktopGridLayoutFromPixel(left: number, top: number, columnCount: number): DesktopGridLayout {
  return normalizeDesktopGridLayout({
    x: Math.round((left - DESKTOP_GRID_PADDING) / DESKTOP_GRID_CELL_WIDTH),
    y: Math.round((top - DESKTOP_GRID_PADDING) / DESKTOP_GRID_CELL_HEIGHT),
  }, columnCount)
}

export function getDesktopGridCanvasHeight(layouts: Iterable<DesktopGridLayout>): number {
  let maxBottom = DESKTOP_GRID_MIN_HEIGHT
  for (const layout of layouts) {
    const rect = getDesktopGridPixelRect(layout)
    maxBottom = Math.max(maxBottom, rect.top + rect.height + DESKTOP_GRID_PADDING)
  }
  return maxBottom
}

export function diffDesktopGridLayouts(baseLayouts: DesktopGridLayoutMap, nextLayouts: DesktopGridLayoutMap): DesktopGridLayoutPatch[] {
  const patches: DesktopGridLayoutPatch[] = []
  for (const [id, nextLayout] of nextLayouts) {
    if (!desktopGridLayoutEquals(baseLayouts.get(id), nextLayout)) patches.push({ id, layout: nextLayout })
  }
  return patches
}
