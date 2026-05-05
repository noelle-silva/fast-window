import * as React from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import CropSquareRoundedIcon from '@mui/icons-material/CropSquareRounded'
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded'
import { Box, IconButton, Tooltip } from '@mui/material'

export type WindowControlActions = {
  minimize: () => Promise<void> | void
  toggleMaximize: () => Promise<void> | void
  closeToTray: () => Promise<void> | void
}

type StandaloneWindowControlsProps = {
  actions: WindowControlActions
}

export function StandaloneWindowControls(props: StandaloneWindowControlsProps) {
  const { actions } = props

  const run = React.useCallback((action: () => Promise<void> | void) => {
    Promise.resolve(action()).catch(() => {})
  }, [])

  return (
    <Box
      data-window-controls="true"
      aria-label="窗口控制"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.25,
        ml: 0.5,
        WebkitAppRegion: 'no-drag',
      }}
    >
      <Tooltip title="最小化">
        <IconButton size="small" aria-label="最小化" onClick={() => run(actions.minimize)}>
          <RemoveRoundedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="最大化或还原">
        <IconButton size="small" aria-label="最大化或还原" onClick={() => run(actions.toggleMaximize)}>
          <CropSquareRoundedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="关闭到托盘">
        <IconButton
          size="small"
          aria-label="关闭到托盘"
          onClick={() => run(actions.closeToTray)}
          sx={{
            '&:hover': {
              bgcolor: 'error.main',
              color: 'error.contrastText',
            },
            '&:focus-visible': {
              outline: '2px solid rgba(211,47,47,.35)',
              outlineOffset: 2,
            },
          }}
        >
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  )
}
