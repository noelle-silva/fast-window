import * as React from 'react'
import { DialogContent, Stack, type SxProps, type Theme } from '@mui/material'
import { CustomScrollArea } from './CustomScrollArea'

type ScrollableDialogContentProps = {
  children: React.ReactNode
  spacing?: number
  maxHeight?: string | number
  contentSx?: SxProps<Theme>
}

export function ScrollableDialogContent(props: ScrollableDialogContentProps) {
  const { children, spacing = 2, maxHeight = 'calc(100vh - 190px)', contentSx } = props
  return (
    <DialogContent sx={{ p: 0, overflow: 'hidden' }}>
      <CustomScrollArea hostSx={{ maxHeight }} scrollSx={{ maxHeight }}>
        <Stack spacing={spacing} sx={[{ p: 3 }, ...(Array.isArray(contentSx) ? contentSx : contentSx ? [contentSx] : [])]}>
          {children}
        </Stack>
      </CustomScrollArea>
    </DialogContent>
  )
}
