import * as React from 'react'
import { Box, type SxProps, type Theme } from '@mui/material'
import { customScrollbarHiddenSx, customScrollbarRevealSx } from '../scroll/customScrollbars'
import { CustomScrollbarThumbs, useCustomScrollbar } from '../scroll/CustomScrollbar'

export type CustomScrollAreaProps = {
  children: React.ReactNode
  // axis='y'：只保留纵向滚动，横向溢出裁切，不出现横向滚动条。
  axis?: 'both' | 'y'
  // 关掉自制滑块：容器照样能滚，只是不画滚动条（原生滚动条本来就一直藏着）。
  showThumbs?: boolean
  hostSx?: SxProps<Theme>
  scrollSx?: SxProps<Theme>
  contentSx?: SxProps<Theme>
  className?: string
  onClick?: React.MouseEventHandler<HTMLDivElement>
  onScrollPositionChange?: (el: HTMLDivElement) => void
}

function sxList(value?: SxProps<Theme>) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export const CustomScrollArea = React.forwardRef<HTMLDivElement, CustomScrollAreaProps>(function CustomScrollArea(props, forwardedRef) {
  const { children, axis = 'both', showThumbs = true, hostSx, scrollSx, contentSx, className, onClick, onScrollPositionChange } = props
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)

  const { metrics, dragging, beginDrag } = useCustomScrollbar({ scrollRef, contentRef, axis, onScrollPositionChange })

  React.useImperativeHandle(forwardedRef, () => scrollRef.current as HTMLDivElement, [])

  return (
    <Box
      className={className}
      sx={[
        {
          position: 'relative',
          minWidth: 0,
          minHeight: 0,
          ...(showThumbs ? customScrollbarRevealSx : null),
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
            overflowY: 'auto',
            overflowX: axis === 'y' ? 'hidden' : 'auto',
            ...customScrollbarHiddenSx,
          },
          ...sxList(scrollSx),
        ]}
      >
        <Box ref={contentRef} sx={[{ minWidth: 0 }, ...sxList(contentSx)]}>
          {children}
        </Box>
      </Box>

      {showThumbs ? <CustomScrollbarThumbs metrics={metrics} dragging={dragging} onBeginDrag={beginDrag} /> : null}
    </Box>
  )
})
