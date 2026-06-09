import * as React from 'react'
import AddIcon from '@mui/icons-material/Add'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import CropSquareIcon from '@mui/icons-material/CropSquare'
import RemoveIcon from '@mui/icons-material/Remove'
import { Box, IconButton, Typography } from '@mui/material'

type WindowActions = {
  minimize: () => Promise<void> | void
  toggleMaximize: () => Promise<void> | void
  closeToTray: () => Promise<void> | void
}

type TaskTopbarProps = {
  standalone: boolean
  disabled?: boolean
  onCreateBoard: () => void
  onStartDragging: () => Promise<void> | void
  windowActions: WindowActions
}

function run(action: () => Promise<void> | void) {
  Promise.resolve(action()).catch(() => {})
}

export function TaskTopbar({ standalone, disabled = false, onCreateBoard, onStartDragging, windowActions }: TaskTopbarProps) {
  const onPointerDown = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement | null
    if (target?.closest('button, a, input, textarea, select, [role="button"], [data-window-controls="true"]')) return
    run(onStartDragging)
  }, [onStartDragging])

  return (
    <Box component="header" className="tm-topbar" onPointerDown={onPointerDown}>
      <Box className="tm-brand">
        <Box className="tm-brand-mark" aria-hidden="true"><CheckIcon sx={{ fontSize: 15 }} /></Box>
        <Typography component="span" sx={{ minWidth: 0, fontSize: 14, fontWeight: 900 }}>Task Manager</Typography>
      </Box>
      <Box className="tm-topbar-spacer" />
      <IconButton size="small" disabled={disabled} onClick={onCreateBoard} aria-label="新建任务分组">
        <AddIcon fontSize="small" />
      </IconButton>
      {standalone ? (
        <Box className="tm-window-controls" data-window-controls="true" aria-label="窗口控制">
          <IconButton size="small" aria-label="最小化" onClick={() => run(windowActions.minimize)}><RemoveIcon fontSize="small" /></IconButton>
          <IconButton size="small" aria-label="最大化或还原" onClick={() => run(windowActions.toggleMaximize)}><CropSquareIcon fontSize="small" /></IconButton>
          <IconButton size="small" className="tm-close-button" aria-label="关闭到托盘" onClick={() => run(windowActions.closeToTray)}><CloseIcon fontSize="small" /></IconButton>
        </Box>
      ) : null}
    </Box>
  )
}
