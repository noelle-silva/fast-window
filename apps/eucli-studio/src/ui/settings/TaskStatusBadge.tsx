import * as React from 'react'
import { Box } from '@mui/material'
import { TASK_STATUS_LABELS, type TaskStatus } from '../../domain/taskTree'

// 卡片右下角的进度标签：三种可见状态各占一套柔色。
// 归档任务不会出现在卡片墙上，所以这里不处理归档。
const BADGE_SX: Record<Exclude<TaskStatus, 'archived'>, { color: string; bgcolor: string }> = {
  todo: { color: 'var(--studio-text-secondary)', bgcolor: 'var(--studio-field)' },
  doing: { color: 'var(--studio-primary)', bgcolor: 'var(--studio-primary-soft)' },
  done: { color: 'var(--studio-success-text)', bgcolor: 'var(--studio-success-bg)' },
}

export function TaskStatusBadge(props: { status: TaskStatus }) {
  const { status } = props
  if (status === 'archived') return null

  return (
    <Box
      component="span"
      sx={{
        display: 'inline-block',
        px: 0.75,
        py: 0.125,
        borderRadius: 999,
        fontSize: 11,
        lineHeight: '16px',
        fontWeight: 600,
        letterSpacing: '.02em',
        whiteSpace: 'nowrap',
        ...BADGE_SX[status],
      }}
    >
      {TASK_STATUS_LABELS[status]}
    </Box>
  )
}
