import * as React from 'react'
import { Box, type SxProps, type Theme } from '@mui/material'
import { customScrollbarHiddenSx, customScrollbarRevealSx } from '../scroll/customScrollbars'
import { CustomScrollbarThumbs, useCustomScrollbar } from '../scroll/CustomScrollbar'

export type CustomScrollAreaProps = {
  children: React.ReactNode
  // axis='y'：只保留纵向滚动，横向溢出裁切，不出现横向滚动条。
  axis?: 'both' | 'y'
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
  const { children, axis = 'both', hostSx, scrollSx, contentSx, className, onClick, onScrollPositionChange } = props
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
          ...customScrollbarRevealSx,
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

      <CustomScrollbarThumbs metrics={metrics} dragging={dragging} onBeginDrag={beginDrag} />
    </Box>
  )
})
