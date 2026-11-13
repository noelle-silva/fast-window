import * as React from 'react'
import { Box, Typography } from '@mui/material'

// 侧边栏的空态提示。分组标题不再有：搜索框就是每个清单的头，标题与它重复。
export function SidebarEmptyHint(props: { children: React.ReactNode }) {
  return (
    <Box sx={{ px: 1.5, py: 1 }}>
      <Typography variant="body2" color="text.secondary">
        {props.children}
      </Typography>
    </Box>
  )
}
