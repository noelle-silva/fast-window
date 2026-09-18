import * as React from 'react'
import { Box, CircularProgress } from '@mui/material'

export function AssistantReplyPendingIndicator() {
  return (
    <Box
      role="status"
      aria-live="polite"
      aria-label="AI 回复加载中"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 66,
        minHeight: 32,
        color: 'text.secondary',
        flexShrink: 0,
      }}
    >
      <CircularProgress size={20} thickness={4.4} color="inherit" />
    </Box>
  )
}
