import * as React from 'react'
import Muuri, {
  type DraggerCancelEvent,
  type DraggerEndEvent,
  type DraggerEvent,
  type DraggerMoveEvent,
  type Item as MuuriItem,
  type LayoutFunction,
} from 'muuri'
import type { FolderGridLayout } from '../types'
import type { DesktopGridDragMode, DesktopGridDragModifiers, DesktopGridDragEndResult } from '../shared/desktop-grid/core/dragTypes'
import { getDesktopGridDragMode, getDesktopGridDragModifiers, useDesktopGridDragModifierState } from '../shared/desktop-grid/drag/dragModifiers'
import { useTransientDragLayouts } from '../shared/desktop-grid/drag/useTransientDragLayouts'
import {
  buildFolderGridLayoutMap,
  diffFolderGridLayouts,
  getFolderGridColumnCount,
  getFolderGridLayoutFromPixel,
  getFolderGridPixelRect,
  resolveFolderGridOverlayLayout,
  resolveFolderGridDragLayout,
  type FolderGridLayoutMap,
  type FolderGridLayoutPatch,
  type FolderGridLayoutSource,
} from './layout'
import { DEFAULT_FOLDER_GRID_METRICS, type FolderGridMetrics } from './iconLayout'

const MUURI_ITEM_CLASS = 'folders-grid-muuri-item'
const MUURI_ITEM_SELECTOR = `.${MUURI_ITEM_CLASS}`

export type FolderGridDragEvent = {
  itemId: string
  clientX: number
  clientY: number
  offsetX: number
  offsetY: number
  dragMode: DesktopGridDragMode
  modifiers: DesktopGridDragModifiers
  targetLayout?: FolderGridLayout
}

type DragSession = { itemId: string; offsetX: number; offsetY: number; dragMode: DesktopGridDragMode; modifiers: DesktopGridDragModifiers }

type PendingPreview = { itemId: string; dragMode: DesktopGridDragMode; targetLayout: FolderGridLayout }

type PendingDragCommit = {
  itemId: string
  event: FolderGridDragEvent
  patches: FolderGridLayoutPatch[]
  suppressClick: boolean
}

export type FolderGridDragEndResult = DesktopGridDragEndResult

type Options = {
  enableOverlayDrag?: boolean
  items: FolderGridLayoutSource[]
  metrics?: FolderGridMetrics
  renderedItemIds?: string[]
  onCommit(patches: FolderGridLayoutPatch[]): void
  onDragCancel?(event: FolderGridDragEvent): void
  onDragEnd?(event: FolderGridDragEvent, patches: FolderGridLayoutPatch[]): FolderGridDragEndResult | void
  onDragMove?(event: FolderGridDragEvent): void
  onDragStart?(event: FolderGridDragEvent): void
}

function muuriItemId(item: MuuriItem): string {
  return String(item.getElement()?.dataset.entryKey || '').trim()
}

function createMuuriLayout(layoutsRef: React.MutableRefObject<FolderGridLayoutMap>, metricsRef: React.MutableRefObject<FolderGridMetrics>): LayoutFunction {
  return (_grid, layoutId, items, _width, _height, callback) => {
    const slots: number[] = []
    const metrics = metricsRef.current
    let maxBottom = metrics.minHeight

    for (const item of items) {
      const itemId = muuriItemId(item)
      const layout = layoutsRef.current.get(itemId)
      const position = item.getPosition()
      const rect = layout ? getFolderGridPixelRect(layout, metrics) : { left: position.left, top: position.top, width: item.getWidth(), height: item.getHeight() }
      slots.push(rect.left, rect.top)
      maxBottom = Math.max(maxBottom, rect.top + rect.height + metrics.padding)
    }

    callback({
      id: layoutId,
      items,
      slots,
      styles: { height: `${maxBottom}px` },
    })
  }
}

