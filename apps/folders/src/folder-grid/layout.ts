import type { FolderGridLayout, FolderItem } from '../types'
import {
  FOLDER_GRID_CELL_HEIGHT,
  FOLDER_GRID_CELL_WIDTH,
  FOLDER_GRID_ITEM_HEIGHT,
  FOLDER_GRID_ITEM_WIDTH,
  FOLDER_GRID_MAX_COORD,
  FOLDER_GRID_MIN_HEIGHT,
  FOLDER_GRID_PADDING,
} from './constants'

export type FolderGridLayoutMap = Map<string, FolderGridLayout>
export type FolderGridLayoutPatch = { id: string; layout: FolderGridLayout }

export function getFolderGridColumnCount(containerWidth: number): number {
  const usableWidth = Math.max(FOLDER_GRID_ITEM_WIDTH, Math.floor(containerWidth) - FOLDER_GRID_PADDING * 2)
  return Math.max(1, Math.floor((usableWidth + FOLDER_GRID_CELL_WIDTH - FOLDER_GRID_ITEM_WIDTH) / FOLDER_GRID_CELL_WIDTH))
}

export function normalizeFolderGridLayout(layout: Partial<FolderGridLayout> | null | undefined, columnCount: number): FolderGridLayout {
  const columns = Math.max(1, Math.floor(columnCount))
  const rawX = Number(layout?.x ?? 0)
  const rawY = Number(layout?.y ?? 0)
  const x = Number.isFinite(rawX) ? Math.max(0, Math.min(columns - 1, Math.floor(rawX))) : 0
  const y = Number.isFinite(rawY) ? Math.max(0, Math.min(FOLDER_GRID_MAX_COORD, Math.floor(rawY))) : 0
  return { x, y }
}

export function folderGridLayoutEquals(a: FolderGridLayout | undefined, b: FolderGridLayout | undefined): boolean {
  return Boolean(a && b && a.x === b.x && a.y === b.y)
}

export function folderGridSlot(layout: FolderGridLayout, columnCount: number): number {
  return layout.y * Math.max(1, columnCount) + layout.x
}

export function folderGridLayoutFromSlot(slot: number, columnCount: number): FolderGridLayout {
  const columns = Math.max(1, columnCount)
  const safeSlot = Math.max(0, Math.floor(slot))
  return { x: safeSlot % columns, y: Math.floor(safeSlot / columns) }
}

function firstFreeLayout(occupiedSlots: Set<number>, startSlot: number, columnCount: number): FolderGridLayout {
  let slot = Math.max(0, startSlot)
  while (occupiedSlots.has(slot)) slot += 1
  return folderGridLayoutFromSlot(slot, columnCount)
}

export function buildFolderGridLayoutMap(items: FolderItem[], columnCount: number): FolderGridLayoutMap {
  const occupiedSlots = new Set<number>()
  const layoutMap: FolderGridLayoutMap = new Map()

  const persistedItems = items
    .map((item, index) => ({ item, index, layout: item.layout ? normalizeFolderGridLayout(item.layout, columnCount) : null }))
    .filter((entry): entry is { item: FolderItem; index: number; layout: FolderGridLayout } => Boolean(entry.layout))
    .sort((a, b) => folderGridSlot(a.layout, columnCount) - folderGridSlot(b.layout, columnCount) || a.index - b.index)

  for (const { item, layout: desired } of persistedItems) {
    const layout = firstFreeLayout(occupiedSlots, folderGridSlot(desired, columnCount), columnCount)
    layoutMap.set(item.id, layout)
    occupiedSlots.add(folderGridSlot(layout, columnCount))
  }

  items.forEach((item, index) => {
    if (layoutMap.has(item.id)) return
    const desired = folderGridLayoutFromSlot(index, columnCount)
    const layout = firstFreeLayout(occupiedSlots, folderGridSlot(desired, columnCount), columnCount)
    layoutMap.set(item.id, layout)
    occupiedSlots.add(folderGridSlot(layout, columnCount))
  })

  return layoutMap
}

export function resolveFolderGridDragLayout(
  items: FolderItem[],
  baseLayouts: FolderGridLayoutMap,
  activeId: string,
  targetLayout: FolderGridLayout,
  columnCount: number,
): FolderGridLayoutMap {
  const activeLayout = normalizeFolderGridLayout(targetLayout, columnCount)
  const activeSlot = folderGridSlot(activeLayout, columnCount)
  const occupiedSlots = new Set<number>([activeSlot])
  const nextLayouts: FolderGridLayoutMap = new Map([[activeId, activeLayout]])

  items
    .filter(item => item.id !== activeId)
    .map((item, index) => {
      const layout = baseLayouts.get(item.id) || folderGridLayoutFromSlot(index, columnCount)
      return { item, index, slot: folderGridSlot(layout, columnCount) }
    })
    .sort((a, b) => a.slot - b.slot || a.index - b.index)
    .forEach(({ item, slot }) => {
      const layout = firstFreeLayout(occupiedSlots, slot, columnCount)
      nextLayouts.set(item.id, layout)
      occupiedSlots.add(folderGridSlot(layout, columnCount))
    })

  return nextLayouts
}

export function getFolderGridPixelRect(layout: FolderGridLayout): { left: number; top: number; width: number; height: number } {
  return {
    left: FOLDER_GRID_PADDING + layout.x * FOLDER_GRID_CELL_WIDTH,
    top: FOLDER_GRID_PADDING + layout.y * FOLDER_GRID_CELL_HEIGHT,
    width: FOLDER_GRID_ITEM_WIDTH,
    height: FOLDER_GRID_ITEM_HEIGHT,
  }
}

export function getFolderGridLayoutFromPixel(left: number, top: number, columnCount: number): FolderGridLayout {
  return normalizeFolderGridLayout({
    x: Math.round((left - FOLDER_GRID_PADDING) / FOLDER_GRID_CELL_WIDTH),
    y: Math.round((top - FOLDER_GRID_PADDING) / FOLDER_GRID_CELL_HEIGHT),
  }, columnCount)
}

export function getFolderGridCanvasHeight(layouts: Iterable<FolderGridLayout>): number {
  let maxBottom = FOLDER_GRID_MIN_HEIGHT
  for (const layout of layouts) {
    const rect = getFolderGridPixelRect(layout)
    maxBottom = Math.max(maxBottom, rect.top + rect.height + FOLDER_GRID_PADDING)
  }
  return maxBottom
}

export function diffFolderGridLayouts(baseLayouts: FolderGridLayoutMap, nextLayouts: FolderGridLayoutMap): FolderGridLayoutPatch[] {
  const patches: FolderGridLayoutPatch[] = []
  for (const [id, nextLayout] of nextLayouts) {
    if (!folderGridLayoutEquals(baseLayouts.get(id), nextLayout)) patches.push({ id, layout: nextLayout })
  }
  return patches
}
