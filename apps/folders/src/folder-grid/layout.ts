import type { FolderGridLayout } from '../types'
import { FOLDER_GRID_MAX_COORD } from './constants'
import { DEFAULT_FOLDER_GRID_METRICS, type FolderGridMetrics } from './iconLayout'

export type FolderGridLayoutMap = Map<string, FolderGridLayout>
export type FolderGridLayoutPatch = { id: string; layout: FolderGridLayout }
export type FolderGridPixelRect = { left: number; top: number; width: number; height: number }
export type FolderGridLayoutSource = { id: string; layout?: FolderGridLayout }

export function getFolderGridColumnCount(containerWidth: number, metrics: FolderGridMetrics = DEFAULT_FOLDER_GRID_METRICS): number {
  const usableWidth = Math.max(metrics.itemWidth, Math.floor(containerWidth) - metrics.padding * 2)
  return Math.max(1, Math.floor((usableWidth + metrics.cellWidth - metrics.itemWidth) / metrics.cellWidth))
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

export function buildFolderGridLayoutMap(items: FolderGridLayoutSource[], columnCount: number): FolderGridLayoutMap {
  const occupiedSlots = new Set<number>()
  const layoutMap: FolderGridLayoutMap = new Map()

  const persistedItems = items
    .map((item, index) => ({ item, index, layout: item.layout ? normalizeFolderGridLayout(item.layout, columnCount) : null }))
    .filter((entry): entry is { item: FolderGridLayoutSource; index: number; layout: FolderGridLayout } => Boolean(entry.layout))
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
  items: FolderGridLayoutSource[],
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

export function resolveFolderGridOverlayLayout(
  baseLayouts: FolderGridLayoutMap,
  activeId: string,
  targetLayout: FolderGridLayout,
  columnCount: number,
): FolderGridLayoutMap {
  const nextLayouts = new Map(baseLayouts)
  nextLayouts.set(activeId, normalizeFolderGridLayout(targetLayout, columnCount))
  return nextLayouts
}

export function getFolderGridPixelRect(layout: FolderGridLayout, metrics: FolderGridMetrics = DEFAULT_FOLDER_GRID_METRICS): FolderGridPixelRect {
  return {
    left: metrics.padding + layout.x * metrics.cellWidth,
    top: metrics.padding + layout.y * metrics.cellHeight,
    width: metrics.itemWidth,
    height: metrics.itemHeight,
  }
}

export function getFolderGridLayoutFromPixel(left: number, top: number, columnCount: number, metrics: FolderGridMetrics = DEFAULT_FOLDER_GRID_METRICS): FolderGridLayout {
  return normalizeFolderGridLayout({
    x: Math.round((left - metrics.padding) / metrics.cellWidth),
    y: Math.round((top - metrics.padding) / metrics.cellHeight),
  }, columnCount)
}

export function getFolderGridCanvasHeight(layouts: Iterable<FolderGridLayout>, metrics: FolderGridMetrics = DEFAULT_FOLDER_GRID_METRICS): number {
  let maxBottom = metrics.minHeight
  for (const layout of layouts) {
    const rect = getFolderGridPixelRect(layout, metrics)
    maxBottom = Math.max(maxBottom, rect.top + rect.height + metrics.padding)
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