function shouldStartFolderGridDrag(item: MuuriItem, event: DraggerEvent): boolean | undefined {
  const options = { distance: 6, delay: 0 }

  if (event.isFinal) {
    Muuri.ItemDrag.defaultStartPredicate(item, event, options)
    return undefined
  }

  const target = event.target
  if (target?.closest('[data-folder-grid-no-drag="1"]')) return false
  return Muuri.ItemDrag.defaultStartPredicate(item, event, options)
}

function getRenderedMuuriElements(containerNode: HTMLDivElement): HTMLElement[] {
  return Array.from(containerNode.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains(MUURI_ITEM_CLASS))
}

function syncMuuriItemsWithRenderedElements(grid: Muuri, containerNode: HTMLDivElement, expectedItemIds: string[]): void {
  const renderedElements = getRenderedMuuriElements(containerNode)
  const renderedElementSet = new Set(renderedElements)
  const expectedItemIdSet = new Set(expectedItemIds)

  const staleItems = grid.getItems().filter(item => {
    const element = item.getElement()
    const itemId = muuriItemId(item)
    return !element || (!renderedElementSet.has(element) && !expectedItemIdSet.has(itemId))
  })
  if (staleItems.length) grid.remove(staleItems, { removeElements: false, layout: false })

  const knownElements = new Set(grid.getItems().map(item => item.getElement()).filter((element): element is HTMLElement => Boolean(element)))
  const addedElements = renderedElements.filter(el => !knownElements.has(el))
  if (addedElements.length) grid.add(addedElements, { layout: false })
}

function findScrollableParent(el: HTMLElement): HTMLElement | null {
  let current = el.parentElement
  while (current) {
    const style = window.getComputedStyle(current)
    if (/(auto|scroll)/.test(style.overflowY)) return current
    current = current.parentElement
  }
  return null
}

function autoScrollDuringDrag(containerNode: HTMLElement, clientY: number): void {
  const scrollEl = findScrollableParent(containerNode)
  if (!scrollEl) return

  const rect = scrollEl.getBoundingClientRect()
  const edgeSize = Math.min(120, Math.max(64, rect.height * 0.18))
  const maxStep = 34
  let delta = 0

  if (clientY > rect.bottom - edgeSize) {
    delta = ((clientY - (rect.bottom - edgeSize)) / edgeSize) * maxStep
  } else if (clientY < rect.top + edgeSize) {
    delta = -(((rect.top + edgeSize) - clientY) / edgeSize) * maxStep
  }

  if (delta) scrollEl.scrollTop += Math.trunc(delta)
}

function toDragEvent(session: DragSession, clientX: number, clientY: number, targetLayout?: FolderGridLayout): FolderGridDragEvent {
  return {
    itemId: session.itemId,
    clientX,
    clientY,
    offsetX: session.offsetX,
    offsetY: session.offsetY,
    dragMode: session.dragMode,
    modifiers: session.modifiers,
    targetLayout,
  }
}

function resolvePreviewLayouts(
  items: FolderGridLayoutSource[],
  baseLayouts: FolderGridLayoutMap,
  itemId: string,
  dragMode: DesktopGridDragMode,
  targetLayout: FolderGridLayout,
  columnCount: number,
): FolderGridLayoutMap {
  if (dragMode === 'overlay') return resolveFolderGridOverlayLayout(baseLayouts, itemId, targetLayout, columnCount)
  return resolveFolderGridDragLayout(items, baseLayouts, itemId, targetLayout, columnCount)
}

function normalizeDragEndResult(result: FolderGridDragEndResult | void): { handled: boolean; clearReleaseLayouts: boolean } {
  if (typeof result === 'object' && result) return { handled: result.handled, clearReleaseLayouts: Boolean(result.clearReleaseLayouts) }
  return { handled: result === true, clearReleaseLayouts: false }
}

