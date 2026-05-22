import type { ReactNode } from 'react'
import { Box, IconButton, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import { hostButtonSx } from './hostUiStyles'

type HostPageHeaderProps = {
  title: string
  onBack: () => void
  translucent?: boolean
  action?: ReactNode
}

export default function HostPageHeader({ title, onBack, translucent, action }: HostPageHeaderProps) {
  return (
    <Box
      data-tauri-drag-region="true"
      sx={theme => ({
        height: 44,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 0.75,
        bgcolor: translucent ? alpha(theme.palette.background.paper, 0.62) : theme.palette.background.paper,
        backdropFilter: translucent ? 'blur(12px)' : undefined,
        boxShadow: translucent ? `0 10px 28px ${alpha(theme.palette.common.black, 0.06)}` : 'none',
        WebkitAppRegion: 'drag',
      })}
    >
      <IconButton
        aria-label="返回"
        size="small"
        onClick={onBack}
        data-tauri-drag-region="false"
        sx={{ ...hostButtonSx, WebkitAppRegion: 'no-drag' }}
      >
        <ArrowBackRoundedIcon fontSize="small" />
      </IconButton>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ flex: 1, textAlign: 'center', fontWeight: 700, userSelect: 'none', pointerEvents: 'none' }}
      >
        {title}
      </Typography>
      <Box data-tauri-drag-region="false" sx={{ width: 32, height: 32, display: 'grid', placeItems: 'center', WebkitAppRegion: 'no-drag' }}>
        {action}
      </Box>
    </Box>
  )
}
