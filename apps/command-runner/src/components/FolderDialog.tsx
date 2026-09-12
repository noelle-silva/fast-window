import * as React from 'react'
import { Box, Button, TextField } from '@mui/material'
import { DialogShell } from './DialogShell'

type FolderDialogProps = {
  title: string
  subtitle?: string
  submitLabel: string
  initialName?: string
  disabled?: boolean
  submitting?: boolean
  onSubmit: (name: string) => Promise<void> | void
  onClose: () => void
}

export function FolderDialog({
  title,
  subtitle,
  submitLabel,
  initialName = '',
  disabled = false,
  submitting = false,
  onSubmit,
  onClose,
}: FolderDialogProps) {
  const [name, setName] = React.useState(initialName)
  const [error, setError] = React.useState<string | null>(null)
  const canSubmit = name.trim().length > 0 && !disabled && !submitting

  const submit = React.useCallback(async () => {
    if (!canSubmit) return
    setError(null)
    try {
      await onSubmit(name.trim())
    } catch (e) {
      setError(String((e as { message?: string })?.message || e || '保存收藏夹失败'))
    }
  }, [canSubmit, name, onSubmit])

  return (
    <DialogShell title={title} subtitle={subtitle} closeDisabled={submitting} onClose={onClose}>
      <Box component="form" className="cr-form" onSubmit={event => {
        event.preventDefault()
        void submit()
      }}>
        <TextField
          autoFocus
          label="收藏夹名称"
          value={name}
          disabled={disabled || submitting}
          onChange={event => setName(event.target.value)}
          fullWidth
        />
        {error ? <Box component="p" sx={{ margin: 0, color: 'error.main', fontSize: 12 }}>{error}</Box> : null}
        <Box className="cr-form-actions">
          <Button type="button" disabled={submitting} onClick={onClose}>取消</Button>
          <Button type="submit" variant="contained" disabled={!canSubmit}>{submitting ? '保存中' : submitLabel}</Button>
        </Box>
      </Box>
    </DialogShell>
  )
}
