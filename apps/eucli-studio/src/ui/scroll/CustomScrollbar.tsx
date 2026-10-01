import * as React from 'react'
import { Box } from '@mui/material'
import {
  CUSTOM_SCROLL_EDGE_INSET,
  CUSTOM_SCROLL_THUMB_THICKNESS,
  measureCustomScrollArea,
  sameCustomScrollMetrics,
  type CustomScrollAxis,
  type CustomScrollMetrics,
} from './customScrollbars'

type DragState = {
  axis: CustomScrollAxis
  pointerId: number
  startPointer: number
  startScroll: number
  maxScroll: number
  maxThumbTravel: number
}

// 滚动视口相对定位容器的盒子；覆盖层据此精确对齐滚动元素本身。
export type ScrollViewportBox = { top: number; left: number; width: number; height: number }

const EMPTY_METRICS: CustomScrollMetrics = { canY: false, canX: false, yTop: 0, yHeight: 0, xLeft: 0, xWidth: 0 }

function sameViewport(a: ScrollViewportBox | null, b: ScrollViewportBox | null) {
  if (!a || !b) return a === b
  return (
    Math.round(a.top) === Math.round(b.top) &&
    Math.round(a.left) === Math.round(b.left) &&
    Math.round(a.width) === Math.round(b.width) &&
    Math.round(a.height) === Math.round(b.height)
  )
}

// useCustomScrollbar 是自制滚动条的统一内核：观测任意滚动容器的尺寸与滚动位置，
// 产出滑块度量、拖拽状态与拖拽入口。CustomScrollArea 与多行输入框共用它，行为一致。
//
// 传入 containerRef 时，额外测量滚动元素相对该定位容器的视口盒子（viewport），
// 供覆盖层滑块在「滚动元素带内边距、不等于定位容器」的场景下精确对齐（如 MUI 多行输入框）。
export function useCustomScrollbar(options: {
  scrollRef: React.RefObject<HTMLElement | null>
  contentRef?: React.RefObject<HTMLElement | null>
  containerRef?: React.RefObject<HTMLElement | null>
  axis?: 'both' | 'y'
  onScrollPositionChange?: (el: HTMLDivElement) => void
}) {
  const { scrollRef, contentRef, containerRef, axis = 'both', onScrollPositionChange } = options
  const dragRef = React.useRef<DragState | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const [metrics, setMetrics] = React.useState<CustomScrollMetrics>(EMPTY_METRICS)
  const [viewport, setViewport] = React.useState<ScrollViewportBox | null>(null)

  const updateMetrics = React.useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const next = measureCustomScrollArea(el, { allowX: axis === 'both' })
    setMetrics((current) => (sameCustomScrollMetrics(current, next) ? current : next))

    const container = containerRef?.current
    if (container) {
      const containerRect = container.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      const nextViewport: ScrollViewportBox = {
        top: elRect.top - containerRect.top,
        left: elRect.left - containerRect.left,
        width: elRect.width,
        height: elRect.height,
      }
      setViewport((current) => (sameViewport(current, nextViewport) ? current : nextViewport))
    }

    onScrollPositionChange?.(el as HTMLDivElement)
  }, [axis, onScrollPositionChange, scrollRef, containerRef])

  React.useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const content = contentRef?.current

    updateMetrics()
    const observer = new ResizeObserver(updateMetrics)
    observer.observe(el)
    if (content) observer.observe(content)
    el.addEventListener('scroll', updateMetrics, { passive: true })
    return () => {
      observer.disconnect()
      el.removeEventListener('scroll', updateMetrics)
    }
  }, [updateMetrics, scrollRef, contentRef])

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
  }, [scrollRef, updateMetrics])

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

  const beginDrag = React.useCallback((dragAxis: CustomScrollAxis, event: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (!el) return
    event.preventDefault()
    event.stopPropagation()
    const maxScroll = dragAxis === 'y' ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth
    const maxThumbTravel = dragAxis === 'y'
      ? el.clientHeight - CUSTOM_SCROLL_EDGE_INSET * 2 - metrics.yHeight
      : el.clientWidth - CUSTOM_SCROLL_EDGE_INSET * 2 - metrics.xWidth
    dragRef.current = {
      axis: dragAxis,
      pointerId: event.pointerId,
      startPointer: dragAxis === 'y' ? event.clientY : event.clientX,
      startScroll: dragAxis === 'y' ? el.scrollTop : el.scrollLeft,
      maxScroll: Math.max(0, maxScroll),
      maxThumbTravel: Math.max(1, maxThumbTravel),
    }
    setDragging(true)
    window.addEventListener('pointermove', onPointerMove)
  }, [scrollRef, metrics.xWidth, metrics.yHeight, onPointerMove])

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

  return { metrics, viewport, dragging, beginDrag, updateMetrics }
}

const thumbBaseSx = {
  position: 'absolute',
  zIndex: 3,
  borderRadius: 999,
  bgcolor: 'rgba(71,85,105,.48)',
  boxShadow: '0 8px 18px rgba(15,23,42,.16), inset 0 0 0 1px rgba(255,255,255,.42)',
  cursor: 'grab',
  touchAction: 'none',
  transition: 'background-color 120ms ease, opacity 120ms ease',
  '&:hover': { bgcolor: 'rgba(51,65,85,.66)' },
  '&:active': { cursor: 'grabbing' },
} as const

// CustomScrollbarThumbs 渲染自制滚动滑块，覆盖层填满定位容器（滑块贴容器边缘）。
// viewport 为滚动元素相对容器的盒子，仅用于把纵向轨道对齐到滚动元素内容区（带内边距场景，如多行输入框）。
export function CustomScrollbarThumbs(props: {
  metrics: CustomScrollMetrics
  dragging: boolean
  onBeginDrag: (axis: CustomScrollAxis, event: React.PointerEvent<HTMLDivElement>) => void
  viewport?: ScrollViewportBox | null
}) {
  const { metrics, dragging, onBeginDrag, viewport } = props
  if (!metrics.canY && !metrics.canX) return null
  const draggingSx = dragging ? { bgcolor: 'rgba(51,65,85,.72)', transition: 'none' } : null
  const trackTop = viewport ? viewport.top : 0
  const trackLeft = viewport ? viewport.left : 0

  return (
    <Box sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3 }}>
      {metrics.canY ? (
        <Box
          data-eucli-scroll-thumb="1"
          role="scrollbar"
          aria-orientation="vertical"
          onPointerDown={(event) => onBeginDrag('y', event)}
          sx={{
            ...thumbBaseSx,
            ...(draggingSx || {}),
            pointerEvents: 'auto',
            top: trackTop + metrics.yTop,
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
          onPointerDown={(event) => onBeginDrag('x', event)}
          sx={{
            ...thumbBaseSx,
            ...(draggingSx || {}),
            pointerEvents: 'auto',
            left: trackLeft + metrics.xLeft,
            bottom: 3,
            width: metrics.xWidth,
            height: CUSTOM_SCROLL_THUMB_THICKNESS,
            opacity: dragging ? 1 : 0.68,
          }}
        />
      ) : null}
    </Box>
  )
}
