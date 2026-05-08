import * as React from 'react'
import type { FolderItem } from '../types'
import {
  buildFolderGridLayoutMap,
  diffFolderGridLayouts,
  getFolderGridColumnCount,
  getFolderGridLayoutFromPixel,
  getFolderGridPixelRect,
  resolveFolderGridDragLayout,
  type FolderGridLayoutMap,
  type FolderGridLayoutPatch,
} from './layout'

type DragSession = {
  itemId: string
  pointerId: number
  startX: number
  startY: number
  offsetX: number
  offsetY: number
  started: boolean
}

type Options = {
  items: FolderItem[]
  containerWidth: number
  onCommit(patches: FolderGridLayoutPatch[]): void
}

function pointerDistance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by)
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
  const maxStep = 32
  let delta = 0
  if (clientY > rect.bottom - edgeSize) delta = ((clientY - (rect.bottom - edgeSize)) / edgeSize) * maxStep
  else if (clientY < rect.top + edgeSize) delta = -(((rect.top + edgeSize) - clientY) / edgeSize) * maxStep
  if (delta) scrollEl.scrollTop += Math.trunc(delta)
}

export function useFolderGridEditor(options: Options) {
  const { items, containerWidth, onCommit } = options
  const gridRef = React.useRef<HTMLDivElement | null>(null)
  const cleanupRef = React.useRef<null | (() => void)>(null)
  const latestPreviewRef = React.useRef<FolderGridLayoutMap | null>(null)
  const suppressClickRef = React.useRef<string | null>(null)
  const [draggingId, setDraggingId] = React.useState<string | null>(null)
  const [previewLayouts, setPreviewLayouts] = React.useState<FolderGridLayoutMap | null>(null)

  const columnCount = React.useMemo(() => getFolderGridColumnCount(containerWidth), [containerWidth])
  const baseLayouts = React.useMemo(() => buildFolderGridLayoutMap(items, columnCount), [columnCount, items])
  const activeLayouts = previewLayouts || baseLayouts

  const liveRef = React.useRef({ items, columnCount, baseLayouts, onCommit })
  liveRef.current = { items, columnCount, baseLayouts, onCommit }

  React.useEffect(() => {
    latestPreviewRef.current = null
    setPreviewLayouts(null)
    setDraggingId(null)
  }, [baseLayouts])

  React.useEffect(() => {
    return () => {
      cleanupRef.current?.()
      document.body.style.userSelect = ''
    }
  }, [])

  const clearDrag = React.useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
    latestPreviewRef.current = null
    setPreviewLayouts(null)
    setDraggingId(null)
    document.body.style.userSelect = ''
  }, [])

  const beginDrag = React.useCallback((item: FolderItem, event: React.PointerEvent) => {
    if (event.button !== 0) return
    if (event.target instanceof Element && event.target.closest('[data-folder-grid-no-drag="1"]')) return
    const node = gridRef.current
    const layout = activeLayouts.get(item.id)
    if (!node || !layout) return

    event.stopPropagation()

    const gridRect = node.getBoundingClientRect()
    const itemRect = getFolderGridPixelRect(layout)
    const session: DragSession = {
      itemId: item.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - gridRect.left - itemRect.left,
      offsetY: event.clientY - gridRect.top - itemRect.top,
      started: false,
    }

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== session.pointerId) return
      const currentNode = gridRef.current
      if (!currentNode) return
      if (!session.started) {
        if (pointerDistance(session.startX, session.startY, moveEvent.clientX, moveEvent.clientY) < 4) return
        session.started = true
        document.body.style.userSelect = 'none'
        setDraggingId(session.itemId)
      }

      autoScrollDuringDrag(currentNode, moveEvent.clientY)
      const currentGridRect = currentNode.getBoundingClientRect()
      const current = liveRef.current
      const targetLayout = getFolderGridLayoutFromPixel(
        moveEvent.clientX - currentGridRect.left - session.offsetX,
        moveEvent.clientY - currentGridRect.top - session.offsetY,
        current.columnCount,
      )
      const nextPreview = resolveFolderGridDragLayout(current.items, current.baseLayouts, session.itemId, targetLayout, current.columnCount)
      latestPreviewRef.current = nextPreview
      setPreviewLayouts(nextPreview)
    }

    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== session.pointerId) return
      cleanupRef.current?.()
      cleanupRef.current = null
      document.body.style.userSelect = ''

      if (session.started) {
        suppressClickRef.current = session.itemId
        window.setTimeout(() => {
          if (suppressClickRef.current === session.itemId) suppressClickRef.current = null
        }, 180)

        const current = liveRef.current
        const nextLayouts = latestPreviewRef.current || current.baseLayouts
        const patches = diffFolderGridLayouts(current.baseLayouts, nextLayouts)
        if (patches.length) current.onCommit(patches)
      }

      latestPreviewRef.current = null
      setPreviewLayouts(null)
      setDraggingId(null)
    }

    cleanupRef.current?.()
    cleanupRef.current = () => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
    }

    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
  }, [activeLayouts])

  const consumeSuppressedClick = React.useCallback((itemId: string): boolean => {
    if (suppressClickRef.current !== itemId) return false
    suppressClickRef.current = null
    return true
  }, [])

  return {
    gridRef,
    columnCount,
    layouts: activeLayouts,
    draggingId,
    beginDrag,
    consumeSuppressedClick,
    clearDrag,
  }
}
