import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { Box, ButtonBase, Card, CardContent, IconButton, Tooltip, Typography } from '@mui/material'
import type { TaskItem } from '../types'

type TaskItemCardProps = {
  task: TaskItem
  index: number
  onCopy: (task: TaskItem) => Promise<void> | void
  onOpen: (task: TaskItem) => void
}

export function formatTaskItemText(task: TaskItem) {
  return [task.title, task.description].map(value => value.trim()).filter(Boolean).join('\n')
}

export function TaskItemCard({ task, index, onCopy, onOpen }: TaskItemCardProps) {
  return (
    <Card className="tm-task-card" variant="outlined">
      <CardContent className="tm-task-card-content">
        <ButtonBase className="tm-task-card-main" onClick={() => onOpen(task)} aria-label={`查看任务详情：${task.title}`}>
          <Box className="tm-task-index" aria-hidden="true">{index + 1}</Box>
          <Box className="tm-task-card-body">
            <Typography component="h3" sx={{ fontSize: 14, fontWeight: 800 }}>{task.title}</Typography>
            {task.description ? (
              <Typography className="tm-task-card-preview" color="text.secondary" sx={{ mt: 0.5, fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {task.description}
              </Typography>
            ) : null}
          </Box>
        </ButtonBase>
        <Box className="tm-task-card-actions">
          <Tooltip title="复制任务">
            <IconButton size="small" aria-label={`复制任务：${task.title}`} onClick={() => onCopy(task)}>
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </CardContent>
    </Card>
  )
}
