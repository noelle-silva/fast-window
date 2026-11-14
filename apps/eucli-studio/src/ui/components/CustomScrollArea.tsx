import * as React from 'react'
import { Box, IconButton, type SxProps, type Theme } from '@mui/material'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import { customScrollbarHiddenSx, customScrollbarRevealSx } from '../scroll/customScrollbars'
import { CustomScrollbarThumbs, useCustomScrollbar } from '../scroll/CustomScrollbar'
import { useStickToBottom } from '../scroll/useStickToBottom'

export type CustomScrollAreaProps = {
  children: React.ReactNode
  // axis='y'：只保留纵向滚动，横向溢出裁切，不出现横向滚动条。
  axis?: 'both' | 'y'
  // 关掉自制滑块：容器照样能滚，只是不画滚动条（原生滚动条本来就一直藏着）。
  showThumbs?: boolean
  // 内容增长时贴住底部跟随；用户上滚即让位，滚回底部再恢复。自滚区域用，默认关闭。
  stickToBottom?: boolean
  // 配合 stickToBottom：离底部时在右下角浮出圆形的回底按钮（纯图标，无障碍名「回到最新」）。
  backToBottom?: boolean
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
  const { children, axis = 'both', showThumbs = true, stickToBottom = false, backToBottom, hostSx, scrollSx, contentSx, className, onClick, onScrollPositionChange } = props
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)

  const { metrics, dragging, beginDrag } = useCustomScrollbar({ scrollRef, contentRef, axis, onScrollPositionChange })
  const { following, scrollToBottom } = useStickToBottom({ scrollRef, contentRef, enabled: stickToBottom })
  const showBackToBottom = Boolean(backToBottom) && stickToBottom && !following

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
            // 跟底时把滚动位置的控制权收回来：浏览器的滚动锚定会在上方内容变化时
            // 自作主张改写 scrollTop，看起来就像用户往上滚了一截，跟随会被误判成让位。
            ...(stickToBottom ? { overflowAnchor: 'none' } : null),
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

      {showBackToBottom ? (
        <IconButton
          size="small"
          aria-label="回到最新"
          onClick={scrollToBottom}
          sx={{
            position: 'absolute',
            right: 12,
            bottom: 12,
            zIndex: 4,
            width: 32,
            height: 32,
            bgcolor: 'var(--studio-primary)',
            color: '#fff',
            // 平时压得很淡、几乎不占视线；指到或键盘聚焦时才完全显形。
            opacity: 0.42,
            transition: 'opacity 140ms ease, box-shadow 140ms ease',
            boxShadow: '0 4px 12px color-mix(in srgb, var(--studio-text-primary) 12%, transparent)',
            '&:hover, &:focus-visible': {
              opacity: 1,
              bgcolor: 'var(--studio-primary)',
              boxShadow: '0 8px 20px color-mix(in srgb, var(--studio-text-primary) 26%, transparent)',
            },
          }}
        >
          <ArrowDownwardIcon sx={{ fontSize: 18 }} />
        </IconButton>
      ) : null}
    </Box>
  )
})
