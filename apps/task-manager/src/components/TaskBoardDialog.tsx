import * as React from 'react'
import AddIcon from '@mui/icons-material/Add'
import { Alert, Box, IconButton, Snackbar, Typography } from '@mui/material'
import { DialogShell } from './DialogShell'
import { formatTaskItemText, TaskItemCard } from './TaskItemCard'
import type { TaskBoard, TaskDraft, TaskItem } from '../types'

type TaskBoardDialogProps = {
  board: TaskBoard
  onCreateTask: () => void
  onEditTask: (task: TaskItem) => void
  onPasteTask: (draft: TaskDraft) => void
  onClose: () => void
}

export function TaskBoardDialog({ board, onCreateTask, onEditTask, onPasteTask, onClose }: TaskBoardDialogProps) {
  const [copyMessage, setCopyMessage] = React.useState<string | null>(null)

  const copyTask = React.useCallback(async (task: TaskItem) => {
    await navigator.clipboard.writeText(formatTaskItemText(task))
    setCopyMessage('已复制任务内容')
  }, [])

  return (
    <>
      <DialogShell
        title={board.title}
        subtitle={board.description || '在这里记录一行一个任务。直接 Ctrl+V 可从剪贴板新建条目。'}
        onClose={onClose}
        action={<IconButton size="small" aria-label="新增任务" onClick={onCreateTask}><AddIcon fontSize="small" /></IconButton>}
      >
        <Box className="tm-task-panel" tabIndex={0} onPaste={event => {
          const text = event.clipboardData.getData('text').trim()
          if (!text) return
          event.preventDefault()
          const [title, ...rest] = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
          onPasteTask({ title, description: rest.join('\n') })
        }}>
          {board.tasks.length ? (
            <Box className="tm-task-list">
              {board.tasks.map((task, index) => (
                <TaskItemCard key={task.id} task={task} index={index} onCopy={copyTask} onEdit={onEditTask} />
              ))}
            </Box>
          ) : (
            <Box className="tm-empty-state">
              <Typography component="strong" sx={{ fontSize: 16, fontWeight: 900 }}>还没有任务</Typography>
              <Typography component="span" color="text.secondary" sx={{ fontSize: 13 }}>点右上角加号，或者直接 Ctrl+V 粘贴文字。</Typography>
            </Box>
          )}
        </Box>
      </DialogShell>
      <Snackbar open={Boolean(copyMessage)} autoHideDuration={1600} onClose={() => setCopyMessage(null)}>
        <Alert severity="success" variant="outlined" onClose={() => setCopyMessage(null)}>{copyMessage}</Alert>
      </Snackbar>
    </>
  )
}
