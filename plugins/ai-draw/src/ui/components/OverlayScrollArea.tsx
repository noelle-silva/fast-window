import * as React from 'react'
import { Box } from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import type { SxProps, Theme } from '@mui/material/styles'

type OverlayScrollAreaProps = {
  children: React.ReactNode
  sx?: SxProps<Theme>
  contentSx?: SxProps<Theme>
  fill?: boolean
  thumbWidth?: number
  thumbMinHeight?: number
  thumbInset?: number
  thumbColor?: string
  thumbHoverColor?: string
}

export function OverlayScrollArea(props: OverlayScrollAreaProps) {
  const {
    children,
    sx,
    contentSx,
    fill = true,
    thumbWidth = 6,
    thumbMinHeight = 18,
    thumbInset = 2,
    thumbColor,
    thumbHoverColor,
  } = props

  const theme = useTheme()

  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const dragRef = React.useRef<{
    pointerId: number
    startY: number
    startScrollTop: number
    ratio: number
  } | null>(null)

  const [thumb, setThumb] = React.useState<{ needed: boolean; top: number; height: number }>({
    needed: false,
    top: 0,
    height: 0,
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

    const clientHeight = el.clientHeight
    const scrollHeight = el.scrollHeight
    const scrollTop = el.scrollTop
    const needed = scrollHeight > clientHeight + 1

    if (!needed) {
      setThumb((t) => (t.needed ? { needed: false, top: 0, height: 0 } : t))
      return
    }

    const trackHeight = clientHeight
    const rawHeight = (clientHeight * clientHeight) / Math.max(1, scrollHeight)
    const height = Math.max(thumbMinHeight, Math.min(trackHeight, rawHeight))

    const maxScrollTop = Math.max(1, scrollHeight - clientHeight)
    const maxThumbTop = Math.max(0, trackHeight - height)
    const top = (scrollTop / maxScrollTop) * maxThumbTop

    setThumb((prev) => {
      const same =
        prev.needed === needed &&
        Math.abs(prev.top - top) < 0.5 &&
        Math.abs(prev.height - height) < 0.5
      return same ? prev : { needed, top, height }
    })
  }, [thumbMinHeight])

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

  const onThumbPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      const el = scrollRef.current
      if (!el) return
      if (!thumb.needed) return

      const clientHeight = el.clientHeight
      const scrollHeight = el.scrollHeight
      const trackHeight = clientHeight
      const height = thumb.height || Math.max(thumbMinHeight, (clientHeight * clientHeight) / Math.max(1, scrollHeight))
      const maxThumbTop = Math.max(1, trackHeight - height)
      const maxScrollTop = Math.max(1, scrollHeight - clientHeight)
      const ratio = maxScrollTop / maxThumbTop

      dragRef.current = {
        pointerId: e.pointerId,
        startY: e.clientY,
        startScrollTop: el.scrollTop,
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
      const dy = e.clientY - drag.startY
      el.scrollTop = drag.startScrollTop + dy * drag.ratio
      scheduleRecompute()
      e.preventDefault()
    },
    [scheduleRecompute],
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
        ref={scrollRef}
        sx={{
          overflow: 'auto',
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
          top: thumbInset + thumb.top,
          right: thumbInset,
          width: thumbWidth,
          height: Math.max(0, thumb.height - thumbInset * 2),
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
