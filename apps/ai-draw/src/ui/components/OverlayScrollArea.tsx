import * as React from 'react'
import { Box } from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import type { SxProps, Theme } from '@mui/material/styles'

type OverlayScrollAreaProps = {
  children: React.ReactNode
  sx?: SxProps<Theme>
  contentSx?: SxProps<Theme>
  fill?: boolean
  /**
   * Scroll axis.
   * - 'y': vertical (default)
   * - 'x': horizontal
   */
  axis?: 'y' | 'x'
  thumbWidth?: number
  thumbMinHeight?: number
  thumbInset?: number
  thumbColor?: string
  thumbHoverColor?: string
  scrollRef?: React.Ref<HTMLDivElement>
}

export function OverlayScrollArea(props: OverlayScrollAreaProps) {
  const {
    children,
    sx,
    contentSx,
    fill = true,
    axis = 'y',
    thumbWidth = 6,
    thumbMinHeight = 18,
    thumbInset = 2,
    thumbColor,
    thumbHoverColor,
    scrollRef: externalScrollRef,
  } = props

  const theme = useTheme()

  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const dragRef = React.useRef<{
    pointerId: number
    startClient: number
    startScroll: number
    ratio: number
  } | null>(null)

  const [thumb, setThumb] = React.useState<{ needed: boolean; pos: number; size: number }>({
    needed: false,
    pos: 0,
    size: 0,
  })
  const [active, setActive] = React.useState(false)
  const activeTimerRef = React.useRef<number | null>(null)
  const rafRef = React.useRef<number | null>(null)

  const setActiveWithTimeout = React.useCallback(() => {
    setActive(true)
    if (activeTimerRef.current) window.clearTimeout(activeTimerRef.current)
    activeTimerRef.current = window.setTimeout(() => setActive(false), 650)
  }, [])

  const recompute = React.useCallback(() => {
    const el = scrollRef.current
    if (!el) return

    const client = axis === 'x' ? el.clientWidth : el.clientHeight
    const scroll = axis === 'x' ? el.scrollWidth : el.scrollHeight
    const scrollPos = axis === 'x' ? el.scrollLeft : el.scrollTop
    const needed = scroll > client + 1

    if (!needed) {
      setThumb((t) => (t.needed ? { needed: false, pos: 0, size: 0 } : t))
      return
    }

    const track = client
    const rawSize = (client * client) / Math.max(1, scroll)
    const size = Math.max(thumbMinHeight, Math.min(track, rawSize))

    const maxScroll = Math.max(1, scroll - client)
    const maxThumb = Math.max(0, track - size)
    const pos = (scrollPos / maxScroll) * maxThumb

    setThumb((prev) => {
      const same =
        prev.needed === needed &&
        Math.abs(prev.pos - pos) < 0.5 &&
        Math.abs(prev.size - size) < 0.5
      return same ? prev : { needed, pos, size }
    })
  }, [axis, thumbMinHeight])

  const scheduleRecompute = React.useCallback(() => {
    if (rafRef.current) return
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null
      recompute()
    })
  }, [recompute])

  React.useLayoutEffect(() => {
    scheduleRecompute()
  })

  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const onScroll = () => {
      scheduleRecompute()
      setActiveWithTimeout()
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(() => scheduleRecompute())
    ro.observe(el)

    const onWindowResize = () => scheduleRecompute()
    window.addEventListener('resize', onWindowResize, { passive: true })

    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
      window.removeEventListener('resize', onWindowResize)
    }
  }, [scheduleRecompute, setActiveWithTimeout])

  React.useEffect(() => {
    return () => {
      if (activeTimerRef.current) window.clearTimeout(activeTimerRef.current)
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const onWheel = React.useCallback(
    (e: React.WheelEvent) => {
      // Horizontal mode: map vertical wheel to horizontal scroll.
      // This makes the strip usable without requiring Shift+wheel.
      if (axis !== 'x') return
      if (e.ctrlKey) return

      const el = scrollRef.current
      if (!el) return
      if (!(el.scrollWidth > el.clientWidth + 1)) return

      const dx = e.deltaX
      const dy = e.deltaY
      if (Math.abs(dx) > 0.01) return
      if (Math.abs(dy) < 0.01) return

      const prev = el.scrollLeft
      el.scrollLeft = prev + dy
      if (el.scrollLeft !== prev) {
        scheduleRecompute()
        setActiveWithTimeout()
        e.preventDefault()
      }
    },
    [axis, scheduleRecompute, setActiveWithTimeout],
  )

  const onThumbPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      const el = scrollRef.current
      if (!el) return
      if (!thumb.needed) return

      const client = axis === 'x' ? el.clientWidth : el.clientHeight
      const scroll = axis === 'x' ? el.scrollWidth : el.scrollHeight
      const track = client
      const size = thumb.size || Math.max(thumbMinHeight, (client * client) / Math.max(1, scroll))
      const maxThumb = Math.max(1, track - size)
      const maxScroll = Math.max(1, scroll - client)
      const ratio = maxScroll / maxThumb

      dragRef.current = {
        pointerId: e.pointerId,
        startClient: axis === 'x' ? e.clientX : e.clientY,
        startScroll: axis === 'x' ? el.scrollLeft : el.scrollTop,
        ratio,
      }

      setActive(true)
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      e.preventDefault()
      e.stopPropagation()
    },
    [thumb.needed, thumb.height, thumbMinHeight],
  )

  const onThumbPointerMove = React.useCallback(
    (e: React.PointerEvent) => {
      const el = scrollRef.current
      const drag = dragRef.current
      if (!el || !drag) return
      if (e.pointerId !== drag.pointerId) return

      const dClient = (axis === 'x' ? e.clientX : e.clientY) - drag.startClient
      const next = drag.startScroll + dClient * drag.ratio
      if (axis === 'x') el.scrollLeft = next
      else el.scrollTop = next
      scheduleRecompute()
      e.preventDefault()
    },
    [axis, scheduleRecompute],
  )

  const onThumbPointerUpOrCancel = React.useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      if (e.pointerId !== drag.pointerId) return
      dragRef.current = null
      setActiveWithTimeout()
      e.preventDefault()
    },
    [setActiveWithTimeout],
  )

  const baseThumbColor =
    thumbColor ??
    alpha(
      theme.palette.mode === 'dark' ? theme.palette.common.white : theme.palette.common.black,
      theme.palette.mode === 'dark' ? 0.28 : 0.22,
    )
  const hoverThumbColor =
    thumbHoverColor ??
    alpha(
      theme.palette.mode === 'dark' ? theme.palette.common.white : theme.palette.common.black,
      theme.palette.mode === 'dark' ? 0.42 : 0.34,
    )

  const setScrollElRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node
      if (!externalScrollRef) return
      if (typeof externalScrollRef === 'function') externalScrollRef(node)
      else (externalScrollRef as any).current = node
    },
    [externalScrollRef],
  )

  return (
    <Box
      sx={{
        position: 'relative',
        ...(fill ? { height: '100%', width: '100%' } : null),
        ...sx,
      }}
      onPointerEnter={() => setActive(true)}
      onPointerLeave={() => setActive(false)}
    >
      <Box
        ref={setScrollElRef}
        onWheel={onWheel}
        sx={{
          overflow: 'auto',
          ...(axis === 'x' ? { overflowY: 'hidden' } : null),
          ...(fill ? { height: '100%', width: '100%' } : null),
          overscrollBehavior: 'contain',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          '&::-webkit-scrollbar': { width: 0, height: 0 },
          ...contentSx,
        }}
      >
        {children}
      </Box>

      <Box
        onPointerDown={onThumbPointerDown}
        onPointerMove={onThumbPointerMove}
        onPointerUp={onThumbPointerUpOrCancel}
        onPointerCancel={onThumbPointerUpOrCancel}
        sx={{
          position: 'absolute',
          ...(axis === 'x'
            ? {
                left: thumbInset + thumb.pos,
                bottom: thumbInset,
                height: thumbWidth,
                width: Math.max(0, thumb.size - thumbInset * 2),
              }
            : {
                top: thumbInset + thumb.pos,
                right: thumbInset,
                width: thumbWidth,
                height: Math.max(0, thumb.size - thumbInset * 2),
              }),
          borderRadius: 999,
          bgcolor: baseThumbColor,
          opacity: thumb.needed && active ? 1 : 0,
          transform: 'translateZ(0)',
          transition: 'opacity 140ms ease, background-color 140ms ease',
          cursor: thumb.needed ? 'grab' : 'default',
          pointerEvents: thumb.needed ? 'auto' : 'none',
          '&:active': { cursor: 'grabbing' },
          '&:hover': { bgcolor: hoverThumbColor },
          touchAction: 'none',
        }}
      />
    </Box>
  )
}
