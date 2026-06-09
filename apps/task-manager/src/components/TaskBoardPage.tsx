import * as React from 'react'
import AddIcon from '@mui/icons-material/Add'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { Alert, Box, Button, IconButton, Snackbar, Typography } from '@mui/material'
import { formatTaskItemText, TaskItemCard } from './TaskItemCard'
import type { TaskBoard, TaskDraft, TaskItem } from '../types'

type TaskBoardPageProps = {
  board: TaskBoard
  disabled?: boolean
  onBack: () => void
  onCreateTask: () => void
  onOpenTask: (task: TaskItem) => void
  onPasteTask: (draft: TaskDraft) => Promise<void> | void
}

export function TaskBoardPage({ board, disabled = false, onBack, onCreateTask, onOpenTask, onPasteTask }: TaskBoardPageProps) {
  const [copyMessage, setCopyMessage] = React.useState<string | null>(null)
  const taskPanelRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    taskPanelRef.current?.focus()
  }, [board.id])

  const copyTask = React.useCallback(async (task: TaskItem) => {
    await navigator.clipboard.writeText(formatTaskItemText(task))
    setCopyMessage('已复制任务内容')
  }, [])

  return (
    <>
      <section className="tm-board-page" aria-labelledby="tm-board-page-title">
        <Box className="tm-board-page-header">
          <IconButton size="small" aria-label="返回任务分组" onClick={onBack}>
            <ArrowBackIcon fontSize="small" />
          </IconButton>
          <Box className="tm-board-page-heading">
            <Typography id="tm-board-page-title" component="h1" sx={{ fontSize: 20, fontWeight: 900 }}>{board.title}</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.75, fontSize: 13, lineHeight: 1.5 }}>
              {board.description || '在这里记录一行一个任务。直接 Ctrl+V 可从剪贴板新建条目。'}
            </Typography>
          </Box>
          <Button startIcon={<AddIcon fontSize="small" />} disabled={disabled} onClick={onCreateTask}>新建任务</Button>
        </Box>

        <Box ref={taskPanelRef} className="tm-task-panel tm-task-page-panel" tabIndex={0} onPaste={event => {
          if (disabled) return
          const text = event.clipboardData.getData('text').trim()
          if (!text) return
          event.preventDefault()
          const [title, ...rest] = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
          void Promise.resolve(onPasteTask({ title, description: rest.join('\n') }))
        }}>
          {board.tasks.length ? (
            <Box className="tm-task-list">
              {board.tasks.map((task, index) => (
                <TaskItemCard key={task.id} task={task} index={index} onCopy={copyTask} onOpen={onOpenTask} />
              ))}
            </Box>
          ) : (
            <Box className="tm-empty-state">
              <Typography component="strong" sx={{ fontSize: 16, fontWeight: 900 }}>还没有任务</Typography>
              <Typography component="span" color="text.secondary" sx={{ fontSize: 13 }}>点右上角加号，或者直接 Ctrl+V 粘贴文字。</Typography>
            </Box>
          )}
        </Box>
      </section>
      <Snackbar open={Boolean(copyMessage)} autoHideDuration={1600} onClose={() => setCopyMessage(null)}>
        <Alert severity="success" variant="outlined" onClose={() => setCopyMessage(null)}>{copyMessage}</Alert>
      </Snackbar>
    </>
  )
}
