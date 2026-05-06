import * as React from 'react'
import { Box, Typography } from '@mui/material'

type EmptyStateProps = {
  message: string
}

export function EmptyState(props: EmptyStateProps) {
  return (
    <Box sx={{ color: 'text.secondary', py: 3, textAlign: 'center' }}>
      <Typography variant="body2">{props.message}</Typography>
    </Box>
  )
}
