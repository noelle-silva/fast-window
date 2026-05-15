import type { DesktopGridLayoutPatch } from './folder-grid/desktopEntries'
import type { DesktopGridDragModifiers } from './shared/desktop-grid/core/dragTypes'
import type { CategoryWorkspace, CategoryWorkspaceView, CollectionContainer, CollectionItem } from './types'

export type ContainerExtractDragMode = 'container' | 'desktop'

export type ContainerExtractDragState = {
  containerId: string
  desktopDrag?: ContainerExtractDesktopDrag
  item: CollectionItem
  mode: ContainerExtractDragMode
} | null

export type ContainerExtractDesktopDrag = {
  item: CollectionItem
  clientX: number
  clientY: number
  offsetX: number
  offsetY: number
  modifiers: DesktopGridDragModifiers
}

type PointLike = {
  clientX: number
  clientY: number
}

type RectLike = {
  left: number
  right: number
  top: number
  bottom: number
}

export function resolveContainerExtractDragMode(point: PointLike, boundary: RectLike | null): ContainerExtractDragMode {
  if (!boundary) return 'container'
  return point.clientX < boundary.left || point.clientX > boundary.right || point.clientY < boundary.top || point.clientY > boundary.bottom ? 'desktop' : 'container'
}

export function resolveContainerExtractNextDragMode(currentMode: ContainerExtractDragMode | undefined, point: PointLike, boundary: RectLike | null): ContainerExtractDragMode {
  if (currentMode === 'desktop') return 'desktop'
  return resolveContainerExtractDragMode(point, boundary)
}

export function isContainerSoftClosedForExtractDrag(drag: ContainerExtractDragState, container: CollectionContainer | null): boolean {
  return Boolean(drag && container && drag.containerId === container.id && drag.mode === 'desktop')
}

export function extractedItemIdForContainerView(drag: ContainerExtractDragState, container: CollectionContainer | null): string | undefined {
  if (!drag || !container || drag.containerId !== container.id) return undefined
  return drag.item.id
}

export function applyContainerItemDesktopExtraction(workspace: CategoryWorkspace, containerId: string, itemId: string, patches: DesktopGridLayoutPatch[]): CategoryWorkspace {
  const desktopPatchByKey = buildDesktopPatchMap(patches)
  const movedPatch = desktopPatchByKey.get(`item:${itemId}`)
  if (!movedPatch) throw new Error(`desktop extraction layout missing for item: ${itemId}`)
  const appliedPatchKeys = new Set<string>()
  let movedFound = false

  const nextWorkspace = {
    ...workspace,
    items: workspace.items.map(item => {
      const key = `item:${item.id}`
      const patch = desktopPatchByKey.get(key)
      if (item.id === itemId) {
        if (item.containerId !== containerId) throw new Error(`item is not in container ${containerId}: ${item.id}`)
        movedFound = true
        appliedPatchKeys.add(key)
        return moveItemToDesktop(item, movedPatch.layout)
      }
      if (patch && item.containerId) throw new Error(`item is not on desktop: ${item.id}`)
      if (patch) appliedPatchKeys.add(key)
      return patch ? { ...item, layout: patch.layout } : item
    }),
    containers: workspace.containers.map(container => {
      const key = `container:${container.id}`
      const patch = desktopPatchByKey.get(key)
      if (patch) appliedPatchKeys.add(key)
      return patch ? { ...container, layout: patch.layout } : container
    }),
  }
  if (!movedFound) throw new Error(`item not found: ${itemId}`)
  for (const key of desktopPatchByKey.keys()) {
    if (!appliedPatchKeys.has(key)) throw new Error(`desktop entry not found: ${key}`)
  }
  return nextWorkspace
}

export function applyContainerItemDesktopExtractionView(workspace: CategoryWorkspaceView, containerId: string, itemId: string, patches: DesktopGridLayoutPatch[]): CategoryWorkspaceView {
  return {
    ...applyContainerItemDesktopExtraction(workspace, containerId, itemId, patches),
    schemaVersion: workspace.schemaVersion,
    dataVersion: workspace.dataVersion,
    categoryOrder: workspace.categoryOrder,
  }
}

function buildDesktopPatchMap(patches: DesktopGridLayoutPatch[]): Map<string, DesktopGridLayoutPatch> {
  const patchByKey = new Map<string, DesktopGridLayoutPatch>()
  for (const patch of patches) {
    const key = `${patch.kind}:${patch.id}`
    if (patchByKey.has(key)) throw new Error(`duplicate desktop layout patch: ${key}`)
    patchByKey.set(key, patch)
  }
  return patchByKey
}

function moveItemToDesktop(item: CollectionItem, layout: CollectionItem['layout']): CollectionItem {
  const nextItem = { ...item, layout }
  delete nextItem.containerId
  delete nextItem.containerLayout
  return nextItem
}
