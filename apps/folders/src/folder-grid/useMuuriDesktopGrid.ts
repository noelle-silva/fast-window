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
import { FOLDER_GRID_MIN_HEIGHT, FOLDER_GRID_PADDING } from './constants'
import {
  buildFolderGridLayoutMap,
  diffFolderGridLayouts,
  getFolderGridColumnCount,
  getFolderGridLayoutFromPixel,
  getFolderGridPixelRect,
  resolveFolderGridDragLayout,
  type FolderGridLayoutMap,
  type FolderGridLayoutPatch,
  type FolderGridLayoutSource,
} from './layout'

const MUURI_ITEM_CLASS = 'folders-grid-muuri-item'
const MUURI_ITEM_SELECTOR = `.${MUURI_ITEM_CLASS}`

type DragSession = { itemId: string; offsetX: number; offsetY: number }

type PendingPreview = { itemId: string; targetLayout: FolderGridLayout }

type Options = {
  items: FolderGridLayoutSource[]
  onCommit(patches: FolderGridLayoutPatch[]): void
}

function readLayoutNumber(el: HTMLElement | undefined, key: string): number {
  const raw = Number(el?.dataset[key] ?? 0)
  return Number.isFinite(raw) ? raw : 0
}

function createMuuriLayout(): LayoutFunction {
  return (_grid, layoutId, items, _width, _height, callback) => {
    const slots: number[] = []
    let maxBottom = FOLDER_GRID_MIN_HEIGHT

    for (const item of items) {
      const el = item.getElement()
      const rect = getFolderGridPixelRect({
        x: readLayoutNumber(el, 'layoutX'),
        y: readLayoutNumber(el, 'layoutY'),
      })
      slots.push(rect.left, rect.top)
      maxBottom = Math.max(maxBottom, rect.top + rect.height + FOLDER_GRID_PADDING)
    }

    callback({
      id: layoutId,
      items,
      slots,
      styles: { height: `${maxBottom}px` },
    })
  }
}

