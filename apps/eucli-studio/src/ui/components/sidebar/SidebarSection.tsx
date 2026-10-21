import * as React from 'react'
import { Box, Typography } from '@mui/material'

export function SidebarSectionTitle(props: { children: React.ReactNode }) {
  return (
    <Typography variant="caption" sx={{ fontWeight: 900, px: 1.5, color: 'text.secondary' }}>
      {props.children}
    </Typography>
  )
}

export function SidebarEmptyHint(props: { children: React.ReactNode }) {
  return (
    <Box sx={{ px: 1.5, py: 1 }}>
      <Typography variant="body2" color="text.secondary">
        {props.children}
      </Typography>
    </Box>
  )
}
