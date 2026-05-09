import * as React from 'react'
import { Box } from '@mui/material'

export function DesktopBackdrop(): React.ReactNode {
  return (
    <Box aria-hidden="true" sx={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <Box sx={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 18% 14%, rgba(37,99,235,.30), transparent 28%), radial-gradient(circle at 82% 18%, rgba(20,184,166,.20), transparent 30%), linear-gradient(135deg, #526B8C 0%, #7C8DA4 44%, #A6B0BA 100%)' }} />
      <Box sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(15,23,42,.18), rgba(15,23,42,.06))' }} />
    </Box>
  )
}
