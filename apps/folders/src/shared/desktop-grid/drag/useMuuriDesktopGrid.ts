import * as React from 'react'
import Muuri, {
  type DraggerCancelEvent,
  type DraggerEndEvent,
  type DraggerEvent,
  type DraggerMoveEvent,
  type Item as MuuriItem,
  type LayoutFunction,
} from 'muuri'
import { DESKTOP_GRID_MIN_HEIGHT, DESKTOP_GRID_PADDING } from '../core/constants'
import type { DesktopGridDragEndResult, DesktopGridDragMode, DesktopGridDragModifiers } from '../core/dragTypes'
import type { DesktopGridLayout, DesktopGridLayoutPatch } from '../core/types'
import {
  buildDesktopGridLayoutMap,
  diffDesktopGridLayouts,
  getDesktopGridColumnCount,
  getDesktopGridLayoutFromPixel,
  getDesktopGridPixelRect,
  resolveDesktopGridOverlayLayout,
  resolveDesktopGridDragLayout,
  type DesktopGridLayoutMap,
  type DesktopGridLayoutSource,
} from '../core/layout'
import { getDesktopGridDragMode, getDesktopGridDragModifiers, useDesktopGridDragModifierState } from './dragModifiers'
import { clearDragWheelTarget, projectDragWheel, setDragWheelTarget, type DragWheelTarget } from './dragScroll'
import { useTransientDragLayouts } from './useTransientDragLayouts'

const MUURI_ITEM_CLASS = 'desktop-grid-muuri-item'
const MUURI_ITEM_SELECTOR = `.${MUURI_ITEM_CLASS}`

export type MuuriDesktopGridDragEvent = {
  itemId: string
  clientX: number
  clientY: number
  offsetX: number
  offsetY: number
  dragMode: DesktopGridDragMode
  modifiers: DesktopGridDragModifiers
  targetLayout?: DesktopGridLayout
}

type DragSession = { itemId: string; offsetX: number; offsetY: number; dragMode: DesktopGridDragMode; modifiers: DesktopGridDragModifiers }
type PendingPreview = { itemId: string; dragMode: DesktopGridDragMode; targetLayout: DesktopGridLayout }
type PendingDragCommit = { itemId: string; event: MuuriDesktopGridDragEvent; patches: DesktopGridLayoutPatch[]; suppressClick: boolean }

type Options = {
  enableOverlayDrag?: boolean
  items: DesktopGridLayoutSource[]
  renderedItemIds?: string[]
  onCommit(patches: DesktopGridLayoutPatch[]): void
  onDragCancel?(event: MuuriDesktopGridDragEvent): void
  onDragEnd?(event: MuuriDesktopGridDragEvent, patches: DesktopGridLayoutPatch[]): DesktopGridDragEndResult | void
  onDragMove?(event: MuuriDesktopGridDragEvent): void
  onDragStart?(event: MuuriDesktopGridDragEvent): void
}

function muuriItemId(item: MuuriItem): string {
  return String(item.getElement()?.dataset.entryKey || '').trim()
}

function createMuuriLayout(layoutsRef: React.MutableRefObject<DesktopGridLayoutMap>): LayoutFunction {
  return (_grid, layoutId, items, _width, _height, callback) => {
    const slots: number[] = []
    let maxBottom = DESKTOP_GRID_MIN_HEIGHT

    for (const item of items) {
      const itemId = muuriItemId(item)
      const layout = layoutsRef.current.get(itemId)
      const position = item.getPosition()
      const rect = layout ? getDesktopGridPixelRect(layout) : { left: position.left, top: position.top, width: item.getWidth(), height: item.getHeight() }
      slots.push(rect.left, rect.top)
      maxBottom = Math.max(maxBottom, rect.top + rect.height + DESKTOP_GRID_PADDING)
    }

    callback({
      id: layoutId,
      items,
      slots,
      styles: { height: `${maxBottom}px` },
    })
  }
}

