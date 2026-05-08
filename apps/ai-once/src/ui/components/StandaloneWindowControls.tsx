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
  const run = React.useCallback((action: () => Promise<void> | void) => {
    Promise.resolve(action()).catch(() => {})
  }, [])

  return (
    <Box data-window-controls="true" aria-label="窗口控制" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
      <Tooltip title="最小化">
        <IconButton aria-label="最小化" onClick={() => run(props.actions.minimize)}>
          <RemoveRoundedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="最大化或还原">
        <IconButton aria-label="最大化或还原" onClick={() => run(props.actions.toggleMaximize)}>
          <CropSquareRoundedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="隐藏到托盘">
        <IconButton
          aria-label="隐藏到托盘"
          onClick={() => run(props.actions.closeToTray)}
          sx={{
            '&:hover': { bgcolor: 'error.main', color: 'error.contrastText' },
            '&:focus-visible': { bgcolor: 'error.main', color: 'error.contrastText', boxShadow: '0 0 0 4px rgba(220,38,38,.16)' },
          }}
        >
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  )
}
