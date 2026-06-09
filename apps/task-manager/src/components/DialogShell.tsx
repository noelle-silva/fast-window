import * as React from 'react'
import CloseIcon from '@mui/icons-material/Close'
import { Box, Dialog, DialogContent, DialogTitle, IconButton, Typography } from '@mui/material'

type DialogShellProps = {
  title: string
  subtitle?: string
  action?: React.ReactNode
  closeDisabled?: boolean
  children: React.ReactNode
  onClose: () => void
}

export function DialogShell({ title, subtitle, action, closeDisabled = false, children, onClose }: DialogShellProps) {
  return (
    <Dialog open onClose={closeDisabled ? undefined : onClose} fullWidth maxWidth="md" aria-labelledby="tm-dialog-title" PaperProps={{ className: 'tm-dialog' }}>
      <DialogTitle id="tm-dialog-title" className="tm-dialog-header" component="div">
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h2" sx={{ fontSize: 18, fontWeight: 900 }}>{title}</Typography>
          {subtitle ? <Typography color="text.secondary" sx={{ mt: 0.75, fontSize: 12, lineHeight: 1.5 }}>{subtitle}</Typography> : null}
        </Box>
        <Box className="tm-dialog-actions">
          {action}
          <IconButton size="small" disabled={closeDisabled} aria-label="关闭" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
        </Box>
      </DialogTitle>
      <DialogContent className="tm-dialog-content" dividers>
        {children}
      </DialogContent>
    </Dialog>
  )
}
