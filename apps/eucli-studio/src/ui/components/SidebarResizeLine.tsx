import * as React from 'react'
import { Box } from '@mui/material'

// 拖拽侧边栏宽度时的宽度指示线：整窗高的一条竖线，仅拖拽期间存在。
// 只做平移（transform），不参与布局；拖拽期间由 useSidebarResize 直接改它的 transform。
export function SidebarResizeLine(props: {
  lineRef: React.Ref<HTMLDivElement>
  active: boolean
}) {
  const { lineRef, active } = props
  if (!active) return null
  return (
    <Box
      ref={lineRef}
      data-sidebar-resize-line="1"
      aria-hidden="true"
      sx={{
        position: 'fixed',
        top: 0,
        bottom: 0,
        left: 0,
        width: '2px',
        bgcolor: 'primary.main',
        pointerEvents: 'none',
        zIndex: 2000,
        willChange: 'transform',
      }}
    />
  )
}
