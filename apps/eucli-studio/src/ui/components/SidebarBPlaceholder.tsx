import * as React from 'react'
import { Box, Typography } from '@mui/material'
import type { SidebarSide } from '../../domain/sidebarLayout'
import { SidebarFrame } from './SidebarFrame'

// 侧边栏 B：客户端内的第二块侧边栏。
// 外壳与 A 完全复用（位置、宽度、拖拽把手都由 SidebarFrame 承担），
// 这里当前只放占位内容，具体面板后续在这个 children 位置接入。
export type SidebarBPlaceholderProps = {
  side: SidebarSide
  width: number
  sidebarRef: React.Ref<HTMLElement>
  resizing: boolean
  onSplitterPointerDown: (e: React.PointerEvent) => void
  topbarOpacity: number
  topbarBlur: number
}

export function SidebarBPlaceholder(props: SidebarBPlaceholderProps) {
  const { side, width, sidebarRef, resizing, onSplitterPointerDown, topbarOpacity, topbarBlur } = props

  const header = (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
        minHeight: 34,
        px: 1.5,
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Typography sx={{ fontSize: 12, fontWeight: 900 }}>侧边栏 B</Typography>
    </Box>
  )

  return (
    <SidebarFrame
      sidebarId="b"
      ariaLabel="侧边栏 B"
      side={side}
      width={width}
      sidebarRef={sidebarRef}
      resizing={resizing}
      onSplitterPointerDown={onSplitterPointerDown}
      topbarOpacity={topbarOpacity}
      topbarBlur={topbarBlur}
      header={header}
    >
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 2,
        }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center', lineHeight: 1.7 }}>
          这里之后放侧边栏 B 的内容。
          <br />
          位置与宽度已经可以和侧边栏 A 分别调整。
        </Typography>
      </Box>
    </SidebarFrame>
  )
}
