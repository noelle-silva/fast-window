import * as React from 'react'
import { Button, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material'
import { DependableDialog } from './DependableOverlay'

// ReasoningCleanDialog 是思维链清洗的关键词输入弹窗：一行一个关键词，
// 确认后把输入原样交给调用方解析（解析规则见 domain/reasoningCleaning）。
export function ReasoningCleanDialog(props: {
  open: boolean
  busy?: boolean
  onClose: () => void
  onConfirm: (keywordsText: string) => void
}) {
  const { open, busy, onClose, onConfirm } = props
  const [text, setText] = React.useState('')

  React.useEffect(() => {
    if (!open) setText('')
  }, [open])

  return (
    <DependableDialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>清洗思维链</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          一行一个关键词；思维链里命中的关键词会被删除，正文与其他内容不受影响。
        </Typography>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={4}
          size="small"
          placeholder={'关键词，一行一个'}
          value={text}
          disabled={!!busy}
          onChange={(event) => setText(event.target.value)}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={!!busy}>
          取消
        </Button>
        <Button variant="contained" onClick={() => onConfirm(text)} disabled={!!busy || !text.trim()}>
          清洗
        </Button>
      </DialogActions>
    </DependableDialog>
  )
}
