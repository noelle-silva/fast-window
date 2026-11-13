import * as React from 'react'
import { Box, IconButton, Typography } from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { TASK_STATUS_LABELS, shiftTaskStatus, type TaskStatus } from '../../domain/taskTree'

// 任务状态切换：左右各一个箭头，中间是当前状态。
// 四态首尾相接，到「归档」再往右回到「未开始」，没有禁用态。
// 左箭头取次要色、右箭头取主题色，与原型里「往右推进」的观感一致。

const STEPPER_ARROW_SX = {
  bgcolor: 'var(--studio-field)',
  color: 'var(--studio-text-secondary)',
  boxShadow: 'var(--studio-shadow-soft)',
  borderRadius: 1.5,
  '&:hover': { bgcolor: 'var(--studio-field-hover)', color: 'var(--studio-text-primary)' },
}

const STEPPER_ARROW_PRIMARY_SX = {
  bgcolor: 'primary.main',
  color: '#fff',
  boxShadow: 'var(--studio-shadow-soft)',
  borderRadius: 1.5,
  '&:hover': { bgcolor: 'primary.dark' },
}

export function TaskStatusStepper(props: {
  value: TaskStatus
  onChange: (next: TaskStatus) => void
}) {
  const { value, onChange } = props

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <IconButton
        size="small"
        aria-label="上一个状态"
        onClick={() => onChange(shiftTaskStatus(value, -1))}
        sx={STEPPER_ARROW_SX}
      >
        <ChevronLeftIcon fontSize="small" />
      </IconButton>
      <Typography
        component="span"
        sx={{
          minWidth: 56,
          textAlign: 'center',
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '.02em',
          color: 'var(--studio-text-primary)',
          whiteSpace: 'nowrap',
        }}
      >
        {TASK_STATUS_LABELS[value]}
      </Typography>
      <IconButton
        size="small"
        aria-label="下一个状态"
        onClick={() => onChange(shiftTaskStatus(value, 1))}
        sx={STEPPER_ARROW_PRIMARY_SX}
      >
        <ChevronRightIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}
