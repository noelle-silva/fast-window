import * as React from 'react'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { Box, Button, TextField, Typography } from '@mui/material'
import { DialogShell } from './DialogShell'
import type { TaskDraft, TaskItem } from '../types'

type TaskDetailDialogProps = {
  task: TaskItem
  disabled?: boolean
  submitting?: boolean
  onSave: (draft: TaskDraft) => Promise<void> | void
  onClose: () => void
}

function formatDateTimeText(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function TaskDetailDialog({ task, disabled = false, submitting = false, onSave, onClose }: TaskDetailDialogProps) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState<TaskDraft>({ title: task.title, description: task.description })
  const canSave = draft.title.trim().length > 0 && !disabled && !submitting

  React.useEffect(() => {
    setDraft({ title: task.title, description: task.description })
  }, [task.id, task.title, task.description])

  const cancelEdit = React.useCallback(() => {
    setDraft({ title: task.title, description: task.description })
    setEditing(false)
  }, [task.description, task.title])

  const save = React.useCallback(async () => {
    if (!canSave) return
    try {
      await Promise.resolve(onSave(draft))
      setEditing(false)
    } catch {
      // The parent owns the visible error message; the dialog stays editable.
    }
  }, [canSave, draft, onSave])

  React.useEffect(() => {
    if (!editing) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editing, save])

  return (
    <DialogShell
      title="任务详情"
      subtitle={editing ? '修改标题与描述，按 Ctrl+S 也可以保存。' : '先查看任务内容，需要调整时再进入编辑。'}
      closeDisabled={submitting}
      onClose={onClose}
      action={!editing ? <Button startIcon={<EditOutlinedIcon fontSize="small" />} disabled={disabled || submitting} onClick={() => setEditing(true)}>编辑</Button> : null}
    >
      {editing ? (
        <Box component="form" className="tm-task-detail-form" onSubmit={event => {
          event.preventDefault()
          void save()
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
            minRows={7}
          />
          <Box className="tm-form-actions">
            <Button type="button" disabled={submitting} onClick={cancelEdit}>取消编辑</Button>
            <Button type="submit" disabled={!canSave}>{submitting ? '保存中' : '保存'}</Button>
          </Box>
        </Box>
      ) : (
        <Box className="tm-task-detail-view">
          <Typography component="h3" sx={{ fontSize: 20, fontWeight: 900 }}>{task.title}</Typography>
          <Box className="tm-task-detail-description">
            <Typography color={task.description ? 'text.primary' : 'text.secondary'} sx={{ fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {task.description || '这个任务还没有描述。'}
            </Typography>
          </Box>
          <Box className="tm-task-meta" aria-label="任务时间">
            <Typography component="span" color="text.secondary" sx={{ fontSize: 12 }}>创建：{formatDateTimeText(task.createdAt)}</Typography>
            <Typography component="span" color="text.secondary" sx={{ fontSize: 12 }}>更新：{formatDateTimeText(task.updatedAt)}</Typography>
          </Box>
        </Box>
      )}
    </DialogShell>
  )
}
