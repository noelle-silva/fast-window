import * as React from 'react'
import { Box } from '@mui/material'
import type { SidebarLayout } from './sidebarLayout'

export type SidebarRailProps = {
  /** 边栏所在侧：决定浮层锚点与阴影方向。 */
  side: 'left' | 'right'
  layout: SidebarLayout
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  children: React.ReactNode
}

// 边栏外壳：轨道占位 + 面板 + 悬停覆盖。左右边栏共用，仅锚点与阴影方向随所在侧翻转。
export function SidebarRail(props: SidebarRailProps): React.ReactNode {
  const { side, layout, onMouseEnter, onMouseLeave, children } = props
  const overlay = layout.overlay
  return (
    <Box
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      sx={{
        width: layout.railWidth,
        minWidth: layout.railWidth,
        minHeight: 0,
        position: 'relative',
        bgcolor: 'var(--hc-surface-soft)',
      }}
    >
      <Box
        sx={{
          width: layout.panelWidth,
          minHeight: 0,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'var(--hc-surface)',
          position: overlay ? 'absolute' : 'relative',
          left: side === 'left' ? 0 : 'auto',
          right: side === 'right' ? 0 : 'auto',
          top: 0,
          bottom: 0,
          zIndex: overlay ? 20 : 'auto',
          boxShadow: layout.panelWidth > layout.railWidth ? (side === 'left' ? '12px 0 30px rgba(15,23,42,.07)' : '-12px 0 30px rgba(15,23,42,.07)') : 'none',
        }}
      >
        {children}
      </Box>
    </Box>
  )
}
