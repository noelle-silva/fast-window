import * as React from 'react'
import { Box } from '@mui/material'
import { colorMixVar } from '../colorThemeStyles'
import { TOPBAR_H } from '../appConstants'
import type { SidebarId, SidebarSide } from '../../domain/sidebarLayout'

// 侧边栏外壳：A / B 两个身份共用同一套位置、宽度、背景与拖拽把手。
// 这里只管「怎么摆」，内容通过 header 与 children 注入，不再各自维护一套外壳。
export type SidebarFrameProps = {
  sidebarId: SidebarId
  ariaLabel: string
  side: SidebarSide
  width: number
  sidebarRef: React.Ref<HTMLElement>
  resizing: boolean
  onSplitterPointerDown: (e: React.PointerEvent) => void
  topbarOpacity: number
  topbarBlur: number
  header?: React.ReactNode
  children: React.ReactNode
}

export function SidebarFrame(props: SidebarFrameProps) {
  const {
    sidebarId,
    ariaLabel,
    side,
    width,
    sidebarRef,
    resizing,
    onSplitterPointerDown,
    topbarOpacity,
    topbarBlur,
    header,
    children,
  } = props

  return (
    <Box
      component="nav"
      aria-label={ariaLabel}
      data-sidebar-id={sidebarId}
      ref={sidebarRef}
      sx={{
        position: 'relative',
        width,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        pt: `${TOPBAR_H}px`,
        bgcolor: colorMixVar('--studio-topbar', topbarOpacity),
        backdropFilter: topbarBlur > 0 ? `blur(${topbarBlur}px)` : 'none',
        WebkitBackdropFilter: topbarBlur > 0 ? `blur(${topbarBlur}px)` : 'none',
      }}
    >
      <Box
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧边栏宽度"
        onPointerDown={onSplitterPointerDown}
        sx={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          width: 6,
          zIndex: 2,
          cursor: 'col-resize',
          ...(side === 'left' ? { right: 0 } : { left: 0 }),
          bgcolor: resizing ? 'primary.main' : 'transparent',
          transition: 'background-color 120ms ease',
          transitionDelay: '0ms',
          '&:hover': { bgcolor: 'primary.main', transitionDelay: '150ms' },
        }}
      />

      {header}

      {children}
    </Box>
  )
}
