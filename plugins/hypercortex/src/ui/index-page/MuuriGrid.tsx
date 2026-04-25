import * as React from 'react'
import { Box } from '@mui/material'
import Muuri, { type DraggerCancelEvent, type DraggerEndEvent, type DraggerEvent, type DraggerMoveEvent, type Item as MuuriItem, type LayoutFunction } from 'muuri'

import type { FavoriteItemRef, GridLayout } from '../../favorites'
import { INDEX_GRID_COLUMNS, INDEX_GRID_GAP_PX, INDEX_GRID_ROW_PX } from './constants'
import { getRefFrame, getRefPixelRect } from './helpers'

type Props = {
  refs: FavoriteItemRef[]
  editMode: boolean
  gridRef: React.MutableRefObject<HTMLDivElement | null>
  getLayout: (ref: FavoriteItemRef) => GridLayout
  draggingRefId: string | null
  dropIndicatorLayout: GridLayout | null
  onPreviewDragLayout: (refId: string, patch: Partial<GridLayout>) => void
  onCommitDrag: () => void
  onCancelPreview: () => void
  onDragStateChange: (activeId: string | null) => void
  renderItem: (ref: FavoriteItemRef, dragging: boolean) => React.ReactNode
}

function readLayoutNumber(el: HTMLElement | undefined, key: string): number {
  const raw = Number(el?.dataset[key] ?? 0)
  return Number.isFinite(raw) ? raw : 0
}

function clampGridX(x: number, width: number): number {
  const maxX = Math.max(0, INDEX_GRID_COLUMNS - Math.max(1, width))
  return Math.max(0, Math.min(maxX, x))
}

function computeGridPosition(
  clientX: number,
  clientY: number,
  offsetX: number,
  offsetY: number,
  gridRect: DOMRect,
  gridWidth: number,
  layout: GridLayout,
): { x: number; y: number } {
  const totalGap = INDEX_GRID_GAP_PX * (INDEX_GRID_COLUMNS - 1)
  const colWidth = Math.max(1, (gridWidth - totalGap) / INDEX_GRID_COLUMNS)
  const stepX = colWidth + INDEX_GRID_GAP_PX
  const stepY = INDEX_GRID_ROW_PX + INDEX_GRID_GAP_PX
  const left = clientX - offsetX - gridRect.left
  const top = clientY - offsetY - gridRect.top
  return {
    x: clampGridX(Math.round(left / stepX), layout.w),
    y: Math.max(0, Math.round(top / stepY)),
  }
}

function shouldStartCardDrag(item: MuuriItem, event: DraggerEvent): boolean | undefined {
  const options = { distance: 6, delay: 0 }

  if (event.isFinal) {
    Muuri.ItemDrag.defaultStartPredicate(item, event, options)
    return undefined
  }

  const target = event.target
  if (target?.closest('[data-hc-no-drag="1"]')) return false
  return Muuri.ItemDrag.defaultStartPredicate(item, event, options)
}

function createMuuriLayout(): LayoutFunction {
  return (_grid, layoutId, items, width, _height, callback) => {
    const columnWidth = Math.max(0, (width - INDEX_GRID_GAP_PX * (INDEX_GRID_COLUMNS - 1)) / INDEX_GRID_COLUMNS)
    const stepX = columnWidth + INDEX_GRID_GAP_PX
    const stepY = INDEX_GRID_ROW_PX + INDEX_GRID_GAP_PX
    const slots: number[] = []
    let maxBottom = 0

    for (const item of items) {
      const el = item.getElement()
      const x = readLayoutNumber(el, 'layoutX')
      const y = readLayoutNumber(el, 'layoutY')
      const h = Math.max(1, readLayoutNumber(el, 'layoutH'))
      slots.push(x * stepX, y * stepY)
      maxBottom = Math.max(maxBottom, y + h)
    }

    callback({
      id: layoutId,
      items,
      slots,
      styles: {
        height: maxBottom > 0 ? `${maxBottom * INDEX_GRID_ROW_PX + Math.max(0, maxBottom - 1) * INDEX_GRID_GAP_PX}px` : '0px',
      },
    })
  }
}

