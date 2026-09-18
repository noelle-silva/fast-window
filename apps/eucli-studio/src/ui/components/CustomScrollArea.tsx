import * as React from 'react'
import { Box, type SxProps, type Theme } from '@mui/material'
import {
  CUSTOM_SCROLL_EDGE_INSET,
  CUSTOM_SCROLL_THUMB_ATTR,
  CUSTOM_SCROLL_THUMB_THICKNESS,
  customScrollbarHiddenSx,
  measureCustomScrollArea,
  sameCustomScrollMetrics,
  type CustomScrollMetrics,
} from '../scroll/customScrollbars'

type DragState = {
  axis: 'x' | 'y'
  pointerId: number
  startPointer: number
  startScroll: number
  maxScroll: number
  maxThumbTravel: number
}

export type CustomScrollAreaProps = {
  children: React.ReactNode
  hostSx?: SxProps<Theme>
  scrollSx?: SxProps<Theme>
  className?: string
  onClick?: React.MouseEventHandler<HTMLDivElement>
  onScrollPositionChange?: (el: HTMLDivElement) => void
}

function sxList(value?: SxProps<Theme>) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export const CustomScrollArea = React.forwardRef<HTMLDivElement, CustomScrollAreaProps>(function CustomScrollArea(props, forwardedRef) {
  const { children, hostSx, scrollSx, className, onClick, onScrollPositionChange } = props
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const dragRef = React.useRef<DragState | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const [metrics, setMetrics] = React.useState<CustomScrollMetrics>({ canY: false, canX: false, yTop: 0, yHeight: 0, xLeft: 0, xWidth: 0 })

  React.useImperativeHandle(forwardedRef, () => scrollRef.current as HTMLDivElement, [])

  const updateMetrics = React.useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const next = measureCustomScrollArea(el)
    setMetrics((current) => (sameCustomScrollMetrics(current, next) ? current : next))
    onScrollPositionChange?.(el)
  }, [onScrollPositionChange])

  React.useLayoutEffect(() => {
    const el = scrollRef.current
    const content = contentRef.current
    if (!el || !content) return

    updateMetrics()
    const observer = new ResizeObserver(updateMetrics)
    observer.observe(el)
    observer.observe(content)
    el.addEventListener('scroll', updateMetrics, { passive: true })
    return () => {
      observer.disconnect()
      el.removeEventListener('scroll', updateMetrics)
    }
  }, [updateMetrics, children])

  const onPointerMove = React.useCallback((event: PointerEvent) => {
    const drag = dragRef.current
    const el = scrollRef.current
    if (!drag || !el || event.pointerId !== drag.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const pointer = drag.axis === 'y' ? event.clientY : event.clientX
    const delta = pointer - drag.startPointer
    const next = drag.maxThumbTravel > 0 ? drag.startScroll + delta * (drag.maxScroll / drag.maxThumbTravel) : drag.startScroll
    if (drag.axis === 'y') el.scrollTop = next
    else el.scrollLeft = next
    updateMetrics()
  }, [updateMetrics])

  const endDrag = React.useCallback((event?: PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    setDragging(false)
    if (event) {
      event.preventDefault()
      event.stopPropagation()
    }
    window.removeEventListener('pointermove', onPointerMove)
  }, [onPointerMove])

  const beginDrag = React.useCallback((axis: 'x' | 'y', event: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (!el) return
    event.preventDefault()
    event.stopPropagation()
    const maxScroll = axis === 'y' ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth
    const maxThumbTravel = axis === 'y'
      ? el.clientHeight - CUSTOM_SCROLL_EDGE_INSET * 2 - metrics.yHeight
      : el.clientWidth - CUSTOM_SCROLL_EDGE_INSET * 2 - metrics.xWidth
    dragRef.current = {
      axis,
      pointerId: event.pointerId,
      startPointer: axis === 'y' ? event.clientY : event.clientX,
      startScroll: axis === 'y' ? el.scrollTop : el.scrollLeft,
      maxScroll: Math.max(0, maxScroll),
      maxThumbTravel: Math.max(1, maxThumbTravel),
    }
    setDragging(true)
    window.addEventListener('pointermove', onPointerMove)
  }, [endDrag, metrics.xWidth, metrics.yHeight, onPointerMove])

  React.useEffect(() => {
    if (!dragging) return
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
    }
  }, [dragging, endDrag, onPointerMove])

  const thumbBaseSx = {
    position: 'absolute',
    zIndex: 3,
    borderRadius: 999,
    bgcolor: dragging ? 'rgba(51,65,85,.72)' : 'rgba(71,85,105,.48)',
    boxShadow: '0 8px 18px rgba(15,23,42,.16), inset 0 0 0 1px rgba(255,255,255,.42)',
    cursor: 'grab',
    touchAction: 'none',
    transition: dragging ? 'none' : 'background-color 120ms ease, opacity 120ms ease',
    '&:hover': { bgcolor: 'rgba(51,65,85,.66)' },
    '&:active': { cursor: 'grabbing' },
  } as const

  return (
    <Box
      className={className}
      sx={[
        {
          position: 'relative',
          minWidth: 0,
          minHeight: 0,
          [`&:hover [${CUSTOM_SCROLL_THUMB_ATTR}="1"]`]: { opacity: 1 },
        },
        ...sxList(hostSx),
      ]}
    >
      <Box
        ref={scrollRef}
        onClick={onClick}
        sx={[
          {
            minWidth: 0,
            minHeight: 0,
            overflow: 'auto',
            ...customScrollbarHiddenSx,
          },
          ...sxList(scrollSx),
        ]}
      >
        <Box ref={contentRef} sx={{ minWidth: 0 }}>
          {children}
        </Box>
      </Box>

      {metrics.canY ? (
        <Box
          data-eucli-scroll-thumb="1"
          role="scrollbar"
          aria-orientation="vertical"
          onPointerDown={(event) => beginDrag('y', event)}
          sx={{
            ...thumbBaseSx,
            top: metrics.yTop,
            right: 3,
            width: CUSTOM_SCROLL_THUMB_THICKNESS,
            height: metrics.yHeight,
            opacity: dragging ? 1 : 0.68,
          }}
        />
      ) : null}

      {metrics.canX ? (
        <Box
          data-eucli-scroll-thumb="1"
          role="scrollbar"
          aria-orientation="horizontal"
          onPointerDown={(event) => beginDrag('x', event)}
          sx={{
            ...thumbBaseSx,
            left: metrics.xLeft,
            bottom: 3,
            width: metrics.xWidth,
            height: CUSTOM_SCROLL_THUMB_THICKNESS,
            opacity: dragging ? 1 : 0.68,
          }}
        />
      ) : null}
    </Box>
  )
})
