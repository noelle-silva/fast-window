import * as React from 'react'
import CropSquareIcon from '@mui/icons-material/CropSquare'
import RemoveIcon from '@mui/icons-material/Remove'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import CloseIcon from '@mui/icons-material/Close'
import TerminalOutlinedIcon from '@mui/icons-material/TerminalOutlined'
import { Box, IconButton, Typography } from '@mui/material'

type WindowActions = {
  minimize: () => Promise<void> | void
  toggleMaximize: () => Promise<void> | void
  closeToTray: () => Promise<void> | void
}

type AppTopbarProps = {
  standalone: boolean
  disabled?: boolean
  onOpenSettings: () => void
  onStartDragging: () => Promise<void> | void
  windowActions: WindowActions
}

function run(action: () => Promise<void> | void) {
  Promise.resolve(action()).catch(() => {})
}

export function AppTopbar({ standalone, disabled = false, onOpenSettings, onStartDragging, windowActions }: AppTopbarProps) {
  const onPointerDown = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement | null
    if (target?.closest('button, a, input, textarea, select, [role="button"], [data-window-controls="true"]')) return
    run(onStartDragging)
  }, [onStartDragging])

  return (
    <Box component="header" className="cr-topbar" onPointerDown={onPointerDown}>
      <Box className="cr-brand">
        <Box className="cr-brand-mark" aria-hidden="true"><TerminalOutlinedIcon sx={{ fontSize: 15 }} /></Box>
        <Typography component="span" sx={{ minWidth: 0, fontSize: 14, fontWeight: 900 }}>Command Runner</Typography>
      </Box>
      <Box className="cr-topbar-spacer" />
      <IconButton size="small" disabled={disabled} onClick={onOpenSettings} aria-label="设置">
        <SettingsOutlinedIcon fontSize="small" />
      </IconButton>
      {standalone ? (
        <Box className="cr-window-controls" data-window-controls="true" aria-label="窗口控制">
          <IconButton size="small" aria-label="最小化" onClick={() => run(windowActions.minimize)}><RemoveIcon fontSize="small" /></IconButton>
          <IconButton size="small" aria-label="最大化或还原" onClick={() => run(windowActions.toggleMaximize)}><CropSquareIcon fontSize="small" /></IconButton>
          <IconButton size="small" className="cr-close-button" aria-label="关闭到托盘" onClick={() => run(windowActions.closeToTray)}><CloseIcon fontSize="small" /></IconButton>
        </Box>
      ) : null}
    </Box>
  )
}