function shouldStartDesktopIconDrag(item: MuuriItem, event: DraggerEvent): boolean | undefined {
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

function syncMuuriItemsWithRenderedElements(grid: Muuri, containerNode: HTMLDivElement): void {
  const renderedElements = getRenderedMuuriElements(containerNode)
  const renderedElementSet = new Set(renderedElements)

  const staleItems = grid.getItems().filter(item => {
    const element = item.getElement()
    return !element || !renderedElementSet.has(element)
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

export function useMuuriDesktopGrid(options: Options) {
  const { items, onCommit } = options
  const [gridNode, setGridNode] = React.useState<HTMLDivElement | null>(null)
  const [containerWidth, setContainerWidth] = React.useState(0)
  const [draggingId, setDraggingId] = React.useState<string | null>(null)
  const [previewLayouts, setPreviewLayouts] = React.useState<FolderGridLayoutMap | null>(null)
  const gridInstanceRef = React.useRef<Muuri | null>(null)
  const dragSessionRef = React.useRef<DragSession | null>(null)
  const previewFrameRef = React.useRef<number | null>(null)
  const pendingPreviewRef = React.useRef<PendingPreview | null>(null)
  const latestPreviewRef = React.useRef<FolderGridLayoutMap | null>(null)
  const suppressClickRef = React.useRef<string | null>(null)
  const layout = React.useMemo(() => createMuuriLayout(), [])
  const columnCount = React.useMemo(() => getFolderGridColumnCount(containerWidth), [containerWidth])
  const baseLayouts = React.useMemo(() => buildFolderGridLayoutMap(items, columnCount), [columnCount, items])
  const activeLayouts = previewLayouts || baseLayouts
  const positionSignature = React.useMemo(
    () => items.map(item => {
      const itemLayout = activeLayouts.get(item.id)
      return `${item.id}:${itemLayout?.x ?? 0},${itemLayout?.y ?? 0}`
    }).join('|'),
    [activeLayouts, items],
  )
  const itemSignature = React.useMemo(() => items.map(item => item.id).join('|'), [items])
  const liveRef = React.useRef({ items, columnCount, baseLayouts, onCommit })
  liveRef.current = { items, columnCount, baseLayouts, onCommit }

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
    setPreviewLayouts(null)
    setDraggingId(null)
  }, [baseLayouts])

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
    const nextPreview = resolveFolderGridDragLayout(current.items, current.baseLayouts, pending.itemId, pending.targetLayout, current.columnCount)
    latestPreviewRef.current = nextPreview
    setPreviewLayouts(nextPreview)
  }, [])

  const schedulePreview = React.useCallback((itemId: string, targetLayout: FolderGridLayout) => {
    pendingPreviewRef.current = { itemId, targetLayout }
    if (previewFrameRef.current != null) return
    previewFrameRef.current = window.requestAnimationFrame(flushPreview)
  }, [flushPreview])

  const cancelDrag = React.useCallback(() => {
    cancelPreviewFrame()
    pendingPreviewRef.current = null
    latestPreviewRef.current = null
    dragSessionRef.current = null
    setPreviewLayouts(null)
    setDraggingId(null)
  }, [cancelPreviewFrame])

  React.useEffect(() => {
    if (!gridNode) return

    const grid = new Muuri(gridNode, {
      items: MUURI_ITEM_SELECTOR,
      layout,
      layoutOnResize: false,
      layoutDuration: 180,
      layoutEasing: 'ease',
      dragEnabled: true,
      dragSort: false,
      dragAxis: 'xy',
      dragStartPredicate: shouldStartDesktopIconDrag,
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

      const rect = element.getBoundingClientRect()
      dragSessionRef.current = {
        itemId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      }
      setDraggingId(itemId)
    }

    const handleDragMove = (_item: MuuriItem, event: DraggerMoveEvent) => {
      const dragSession = dragSessionRef.current
      if (!dragSession || !gridNode) return

      autoScrollDuringDrag(gridNode, event.clientY)
      const current = liveRef.current
      const gridRect = gridNode.getBoundingClientRect()
      const targetLayout = getFolderGridLayoutFromPixel(
        event.clientX - gridRect.left - dragSession.offsetX,
        event.clientY - gridRect.top - dragSession.offsetY,
        current.columnCount,
      )
      schedulePreview(dragSession.itemId, targetLayout)
    }

    const handleDragEnd = () => {
      if (previewFrameRef.current != null) {
        window.cancelAnimationFrame(previewFrameRef.current)
        flushPreview()
      }

      const itemId = dragSessionRef.current?.itemId || null
      const current = liveRef.current
      const nextLayouts = latestPreviewRef.current || current.baseLayouts
      const patches = diffFolderGridLayouts(current.baseLayouts, nextLayouts)
      if (patches.length) current.onCommit(patches)
      if (itemId) {
        suppressClickRef.current = itemId
        window.setTimeout(() => {
          if (suppressClickRef.current === itemId) suppressClickRef.current = null
        }, 180)
      }

      pendingPreviewRef.current = null
      latestPreviewRef.current = null
      dragSessionRef.current = null
      setPreviewLayouts(null)
      setDraggingId(null)
    }

    const handleDragEndEvent = (_item: MuuriItem, event: DraggerEndEvent | DraggerCancelEvent) => {
      if (event.type === 'cancel') cancelDrag()
      else handleDragEnd()
    }

    grid.on('dragStart', handleDragStart)
    grid.on('dragMove', handleDragMove)
    grid.on('dragEnd', handleDragEndEvent)
    gridInstanceRef.current = grid

    return () => {
      grid.off('dragStart', handleDragStart)
      grid.off('dragMove', handleDragMove)
      grid.off('dragEnd', handleDragEndEvent)
      cancelDrag()
      grid.destroy()
      gridInstanceRef.current = null
    }
  }, [cancelDrag, flushPreview, gridNode, layout, schedulePreview])

  React.useLayoutEffect(() => {
    const grid = gridInstanceRef.current
    if (!grid || !gridNode || draggingId) return
    syncMuuriItemsWithRenderedElements(grid, gridNode)
    grid.synchronize()
    grid.refreshItems().layout()
  }, [draggingId, gridNode, itemSignature])

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
    columnCount,
    containerWidth,
    draggingId,
    muuriItemClassName: MUURI_ITEM_CLASS,
    setGridNode,
    consumeSuppressedClick,
  }
}
