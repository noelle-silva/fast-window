import * as React from 'react'
import { Box, Button, Typography } from '@mui/material'
import { DialogShell } from './DialogShell'

type ConfirmDialogProps = {
  title: string
  message: string
  confirmLabel: string
  pendingLabel: string
  confirmColor?: 'error' | 'warning' | 'primary'
  disabled?: boolean
  onConfirm: () => Promise<void> | void
  onClose: () => void
}

// ConfirmDialog 是二次确认弹窗的通用原语：标题 + 说明 + 取消/确认两个动作。
// 具体场景（删除、停止等）通过文案与确认按钮配色参数化，交互与防重入逻辑保持一致。
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  pendingLabel,
  confirmColor = 'primary',
  disabled = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [pending, setPending] = React.useState(false)

  const confirm = React.useCallback(async () => {
    if (pending) return
    setPending(true)
    try {
      await onConfirm()
    } finally {
      setPending(false)
    }
  }, [pending, onConfirm])

  return (
    <DialogShell title={title} closeDisabled={pending} onClose={onClose}>
      <Box className="cr-form">
        <Typography sx={{ fontSize: 13, lineHeight: 1.6 }}>{message}</Typography>
        <Box className="cr-form-actions">
          <Button disabled={pending} onClick={onClose}>取消</Button>
          <Button variant="contained" color={confirmColor} disabled={disabled || pending} onClick={confirm}>
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </Box>
      </Box>
    </DialogShell>
  )
}
