import * as React from 'react'
import { Box, Button, TextField } from '@mui/material'
import { DialogShell } from './DialogShell'
import type { TaskDraft } from '../types'

type CreateDialogProps = {
  title: string
  submitLabel: string
  subtitle?: string
  initialDraft?: TaskDraft
  disabled?: boolean
  submitting?: boolean
  onSubmit: (draft: TaskDraft) => Promise<void> | void
  onClose: () => void
}

const EMPTY_DRAFT: TaskDraft = { title: '', description: '' }

export function CreateDialog({
  title,
  submitLabel,
  subtitle = '填写标题与描述，按 Ctrl+S 也可以保存。',
  initialDraft = EMPTY_DRAFT,
  disabled = false,
  submitting = false,
  onSubmit,
  onClose,
}: CreateDialogProps) {
  const [draft, setDraft] = React.useState<TaskDraft>(initialDraft)
  const canSave = draft.title.trim().length > 0 && !disabled && !submitting

  React.useEffect(() => {
    setDraft(initialDraft)
  }, [initialDraft.title, initialDraft.description])

  const save = React.useCallback(() => {
    if (!canSave) return
    void Promise.resolve(onSubmit(draft))
  }, [canSave, draft, onSubmit])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        save()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [save])

  return (
    <DialogShell title={title} subtitle={subtitle} closeDisabled={submitting} onClose={onClose}>
      <Box component="form" className="tm-create-form" onSubmit={event => {
        event.preventDefault()
        save()
      }}>
        <TextField
          autoFocus
          label="标题"
          value={draft.title}
          disabled={disabled || submitting}
          onChange={event => setDraft(current => ({ ...current, title: event.target.value }))}
          fullWidth
        />
        <TextField
          label="描述"
          value={draft.description}
          disabled={disabled || submitting}
          onChange={event => setDraft(current => ({ ...current, description: event.target.value }))}
          fullWidth
          multiline
          minRows={5}
        />
        <Box className="tm-form-actions">
          <Button type="button" disabled={submitting} onClick={onClose}>取消</Button>
          <Button type="submit" disabled={!canSave}>{submitting ? '保存中' : submitLabel}</Button>
        </Box>
      </Box>
    </DialogShell>
  )
}
