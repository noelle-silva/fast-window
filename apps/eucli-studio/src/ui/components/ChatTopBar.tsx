import * as React from 'react'
import { AppBar, Box, IconButton, Toolbar, Typography } from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import { colorMixVar } from '../colorThemeStyles'
import { ChatNavControls, type ChatNavControlsProps } from './ChatNavControls'

export function ChatTopBar(props: {
  page: 'chat' | 'settings'
  topbarOpacity: number
  topbarBlur: number
  standaloneWindowControls: React.ReactNode
  onTopbarPointerDown: (e: React.PointerEvent) => void
  onCloseSettings: () => void
  nav: ChatNavControlsProps
}) {
  const { page, topbarOpacity, topbarBlur, standaloneWindowControls, onTopbarPointerDown, onCloseSettings, nav } = props

  return (
    <AppBar
      position="absolute"
      elevation={0}
      sx={{
        bgcolor: colorMixVar('--studio-topbar', topbarOpacity),
        color: 'text.primary',
        borderBottom: 'none',
        backdropFilter: topbarBlur > 0 ? `blur(${topbarBlur}px)` : 'none',
        WebkitBackdropFilter: topbarBlur > 0 ? `blur(${topbarBlur}px)` : 'none',
        top: 0,
        left: 0,
        right: 0,
      }}
    >
      <Toolbar
        variant="dense"
        sx={{
          gap: 0.5,
          minHeight: 40,
          px: 1,
          '&.MuiToolbar-root': { minHeight: 40 },
        }}
        onPointerDown={onTopbarPointerDown}
      >
        {page === 'settings' ? (
          <>
            <IconButton onClick={onCloseSettings} size="small">
              <ChevronLeftIcon fontSize="small" />
            </IconButton>

            <Typography variant="subtitle2" sx={{ fontWeight: 900, mr: 0.5 }}>
              设置
            </Typography>

            <Box sx={{ flex: 1, minWidth: 8 }} />
            {standaloneWindowControls}
          </>
        ) : (
          <>
            <ChatNavControls {...nav} />
            {standaloneWindowControls}
          </>
        )}
      </Toolbar>
    </AppBar>
  )
}
