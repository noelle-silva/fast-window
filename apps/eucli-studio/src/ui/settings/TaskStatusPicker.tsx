import * as React from 'react'
import { Box, Button, Typography } from '@mui/material'
import { TASK_STATUS_LABELS, VISIBLE_TASK_STATUSES, type TaskStatus } from '../../domain/taskTree'

// 归档页里的状态恢复：三个状态并排，点哪个就恢复到哪个。
// 这里刻意不用左右箭头的切换器——归档本身不进切换循环，恢复是明确的一次选择。
// 当前值仍是归档时，左边给一句「归档中」，让「三个都没选中」这件事有解释。

const FILLED_SECONDARY_SX = {
  bgcolor: 'var(--studio-field)',
  color: 'var(--studio-text-primary)',
  boxShadow: 'var(--studio-shadow-soft)',
  '&:hover': { bgcolor: 'var(--studio-field-hover)', boxShadow: 'var(--studio-shadow-soft)' },
}

export function TaskStatusPicker(props: {
  value: TaskStatus
  onChange: (next: TaskStatus) => void
}) {
  const { value, onChange } = props

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, p: 0.5, borderRadius: 2, bgcolor: 'var(--studio-field)' }}>
      {value === 'archived' ? (
        <Typography
          component="span"
          sx={{ fontSize: 11.5, lineHeight: '20px', color: 'var(--studio-text-tertiary)', pl: 0.75, pr: 0.25, whiteSpace: 'nowrap' }}
        >
          归档中
        </Typography>
      ) : null}
      {VISIBLE_TASK_STATUSES.map((status) => {
        const active = value === status
        return (
          <Button
            key={status}
            size="small"
            disableElevation
            variant="contained"
            onClick={() => onChange(status)}
            sx={
              active
                ? { borderRadius: 1.5, fontWeight: 700, py: 0.25, px: 1.25, minWidth: 0 }
                : [{ borderRadius: 1.5, fontWeight: 700, py: 0.25, px: 1.25, minWidth: 0 }, FILLED_SECONDARY_SX]
            }
          >
            {TASK_STATUS_LABELS[status]}
          </Button>
        )
      })}
    </Box>
  )
}