export function MuuriGrid(props: Props): React.ReactNode {
  const { refs, editMode, gridRef, getLayout, draggingRefId, dropIndicatorLayout, onPreviewDragLayout, onCommitDrag, onCancelPreview, onDragStateChange, renderItem } = props
  const [containerNode, setContainerNode] = React.useState<HTMLDivElement | null>(null)
  const [containerWidth, setContainerWidth] = React.useState(0)
  const gridInstanceRef = React.useRef<Muuri | null>(null)
  const dragSessionRef = React.useRef<null | { refId: string; offsetX: number; offsetY: number }>(null)
  const previewFrameRef = React.useRef<number | null>(null)
  const pendingPreviewRef = React.useRef<null | { refId: string; patch: Partial<GridLayout> }>(null)
  const liveStateRef = React.useRef({
    refs,
    getLayout,
    containerWidth,
    onPreviewDragLayout,
    onCommitDrag,
    onCancelPreview,
    onDragStateChange,
  })
  const layout = React.useMemo(() => createMuuriLayout(), [])

  liveStateRef.current = {
    refs,
    getLayout,
    containerWidth,
    onPreviewDragLayout,
    onCommitDrag,
    onCancelPreview,
    onDragStateChange,
  }

  const renderedItems = React.useMemo(
    () =>
      refs.map(ref => {
        const resolvedLayout = getLayout(ref)
        return {
          ref,
          layout: resolvedLayout,
          frame: getRefFrame(resolvedLayout, containerWidth),
        }
      }),
    [containerWidth, getLayout, refs],
  )

  const layoutSignature = React.useMemo(
    () => renderedItems.map(({ ref, layout, frame }) => `${ref.id}:${layout.x},${layout.y},${layout.w},${layout.h}:${Math.round(frame.width)}x${Math.round(frame.height)}`).join('|'),
    [renderedItems],
  )

  const positionSignature = React.useMemo(
    () => renderedItems.map(({ ref, layout }) => `${ref.id}:${layout.x},${layout.y}`).join('|'),
    [renderedItems],
  )

  const sizeSignature = React.useMemo(
    () => renderedItems.map(({ ref, frame }) => `${ref.id}:${Math.round(frame.width)}x${Math.round(frame.height)}`).join('|'),
    [renderedItems],
  )

  const flushPreview = React.useCallback(() => {
    previewFrameRef.current = null
    const pending = pendingPreviewRef.current
    pendingPreviewRef.current = null
    if (!pending) return
    liveStateRef.current.onPreviewDragLayout(pending.refId, pending.patch)
  }, [])

  const schedulePreview = React.useCallback(
    (refId: string, patch: Partial<GridLayout>) => {
      pendingPreviewRef.current = { refId, patch }
      if (previewFrameRef.current != null) return
      previewFrameRef.current = window.requestAnimationFrame(flushPreview)
    },
    [flushPreview],
  )

  React.useLayoutEffect(() => {
    if (!containerNode) return

    const updateWidth = () => {
      const nextWidth = Math.max(0, containerNode.clientWidth)
      setContainerWidth(prev => (prev === nextWidth ? prev : nextWidth))
    }

    updateWidth()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth)
      return () => window.removeEventListener('resize', updateWidth)
    }

    const observer = new ResizeObserver(() => updateWidth())
    observer.observe(containerNode)
    return () => observer.disconnect()
  }, [containerNode])

  React.useEffect(() => {
    if (!containerNode) return

    const grid = new Muuri(containerNode, {
      items: '.hc-index-muuri-item',
      layout,
      layoutOnResize: false,
      layoutDuration: 180,
      layoutEasing: 'ease',
      dragEnabled: editMode,
      dragSort: false,
      dragAxis: 'xy',
      dragStartPredicate: shouldStartCardDrag,
      dragRelease: {
        duration: 180,
        easing: 'ease',
        useDragContainer: true,
      },
    })

    const handleDragStart = (item: MuuriItem, event: DraggerMoveEvent) => {
      const element = item.getElement()
      const refId = String(element?.dataset.refId || '').trim()
      if (!element || !refId) return
      const rect = element.getBoundingClientRect()
      dragSessionRef.current = {
        refId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      }
      liveStateRef.current.onDragStateChange(refId)
    }

    const handleDragMove = (_item: MuuriItem, event: DraggerMoveEvent) => {
      const dragSession = dragSessionRef.current
      if (!dragSession || !containerNode) return
      const { refs: currentRefs, getLayout: currentGetLayout, containerWidth: currentContainerWidth } = liveStateRef.current
      const activeRef = currentRefs.find(ref => ref.id === dragSession.refId)
      if (!activeRef) return
      const nextPosition = computeGridPosition(
        event.clientX,
        event.clientY,
        dragSession.offsetX,
        dragSession.offsetY,
        containerNode.getBoundingClientRect(),
        Math.max(1, currentContainerWidth),
        currentGetLayout(activeRef),
      )
      schedulePreview(dragSession.refId, nextPosition)
    }

    const handleDragEnd = () => {
      if (previewFrameRef.current != null) {
        window.cancelAnimationFrame(previewFrameRef.current)
        flushPreview()
      }
      dragSessionRef.current = null
      liveStateRef.current.onCommitDrag()
      liveStateRef.current.onDragStateChange(null)
    }

    const handleDragCancel = () => {
      if (previewFrameRef.current != null) {
        window.cancelAnimationFrame(previewFrameRef.current)
        previewFrameRef.current = null
        pendingPreviewRef.current = null
      }
      dragSessionRef.current = null
      liveStateRef.current.onCancelPreview()
      liveStateRef.current.onDragStateChange(null)
    }

    const handleDragEndEvent = (_item: MuuriItem, ev: DraggerEndEvent | DraggerCancelEvent) => {
      if (ev.type === 'cancel') handleDragCancel()
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
      if (previewFrameRef.current != null) {
        window.cancelAnimationFrame(previewFrameRef.current)
        previewFrameRef.current = null
      }
      pendingPreviewRef.current = null
      dragSessionRef.current = null
      grid.destroy()
      gridInstanceRef.current = null
      handleDragCancel()
    }
  }, [containerNode, editMode, flushPreview, layout, schedulePreview])

  React.useLayoutEffect(() => {
    const grid = gridInstanceRef.current
    if (!grid) return
    if (draggingRefId) return
    grid.synchronize()
    grid.refreshItems().layout()
  }, [refs, draggingRefId])

  React.useLayoutEffect(() => {
    const grid = gridInstanceRef.current
    if (!grid) return
    // During drag we intentionally avoid synchronize/refreshItems because Muuri may temporarily
    // move items in the DOM. Only re-run layout to reflect preview x/y changes.
    grid.layout()
  }, [positionSignature, draggingRefId])

  React.useLayoutEffect(() => {
    const grid = gridInstanceRef.current
    if (!grid) return
    if (draggingRefId) return
    // Width/height changes need a refresh.
    grid.refreshItems().layout()
  }, [sizeSignature, draggingRefId])

  const setGridNode = React.useCallback(
    (node: HTMLDivElement | null) => {
      gridRef.current = node
      setContainerNode(node)
    },
    [gridRef],
  )

  const indicatorRect = React.useMemo(() => {
    if (!dropIndicatorLayout || containerWidth <= 0) return null
    return getRefPixelRect(dropIndicatorLayout, containerWidth)
  }, [containerWidth, dropIndicatorLayout])

  return (
    <Box
      ref={setGridNode}
      sx={{
        position: 'relative',
        minHeight: 0,
      }}
    >
      {indicatorRect ? (
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            left: `${indicatorRect.left}px`,
            top: `${indicatorRect.top}px`,
            width: `${indicatorRect.width}px`,
            height: `${indicatorRect.height}px`,
            borderRadius: 4,
            border: '2px solid rgba(25,118,210,.78)',
            bgcolor: 'rgba(25,118,210,.12)',
            boxShadow: '0 0 0 1px rgba(255,255,255,.75) inset, 0 10px 24px rgba(25,118,210,.18)',
            pointerEvents: 'none',
            zIndex: 0,
            transition: 'left .12s ease, top .12s ease, width .12s ease, height .12s ease',
          }}
        />
      ) : null}
      {renderedItems.map(({ ref, layout: itemLayout, frame }) => (
        <Box
          key={ref.id}
          className="hc-index-muuri-item"
          data-ref-id={ref.id}
          data-layout-x={itemLayout.x}
          data-layout-y={itemLayout.y}
          data-layout-w={itemLayout.w}
          data-layout-h={itemLayout.h}
          sx={{
            position: 'absolute',
            display: 'block',
            width: `${frame.width}px`,
            height: `${frame.height}px`,
            minWidth: 0,
            minHeight: 0,
            boxSizing: 'border-box',
            zIndex: draggingRefId === ref.id ? 3 : 1,
            '&.muuri-item-releasing': { zIndex: 2 },
            '&.muuri-item-dragging': { zIndex: 3 },
            '&.muuri-item-hidden': { zIndex: 0 },
          }}
        >
          <Box
            className="hc-index-muuri-item-content"
            sx={{
              position: 'relative',
              width: '100%',
              height: '100%',
              minHeight: 0,
            }}
          >
            {renderItem(ref, draggingRefId === ref.id)}
          </Box>
        </Box>
      ))}
    </Box>
  )
}
