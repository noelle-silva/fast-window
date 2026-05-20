import * as React from 'react'
import { Box } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'

const SCROLLBAR_INSET = 8
const SCROLLBAR_WIDTH = 10
const THUMB_MIN_HEIGHT = 44

type ScrollMetrics = {
  scrollable: boolean
  thumbHeight: number
  thumbTop: number
}

type DragState = {
  maxScrollTop: number
  maxThumbTop: number
  pointerId: number
  startClientY: number
  startScrollTop: number
}

type ScrollAreaProps = {
  ariaLabel?: string
  children: React.ReactNode
  component?: React.ElementType
  onClick?: React.MouseEventHandler<HTMLDivElement>
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>
  onScroll?: React.UIEventHandler<HTMLDivElement>
  sx?: SxProps<Theme>
  viewportSx?: SxProps<Theme>
}

export const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(function ScrollArea(props, forwardedRef): React.ReactNode {
  const { ariaLabel, children, component = 'div', onClick, onContextMenu, onScroll, sx, viewportSx } = props
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const viewportRef = React.useRef<HTMLDivElement | null>(null)
  const pointerInsideRef = React.useRef(false)
  const dragRef = React.useRef<DragState | null>(null)
  const [metrics, setMetrics] = React.useState<ScrollMetrics>({ scrollable: false, thumbHeight: 0, thumbTop: 0 })
  const [visible, setVisible] = React.useState(false)
  const [dragging, setDragging] = React.useState(false)

  const setRootNode = React.useCallback((node: HTMLDivElement | null) => {
    rootRef.current = node
    if (typeof forwardedRef === 'function') forwardedRef(node)
    else if (forwardedRef) forwardedRef.current = node
  }, [forwardedRef])

  const showThumb = React.useCallback(() => {
    setVisible(true)
  }, [])

  const updateMetrics = React.useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const maxScrollTop = viewport.scrollHeight - viewport.clientHeight
    const scrollable = maxScrollTop > 1
    if (!scrollable) {
      setMetrics(current => current.scrollable || current.thumbHeight || current.thumbTop ? { scrollable: false, thumbHeight: 0, thumbTop: 0 } : current)
      setVisible(false)
      return
    }
    const railHeight = Math.max(0, viewport.clientHeight - SCROLLBAR_INSET * 2)
    const thumbHeight = Math.min(railHeight, Math.max(THUMB_MIN_HEIGHT, railHeight * viewport.clientHeight / viewport.scrollHeight))
    const maxThumbTop = Math.max(0, railHeight - thumbHeight)
    const thumbTop = maxThumbTop ? Math.min(maxThumbTop, viewport.scrollTop / maxScrollTop * maxThumbTop) : 0
    setMetrics(current => {
      if (current.scrollable === scrollable && current.thumbHeight === thumbHeight && current.thumbTop === thumbTop) return current
      return { scrollable, thumbHeight, thumbTop }
    })
  }, [])

  React.useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return undefined
    updateMetrics()

    const resizeObserver = new ResizeObserver(updateMetrics)
    resizeObserver.observe(viewport)
    if (viewport.firstElementChild) resizeObserver.observe(viewport.firstElementChild)

    const mutationObserver = new MutationObserver(updateMetrics)
    mutationObserver.observe(viewport, { attributes: true, childList: true, subtree: true })
    window.addEventListener('resize', updateMetrics)

    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener('resize', updateMetrics)
    }
  }, [children, updateMetrics])

  const handlePointerEnter = () => {
    pointerInsideRef.current = true
    if (metrics.scrollable) showThumb()
  }

  const handlePointerLeave = () => {
    pointerInsideRef.current = false
    if (!dragRef.current) setVisible(false)
  }

  const handleScroll: React.UIEventHandler<HTMLDivElement> = event => {
    updateMetrics()
    if (metrics.scrollable) {
      showThumb()
      if (!pointerInsideRef.current) setVisible(false)
    }
    onScroll?.(event)
  }

  const handleThumbPointerDown: React.PointerEventHandler<HTMLDivElement> = event => {
    const viewport = viewportRef.current
    if (!viewport || !metrics.scrollable) return
    event.preventDefault()
    event.stopPropagation()
    const railHeight = Math.max(0, viewport.clientHeight - SCROLLBAR_INSET * 2)
    dragRef.current = {
      maxScrollTop: Math.max(0, viewport.scrollHeight - viewport.clientHeight),
      maxThumbTop: Math.max(0, railHeight - metrics.thumbHeight),
      pointerId: event.pointerId,
      startClientY: event.clientY,
      startScrollTop: viewport.scrollTop,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
    showThumb()
  }

  const handleThumbPointerMove: React.PointerEventHandler<HTMLDivElement> = event => {
    const viewport = viewportRef.current
    const drag = dragRef.current
    if (!viewport || !drag || drag.pointerId !== event.pointerId || drag.maxThumbTop <= 0) return
    event.preventDefault()
    event.stopPropagation()
    const scrollDelta = (event.clientY - drag.startClientY) / drag.maxThumbTop * drag.maxScrollTop
    viewport.scrollTop = drag.startScrollTop + scrollDelta
  }

  const finishThumbDrag: React.PointerEventHandler<HTMLDivElement> = event => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = null
    setDragging(false)
    if (!pointerInsideRef.current) setVisible(false)
  }

  const thumbVisible = metrics.scrollable && (visible || dragging)

  return (
    <Box
      ref={setRootNode}
      component={component}
      aria-label={ariaLabel}
      onClick={onClick}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      sx={[
        { position: 'relative', minHeight: 0, overflow: 'hidden' },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      <Box
        ref={viewportRef}
        onContextMenu={onContextMenu}
        onScroll={handleScroll}
        sx={[
          {
            width: '100%',
            height: '100%',
            maxHeight: 'inherit',
            minHeight: 0,
            overflow: 'auto',
            overscrollBehavior: 'contain',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            '&::-webkit-scrollbar': { width: 0, height: 0 },
          },
          ...(Array.isArray(viewportSx) ? viewportSx : viewportSx ? [viewportSx] : []),
        ]}
      >
        {children}
      </Box>

      <Box
        aria-hidden="true"
        sx={{
          position: 'absolute',
          top: SCROLLBAR_INSET,
          right: 6,
          bottom: SCROLLBAR_INSET,
          width: SCROLLBAR_WIDTH,
          opacity: thumbVisible ? 1 : 0,
          pointerEvents: thumbVisible ? 'auto' : 'none',
          zIndex: 2,
        }}
      >
        <Box
          onPointerCancel={finishThumbDrag}
          onPointerDown={handleThumbPointerDown}
          onPointerMove={handleThumbPointerMove}
          onPointerUp={finishThumbDrag}
          sx={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: SCROLLBAR_WIDTH,
            height: metrics.thumbHeight,
            borderRadius: 999,
            cursor: dragging ? 'grabbing' : 'grab',
            transform: `translateY(${metrics.thumbTop}px)`,
            background: 'linear-gradient(180deg, rgba(255,255,255,0.78), rgba(255,255,255,0.34))',
            border: '1px solid rgba(255,255,255,0.58)',
            boxShadow: '0 10px 28px rgba(15, 23, 42, 0.22), inset 0 1px 0 rgba(255,255,255,0.72)',
            backdropFilter: 'blur(16px) saturate(1.45)',
            WebkitBackdropFilter: 'blur(16px) saturate(1.45)',
            '&:hover': { background: 'linear-gradient(180deg, rgba(255,255,255,0.9), rgba(255,255,255,0.48))' },
          }}
        />
      </Box>
    </Box>
  )
})
