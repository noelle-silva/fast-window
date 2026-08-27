import * as React from 'react'
import { Box, Button, Typography } from '@mui/material'
import { DialogShell } from './DialogShell'

type DeleteConfirmDialogProps = {
  title: string
  message: string
  disabled?: boolean
  onConfirm: () => Promise<void> | void
  onClose: () => void
}

export function DeleteConfirmDialog({ title, message, disabled = false, onConfirm, onClose }: DeleteConfirmDialogProps) {
  const [deleting, setDeleting] = React.useState(false)

  const confirm = React.useCallback(async () => {
    if (deleting) return
    setDeleting(true)
    try {
      await onConfirm()
    } finally {
      setDeleting(false)
    }
  }, [deleting, onConfirm])

  return (
    <DialogShell title={title} closeDisabled={deleting} onClose={onClose}>
      <Box className="cr-form">
        <Typography sx={{ fontSize: 13, lineHeight: 1.6 }}>{message}</Typography>
        <Box className="cr-form-actions">
          <Button disabled={deleting} onClick={onClose}>取消</Button>
          <Button variant="contained" color="error" disabled={disabled || deleting} onClick={confirm}>
            {deleting ? '删除中' : '确认删除'}
          </Button>
        </Box>
      </Box>
    </DialogShell>
  )
}
