import * as React from 'react'
import { Box, Button, TextField } from '@mui/material'
import { DialogShell } from './DialogShell'
import type { TaskDraft } from '../types'

type CreateDialogProps = {
  title: string
  submitLabel: string
  subtitle?: string
  initialDraft?: TaskDraft
  onSubmit: (draft: TaskDraft) => void
  onClose: () => void
}

const EMPTY_DRAFT: TaskDraft = { title: '', description: '' }

export function CreateDialog({
  title,
  submitLabel,
  subtitle = '填写标题与描述，按 Ctrl+S 也可以保存。',
  initialDraft = EMPTY_DRAFT,
  onSubmit,
  onClose,
}: CreateDialogProps) {
  const [draft, setDraft] = React.useState<TaskDraft>(initialDraft)
  const canSave = draft.title.trim().length > 0

  React.useEffect(() => {
    setDraft(initialDraft)
  }, [initialDraft.title, initialDraft.description])

  const save = React.useCallback(() => {
    if (!canSave) return
    onSubmit(draft)
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
    <DialogShell title={title} subtitle={subtitle} onClose={onClose}>
      <Box component="form" className="tm-create-form" onSubmit={event => {
        event.preventDefault()
        save()
      }}>
        <TextField
          autoFocus
          label="标题"
          value={draft.title}
          onChange={event => setDraft(current => ({ ...current, title: event.target.value }))}
          fullWidth
        />
        <TextField
          label="描述"
          value={draft.description}
          onChange={event => setDraft(current => ({ ...current, description: event.target.value }))}
          fullWidth
          multiline
          minRows={5}
        />
        <Box className="tm-form-actions">
          <Button type="button" onClick={onClose}>取消</Button>
          <Button type="submit" disabled={!canSave}>{submitLabel}</Button>
        </Box>
      </Box>
    </DialogShell>
  )
}
