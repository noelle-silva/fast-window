import * as React from 'react'
import { Box } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'

type ScrollAreaProps = {
  children: React.ReactNode
  ariaLabel?: string
  sx?: SxProps<Theme>
  viewportSx?: SxProps<Theme>
}

const MIN_THUMB_SIZE = 36
const THUMB_WIDTH = 7
const THUMB_INSET = 4

export function ScrollArea(props: ScrollAreaProps) {
  const { children, ariaLabel, sx, viewportSx } = props
  const viewportRef = React.useRef<HTMLDivElement | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const dragRef = React.useRef<{ startY: number; startScrollTop: number } | null>(null)
  const [metrics, setMetrics] = React.useState({ scrollTop: 0, clientHeight: 0, scrollHeight: 0 })
  const [active, setActive] = React.useState(false)

  const measure = React.useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    setMetrics({
      scrollTop: viewport.scrollTop,
      clientHeight: viewport.clientHeight,
      scrollHeight: viewport.scrollHeight,
    })
  }, [])

  React.useLayoutEffect(() => {
    measure()
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return

    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(viewport)
    resizeObserver.observe(content)

    return () => resizeObserver.disconnect()
  }, [measure])

  React.useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const viewport = viewportRef.current
      const drag = dragRef.current
      if (!viewport || !drag) return

      const maxScrollTop = viewport.scrollHeight - viewport.clientHeight
      const maxThumbTop = viewport.clientHeight - thumbSize
      if (maxScrollTop <= 0 || maxThumbTop <= 0) return


      const deltaY = event.clientY - drag.startY
      viewport.scrollTop = drag.startScrollTop + (deltaY / maxThumbTop) * maxScrollTop
    }

    const onPointerUp = () => {
      dragRef.current = null
      setActive(false)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [metrics.clientHeight, metrics.scrollHeight])

  const hasOverflow = metrics.scrollHeight > metrics.clientHeight + 1
  const thumbSize = hasOverflow
    ? Math.max(MIN_THUMB_SIZE, (metrics.clientHeight / metrics.scrollHeight) * metrics.clientHeight)
    : 0
  const thumbTop = hasOverflow
    ? (metrics.scrollTop / (metrics.scrollHeight - metrics.clientHeight)) * (metrics.clientHeight - thumbSize)
    : 0

  return (
    <Box sx={[{ position: 'relative', minHeight: 0, overflow: 'hidden' }, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}>
      <Box
        ref={viewportRef}
        role={ariaLabel ? 'region' : undefined}
        aria-label={ariaLabel}
        onScroll={measure}
        sx={[
          {
            height: '100%',
            maxHeight: 'inherit',
            minHeight: 0,
            overflow: 'auto',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            '&::-webkit-scrollbar': { display: 'none' },
          },
          ...(Array.isArray(viewportSx) ? viewportSx : viewportSx ? [viewportSx] : []),
        ]}
      >
        <Box ref={contentRef}>{children}</Box>
      </Box>
      {hasOverflow ? (
        <Box
          aria-hidden="true"
          onPointerDown={(event: React.PointerEvent<HTMLDivElement>) => {
            const viewport = viewportRef.current
            if (!viewport) return
            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            dragRef.current = { startY: event.clientY, startScrollTop: viewport.scrollTop }
            setActive(true)
          }}
          sx={(theme) => ({
            position: 'absolute',
            top: thumbTop,
            right: THUMB_INSET,
            width: THUMB_WIDTH,
            height: thumbSize,
            borderRadius: 999,
            cursor: 'ns-resize',
            touchAction: 'none',
            bgcolor: active ? 'primary.main' : 'text.secondary',
            opacity: active ? 0.72 : 0.34,
            boxShadow: `0 0 0 1px ${theme.palette.background.paper}, 0 6px 16px ${theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.34)' : 'rgba(15, 23, 42, 0.16)'}`,
            transition: 'opacity 120ms ease, background-color 120ms ease',
            '&:hover': { opacity: 0.62 },
          })}
        />
      ) : null}
    </Box>
  )
}
