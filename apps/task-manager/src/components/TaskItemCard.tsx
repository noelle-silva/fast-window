import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { Box, Card, CardContent, IconButton, Tooltip, Typography } from '@mui/material'
import type { TaskItem } from '../types'

type TaskItemCardProps = {
  task: TaskItem
  index: number
  onCopy: (task: TaskItem) => Promise<void> | void
  onEdit: (task: TaskItem) => void
}

export function formatTaskItemText(task: TaskItem) {
  return [task.title, task.description].map(value => value.trim()).filter(Boolean).join('\n')
}

export function TaskItemCard({ task, index, onCopy, onEdit }: TaskItemCardProps) {
  return (
    <Card className="tm-task-card" variant="outlined">
      <CardContent className="tm-task-card-content">
        <Box className="tm-task-index" aria-hidden="true">{index + 1}</Box>
        <Box className="tm-task-card-body">
          <Typography component="h3" sx={{ fontSize: 14, fontWeight: 800 }}>{task.title}</Typography>
          {task.description ? (
            <Typography color="text.secondary" sx={{ mt: 0.5, fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {task.description}
            </Typography>
          ) : null}
        </Box>
        <Box className="tm-task-card-actions">
          <Tooltip title="编辑任务">
            <IconButton size="small" aria-label={`编辑任务：${task.title}`} onClick={() => onEdit(task)}>
              <EditOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
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