export function useMuuriFolderGrid(options: Options) {
  const { enableOverlayDrag = false, items, renderedItemIds, onCommit, onDragCancel, onDragEnd, onDragMove, onDragStart } = options
  const metrics = options.metrics || DEFAULT_FOLDER_GRID_METRICS
  const [gridNode, setGridNode] = React.useState<HTMLDivElement | null>(null)
  const [containerWidth, setContainerWidth] = React.useState(0)
  const [draggingId, setDraggingId] = React.useState<string | null>(null)
  const gridInstanceRef = React.useRef<Muuri | null>(null)
  const dragSessionRef = React.useRef<DragSession | null>(null)
  const previewFrameRef = React.useRef<number | null>(null)
  const pendingPreviewRef = React.useRef<PendingPreview | null>(null)
  const latestPreviewRef = React.useRef<FolderGridLayoutMap | null>(null)
  const metricsRef = React.useRef(metrics)
  const keyboardModifiersRef = useDesktopGridDragModifierState()
  const suppressClickRef = React.useRef<string | null>(null)
  const pendingDragCommitRef = React.useRef<PendingDragCommit | null>(null)
  metricsRef.current = metrics
  const columnCount = React.useMemo(() => getFolderGridColumnCount(containerWidth, metrics), [containerWidth, metrics])
  const baseLayouts = React.useMemo(() => buildFolderGridLayoutMap(items, columnCount), [columnCount, items])
  const {
    activeLayouts,
    activeLayoutsRef,
    clearPreviewLayouts,
    clearReleaseLayouts,
    lockReleaseLayouts,
    resetTransientLayouts,
    setProjectedLayouts: setTransientProjectedLayouts,
    setPreviewLayouts,
  } = useTransientDragLayouts(baseLayouts)
  const layout = React.useMemo(() => createMuuriLayout(activeLayoutsRef, metricsRef), [activeLayoutsRef])
  const positionSignature = React.useMemo(
    () => items.map(item => {
      const itemLayout = activeLayouts.get(item.id)
      return `${item.id}:${itemLayout?.x ?? 0},${itemLayout?.y ?? 0}`
    }).join('|'),
    [activeLayouts, items],
  )
  const itemSignature = React.useMemo(() => items.map(item => item.id).join('|'), [items])
  const renderedItemSignature = React.useMemo(() => (renderedItemIds || items.map(item => item.id)).join('|'), [items, renderedItemIds])
  const liveRef = React.useRef({ enableOverlayDrag, items, columnCount, baseLayouts, metrics, onCommit, onDragCancel, onDragEnd, onDragMove, onDragStart })
  liveRef.current = { enableOverlayDrag, items, columnCount, baseLayouts, metrics, onCommit, onDragCancel, onDragEnd, onDragMove, onDragStart }

  React.useLayoutEffect(() => {
    if (!gridNode) {
      setContainerWidth(0)
      return
    }

    const updateWidth = () => setContainerWidth(prev => {
      const next = Math.max(0, gridNode.clientWidth)
      return prev === next ? prev : next
    })
    updateWidth()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth)
      return () => window.removeEventListener('resize', updateWidth)
    }

    const observer = new ResizeObserver(updateWidth)
    observer.observe(gridNode)
    return () => observer.disconnect()
  }, [gridNode])

  React.useEffect(() => {
    latestPreviewRef.current = null
    pendingPreviewRef.current = null
    resetTransientLayouts()
    setDraggingId(null)
  }, [baseLayouts, metrics.signature, resetTransientLayouts])

  const cancelPreviewFrame = React.useCallback(() => {
    if (previewFrameRef.current == null) return
    window.cancelAnimationFrame(previewFrameRef.current)
    previewFrameRef.current = null
  }, [])

  const setProjectedLayouts = React.useCallback((layouts: FolderGridLayoutMap | null) => {
    setTransientProjectedLayouts(layouts)
    gridInstanceRef.current?.layout()
  }, [setTransientProjectedLayouts])

  const flushPreview = React.useCallback(() => {
    previewFrameRef.current = null
    const pending = pendingPreviewRef.current
    pendingPreviewRef.current = null
    if (!pending) return

    const current = liveRef.current
    const dragMode = current.enableOverlayDrag ? pending.dragMode : 'reflow'
    const nextPreview = resolvePreviewLayouts(current.items, current.baseLayouts, pending.itemId, dragMode, pending.targetLayout, current.columnCount)
    latestPreviewRef.current = nextPreview
    setPreviewLayouts(nextPreview)
  }, [])

  const schedulePreview = React.useCallback((itemId: string, dragMode: DesktopGridDragMode, targetLayout: FolderGridLayout) => {
    pendingPreviewRef.current = { itemId, dragMode, targetLayout }
    if (previewFrameRef.current != null) return
    previewFrameRef.current = window.requestAnimationFrame(flushPreview)
  }, [flushPreview])

  const cancelDrag = React.useCallback(() => {
    cancelPreviewFrame()
    pendingPreviewRef.current = null
    latestPreviewRef.current = null
    pendingDragCommitRef.current = null
    dragSessionRef.current = null
    resetTransientLayouts()
    setDraggingId(null)
  }, [cancelPreviewFrame, resetTransientLayouts])

  const commitReleasedDrag = React.useCallback((itemId: string) => {
    const commit = pendingDragCommitRef.current
    if (!commit || commit.itemId !== itemId) return
    pendingDragCommitRef.current = null
    const result = normalizeDragEndResult(liveRef.current.onDragEnd?.(commit.event, commit.patches))
    if (!result.handled && commit.patches.length) liveRef.current.onCommit(commit.patches)
    if (commit.suppressClick) {
      suppressClickRef.current = itemId
      window.setTimeout(() => {
        if (suppressClickRef.current === itemId) suppressClickRef.current = null
      }, 180)
    }
    if (result.clearReleaseLayouts || !commit.patches.length) {
      clearReleaseLayouts()
    }
    setDraggingId(current => current === itemId ? null : current)
  }, [clearReleaseLayouts])

  React.useEffect(() => {
    if (!gridNode) return

    const grid = new Muuri(gridNode, {
      items: MUURI_ITEM_SELECTOR,
      layout,
      layoutOnResize: false,
      layoutDuration: 180,
      layoutEasing: 'ease',
      dragContainer: document.body,
      dragEnabled: true,
      dragSort: false,
      dragAxis: 'xy',
      dragStartPredicate: shouldStartFolderGridDrag,
      dragRelease: {
        duration: 180,
        easing: 'ease',
        useDragContainer: true,
      },
    })

    const handleDragStart = (item: MuuriItem, event: DraggerMoveEvent) => {
      const element = item.getElement()
      const itemId = String(element?.dataset.entryKey || '').trim()
      if (!element || !itemId) return

      clearReleaseLayouts()
      const rect = element.getBoundingClientRect()
      const current = liveRef.current
      const modifiers = getDesktopGridDragModifiers(event, keyboardModifiersRef.current)
      const session = {
        itemId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        modifiers,
        dragMode: current.enableOverlayDrag ? getDesktopGridDragMode(modifiers) : 'reflow',
      }
      dragSessionRef.current = session
      setDraggingId(itemId)
      liveRef.current.onDragStart?.(toDragEvent(session, event.clientX, event.clientY))
    }

    const handleDragMove = (item: MuuriItem, event: DraggerMoveEvent) => {
      const dragSession = dragSessionRef.current
      if (!dragSession || !gridNode) return

      autoScrollDuringDrag(gridNode, event.clientY)
      const current = liveRef.current
      const modifiers = getDesktopGridDragModifiers(event, keyboardModifiersRef.current)
      const dragMode = current.enableOverlayDrag ? getDesktopGridDragMode(modifiers) : 'reflow'
      const gridRect = gridNode.getBoundingClientRect()
      const itemRect = item.getElement()?.getBoundingClientRect()
      const targetLayout = getFolderGridLayoutFromPixel(
        (itemRect?.left ?? event.clientX - dragSession.offsetX) - gridRect.left,
        (itemRect?.top ?? event.clientY - dragSession.offsetY) - gridRect.top,
        current.columnCount,
        current.metrics,
      )
      dragSession.dragMode = dragMode
      dragSession.modifiers = modifiers
      liveRef.current.onDragMove?.(toDragEvent(dragSession, event.clientX, event.clientY, targetLayout))
      schedulePreview(dragSession.itemId, dragMode, targetLayout)
    }

    const handleDragEnd = (event: DraggerEndEvent) => {
      if (previewFrameRef.current != null) {
        window.cancelAnimationFrame(previewFrameRef.current)
        flushPreview()
      }

      const dragSession = dragSessionRef.current
      const current = liveRef.current
      const nextLayouts = latestPreviewRef.current || current.baseLayouts
      const patches = diffFolderGridLayouts(current.baseLayouts, nextLayouts)
      if (dragSession) {
        const modifiers = getDesktopGridDragModifiers(event, keyboardModifiersRef.current)
        dragSession.modifiers = modifiers
        dragSession.dragMode = current.enableOverlayDrag ? getDesktopGridDragMode(modifiers) : 'reflow'
      }
      const dragEvent = dragSession ? toDragEvent(dragSession, event.clientX, event.clientY) : null
      if (dragSession && dragEvent) {
        lockReleaseLayouts(nextLayouts)
        grid.layout()
        pendingDragCommitRef.current = { itemId: dragSession.itemId, event: dragEvent, patches, suppressClick: true }
      } else if (patches.length) {
        clearReleaseLayouts()
        current.onCommit(patches)
      }

      pendingPreviewRef.current = null
      latestPreviewRef.current = null
      dragSessionRef.current = null
      clearPreviewLayouts()
      if (!dragSession) setDraggingId(null)
    }

    const handleDragReleaseEnd = (item: MuuriItem) => {
      const itemId = muuriItemId(item)
      if (itemId) commitReleasedDrag(itemId)
    }

    const handleDragCancel = (event: DraggerCancelEvent) => {
      const dragSession = dragSessionRef.current
      if (dragSession) liveRef.current.onDragCancel?.(toDragEvent(dragSession, event.clientX, event.clientY))
      cancelDrag()
    }

    const handleDragEndEvent = (_item: MuuriItem, event: DraggerEndEvent | DraggerCancelEvent) => {
      if (event.type === 'cancel') handleDragCancel(event)
      else handleDragEnd(event)
    }

    grid.on('dragStart', handleDragStart)
    grid.on('dragMove', handleDragMove)
    grid.on('dragEnd', handleDragEndEvent)
    grid.on('dragReleaseEnd', handleDragReleaseEnd)
    gridInstanceRef.current = grid

    return () => {
      grid.off('dragStart', handleDragStart)
      grid.off('dragMove', handleDragMove)
      grid.off('dragEnd', handleDragEndEvent)
      grid.off('dragReleaseEnd', handleDragReleaseEnd)
      cancelDrag()
      grid.destroy()
      gridInstanceRef.current = null
    }
  }, [cancelDrag, clearPreviewLayouts, clearReleaseLayouts, commitReleasedDrag, flushPreview, gridNode, layout, lockReleaseLayouts, schedulePreview])

  React.useLayoutEffect(() => {
    const grid = gridInstanceRef.current
    if (!grid || !gridNode || draggingId) return
    const expectedItemIds = renderedItemIds || items.map(item => item.id)
    syncMuuriItemsWithRenderedElements(grid, gridNode, expectedItemIds)
    grid.synchronize()
    grid.refreshItems().layout(true)
  }, [draggingId, gridNode, itemSignature, metrics.signature, renderedItemSignature])

  React.useLayoutEffect(() => {
    gridInstanceRef.current?.layout()
  }, [draggingId, metrics.signature, positionSignature])

  const consumeSuppressedClick = React.useCallback((itemId: string): boolean => {
    if (suppressClickRef.current !== itemId) return false
    suppressClickRef.current = null
    return true
  }, [])

  return {
    activeLayouts,
    baseLayouts,
    columnCount,
    containerWidth,
    draggingId,
    gridNode,
    muuriItemClassName: MUURI_ITEM_CLASS,
    setGridNode,
    setProjectedLayouts,
    consumeSuppressedClick,
  }
}