function shouldStartDesktopGridDrag(item: MuuriItem, event: DraggerEvent): boolean | undefined {
  const options = { distance: 6, delay: 0 }
  if (event.isFinal) {
    Muuri.ItemDrag.defaultStartPredicate(item, event, options)
    return undefined
  }

  const target = event.target
  if (target?.closest('[data-desktop-grid-no-drag="1"]')) return false
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

function toDragEvent(session: DragSession, clientX: number, clientY: number, targetLayout?: DesktopGridLayout): MuuriDesktopGridDragEvent {
  return { itemId: session.itemId, clientX, clientY, offsetX: session.offsetX, offsetY: session.offsetY, dragMode: session.dragMode, modifiers: session.modifiers, targetLayout }
}

function resolvePreviewLayouts(
  items: DesktopGridLayoutSource[],
  baseLayouts: DesktopGridLayoutMap,
  itemId: string,
  dragMode: DesktopGridDragMode,
  targetLayout: DesktopGridLayout,
  columnCount: number,
): DesktopGridLayoutMap {
  if (dragMode === 'overlay') return resolveDesktopGridOverlayLayout(baseLayouts, itemId, targetLayout, columnCount)
  return resolveDesktopGridDragLayout(items, baseLayouts, itemId, targetLayout, columnCount)
}

function normalizeDragEndResult(result: DesktopGridDragEndResult | void): { handled: boolean; clearReleaseLayouts: boolean } {
  if (typeof result === 'object' && result) return { handled: result.handled, clearReleaseLayouts: Boolean(result.clearReleaseLayouts) }
  return { handled: result === true, clearReleaseLayouts: false }
}

export function useMuuriDesktopGrid(options: Options) {
  const { enableOverlayDrag = false, items, renderedItemIds, onCommit, onDragCancel, onDragEnd, onDragMove, onDragStart } = options
  const [gridNode, setGridNode] = React.useState<HTMLDivElement | null>(null)
  const [containerWidth, setContainerWidth] = React.useState(0)
  const [draggingId, setDraggingId] = React.useState<string | null>(null)
  const gridInstanceRef = React.useRef<Muuri | null>(null)
  const dragSessionRef = React.useRef<DragSession | null>(null)
  const previewFrameRef = React.useRef<number | null>(null)
  const pendingPreviewRef = React.useRef<PendingPreview | null>(null)
  const latestPreviewRef = React.useRef<DesktopGridLayoutMap | null>(null)
  const keyboardModifiersRef = useDesktopGridDragModifierState()
  const suppressClickRef = React.useRef<string | null>(null)
  const pendingDragCommitRef = React.useRef<PendingDragCommit | null>(null)
  const dragWheelTargetRef = React.useRef<DragWheelTarget<MuuriItem> | null>(null)
  const columnCount = React.useMemo(() => getDesktopGridColumnCount(containerWidth), [containerWidth])
  const baseLayouts = React.useMemo(() => buildDesktopGridLayoutMap(items, columnCount), [columnCount, items])
  const {
    activeLayouts,
    activeLayoutsRef,
    clearPreviewLayouts,
    clearReleaseLayouts,
    lockReleaseLayouts,
    resetTransientLayouts,
    setPreviewLayouts,
  } = useTransientDragLayouts(baseLayouts)
  const layout = React.useMemo(() => createMuuriLayout(activeLayoutsRef), [activeLayoutsRef])
  const positionSignature = React.useMemo(
    () => items.map(item => {
      const itemLayout = activeLayouts.get(item.id)
      return `${item.id}:${itemLayout?.x ?? 0},${itemLayout?.y ?? 0}`
    }).join('|'),
    [activeLayouts, items],
  )
  const itemSignature = React.useMemo(() => items.map(item => item.id).join('|'), [items])
  const renderedItemSignature = React.useMemo(() => (renderedItemIds || items.map(item => item.id)).join('|'), [items, renderedItemIds])
  const liveRef = React.useRef({ enableOverlayDrag, items, columnCount, baseLayouts, onCommit, onDragCancel, onDragEnd, onDragMove, onDragStart })
  liveRef.current = { enableOverlayDrag, items, columnCount, baseLayouts, onCommit, onDragCancel, onDragEnd, onDragMove, onDragStart }

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
    clearDragWheelTarget(dragWheelTargetRef)
    resetTransientLayouts()
    setDraggingId(null)
  }, [baseLayouts, resetTransientLayouts])

  const cancelPreviewFrame = React.useCallback(() => {
    if (previewFrameRef.current == null) return
    window.cancelAnimationFrame(previewFrameRef.current)
    previewFrameRef.current = null
  }, [])

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

  const schedulePreview = React.useCallback((itemId: string, dragMode: DesktopGridDragMode, targetLayout: DesktopGridLayout) => {
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
    clearDragWheelTarget(dragWheelTargetRef)
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
      dragStartPredicate: shouldStartDesktopGridDrag,
      dragRelease: { duration: 180, easing: 'ease', useDragContainer: true },
    })

    const handleDragStart = (item: MuuriItem, event: DraggerMoveEvent) => {
      const element = item.getElement()
      const itemId = String(element?.dataset.entryKey || '').trim()
      if (!element || !itemId) return

      clearReleaseLayouts()
      const rect = element.getBoundingClientRect()
      const current = liveRef.current
      const modifiers = getDesktopGridDragModifiers(event, keyboardModifiersRef.current)
      const session = { itemId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, modifiers, dragMode: current.enableOverlayDrag ? getDesktopGridDragMode(modifiers) : 'reflow' }
      dragSessionRef.current = session
      setDragWheelTarget(dragWheelTargetRef, item, event.clientX, event.clientY)
      setDraggingId(itemId)
      liveRef.current.onDragStart?.(toDragEvent(session, event.clientX, event.clientY))
    }

    const updateDragProjection = (item: MuuriItem, clientX: number, clientY: number, modifiers: DesktopGridDragModifiers) => {
      const dragSession = dragSessionRef.current
      if (!dragSession || !gridNode) return

      const current = liveRef.current
      const dragMode = current.enableOverlayDrag ? getDesktopGridDragMode(modifiers) : 'reflow'
      const gridRect = gridNode.getBoundingClientRect()
      const itemRect = item.getElement()?.getBoundingClientRect()
      const targetLayout = getDesktopGridLayoutFromPixel(
        (itemRect?.left ?? clientX - dragSession.offsetX) - gridRect.left,
        (itemRect?.top ?? clientY - dragSession.offsetY) - gridRect.top,
        current.columnCount,
      )
      dragSession.modifiers = modifiers
      dragSession.dragMode = dragMode
      liveRef.current.onDragMove?.(toDragEvent(dragSession, clientX, clientY, targetLayout))
      schedulePreview(dragSession.itemId, dragMode, targetLayout)
    }

    const handleDragMove = (item: MuuriItem, event: DraggerMoveEvent) => {
      const dragSession = dragSessionRef.current
      if (!dragSession || !gridNode) return

      setDragWheelTarget(dragWheelTargetRef, item, event.clientX, event.clientY)
      const modifiers = getDesktopGridDragModifiers(event, keyboardModifiersRef.current)
      updateDragProjection(item, event.clientX, event.clientY, modifiers)
    }

    const handleDragWheel = (event: WheelEvent) => {
      if (!dragSessionRef.current || !gridNode) return
      projectDragWheel(gridNode, dragWheelTargetRef.current, event, (item, clientX, clientY, wheelEvent) => {
        updateDragProjection(item, clientX, clientY, getDesktopGridDragModifiers(wheelEvent, keyboardModifiersRef.current))
      })
    }

    const handleDragEnd = (event: DraggerEndEvent) => {
      if (previewFrameRef.current != null) {
        window.cancelAnimationFrame(previewFrameRef.current)
        flushPreview()
      }

      const dragSession = dragSessionRef.current
      const current = liveRef.current
      const nextLayouts = latestPreviewRef.current || current.baseLayouts
      const patches = diffDesktopGridLayouts(current.baseLayouts, nextLayouts)
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
      clearDragWheelTarget(dragWheelTargetRef)
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
    document.addEventListener('wheel', handleDragWheel, { capture: true, passive: false })
    gridInstanceRef.current = grid

    return () => {
      grid.off('dragStart', handleDragStart)
      grid.off('dragMove', handleDragMove)
      grid.off('dragEnd', handleDragEndEvent)
      grid.off('dragReleaseEnd', handleDragReleaseEnd)
      document.removeEventListener('wheel', handleDragWheel, { capture: true })
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
  }, [draggingId, gridNode, itemSignature, renderedItemSignature])

  React.useLayoutEffect(() => {
    gridInstanceRef.current?.layout()
  }, [draggingId, positionSignature])

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
    consumeSuppressedClick,
  }
}
