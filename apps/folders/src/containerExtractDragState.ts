import type { DesktopGridLayoutPatch } from './folder-grid/desktopEntries'
import type { DesktopContainer, FolderItem, FoldersDoc } from './types'

export type ContainerExtractDragMode = 'container' | 'desktop'

export type ContainerExtractDragState = {
  containerId: string
  desktopDrop?: ContainerExtractDesktopDrop
  item: FolderItem
  mode: ContainerExtractDragMode
} | null

export type ContainerExtractDesktopDrop = {
  item: FolderItem
  clientX: number
  clientY: number
  offsetX: number
  offsetY: number
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

export function isContainerSoftClosedForExtractDrag(drag: ContainerExtractDragState, container: DesktopContainer | null): boolean {
  return Boolean(drag && container && drag.containerId === container.id && drag.mode === 'desktop')
}

export function applyContainerItemDesktopExtraction(doc: FoldersDoc, containerId: string, itemId: string, patches: DesktopGridLayoutPatch[]): FoldersDoc {
  const desktopPatchByKey = buildDesktopPatchMap(patches)
  const movedPatch = desktopPatchByKey.get(`folder:${itemId}`)
  if (!movedPatch) throw new Error(`desktop extraction layout missing for folder: ${itemId}`)
  const appliedPatchKeys = new Set<string>()
  let movedFound = false

  const nextDoc = {
    ...doc,
    items: doc.items.map(item => {
      const key = `folder:${item.id}`
      const patch = desktopPatchByKey.get(key)
      if (item.id === itemId) {
        if (item.containerId !== containerId) throw new Error(`folder is not in container ${containerId}: ${item.id}`)
        movedFound = true
        appliedPatchKeys.add(key)
        return moveItemToDesktop(item, movedPatch.layout)
      }
      if (patch && item.containerId) throw new Error(`folder is not on desktop: ${item.id}`)
      if (patch) appliedPatchKeys.add(key)
      return patch ? { ...item, layout: patch.layout } : item
    }),
    containers: doc.containers.map(container => {
      const key = `container:${container.id}`
      const patch = desktopPatchByKey.get(key)
      if (patch) appliedPatchKeys.add(key)
      return patch ? { ...container, layout: patch.layout } : container
    }),
  }
  if (!movedFound) throw new Error(`folder not found: ${itemId}`)
  for (const key of desktopPatchByKey.keys()) {
    if (!appliedPatchKeys.has(key)) throw new Error(`desktop entry not found: ${key}`)
  }
  return nextDoc
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

function moveItemToDesktop(item: FolderItem, layout: FolderItem['layout']): FolderItem {
  const nextItem = { ...item, layout }
  delete nextItem.containerId
  delete nextItem.containerLayout
  return nextItem
}
