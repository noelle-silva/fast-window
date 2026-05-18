import * as React from 'react'
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded'
import DoneRoundedIcon from '@mui/icons-material/DoneRounded'
import { Button, IconButton, type SxProps, type Theme } from '@mui/material'

type SortModeButtonProps = {
  enabled: boolean
  onClick: () => void
  disabled?: boolean
  idleLabel?: string
  activeLabel?: string
}

type SortHandleButtonProps = {
  enabled: boolean
  label: string
  handleRef?: React.Ref<any>
  handleProps?: Record<string, any>
  isDragging?: boolean
  sx?: SxProps<Theme>
}

export function SortModeButton(props: SortModeButtonProps) {
  const { enabled, onClick, disabled = false, idleLabel = '排序模式', activeLabel = '完成排序' } = props
  return (
    <Button
      size="small"
      variant={enabled ? 'contained' : 'outlined'}
      onClick={onClick}
      disabled={disabled}
      startIcon={enabled ? <DoneRoundedIcon fontSize="small" /> : <DragIndicatorRoundedIcon fontSize="small" />}
    >
      {enabled ? activeLabel : idleLabel}
    </Button>
  )
}

export function SortHandleButton(props: SortHandleButtonProps) {
  const { enabled, label, handleRef, handleProps, isDragging = false, sx } = props
  if (!enabled) return null
  return (
    <IconButton
      size="small"
      ref={handleRef as any}
      aria-label={label}
      {...(handleProps || {})}
      sx={[
        {
          color: 'text.secondary',
          cursor: isDragging ? 'grabbing' : 'grab',
          touchAction: 'none',
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      <DragIndicatorRoundedIcon fontSize="small" />
    </IconButton>
  )
}
