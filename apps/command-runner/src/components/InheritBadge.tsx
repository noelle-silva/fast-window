import * as React from 'react'
import { Box } from '@mui/material'

export function InheritBadge() {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        flexShrink: 0,
        fontSize: 10,
        fontWeight: 800,
        color: 'info.main',
        px: 0.6,
        py: 0.1,
        borderRadius: 999,
        border: '1px solid',
        borderColor: 'info.main',
        bgcolor: 'rgba(25, 118, 210, 0.06)',
      }}
    >
      继承
    </Box>
  )
}
