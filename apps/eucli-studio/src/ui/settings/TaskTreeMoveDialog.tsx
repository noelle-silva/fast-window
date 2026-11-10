import * as React from 'react'
import { Button, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Select, Typography } from '@mui/material'
import { DependableDialog } from '../components/DependableOverlay'
import type { TaskParentOption } from '../../domain/taskTree'

// 移动任务的选父级弹窗：候选里没有它自己与自己的子树（由调用方先排除）。
export function TaskTreeMoveDialog(props: {
  open: boolean
  nodeLabel: string
  value: string
  options: TaskParentOption[]
  onChange: (value: string) => void
  onClose: () => void
  onConfirm: () => void
}) {
  const { open, nodeLabel, value, options, onChange, onClose, onConfirm } = props

  return (
    <DependableDialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>移动「{nodeLabel}」</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: 'var(--studio-text-secondary)', mb: 1.5 }}>
          选择新的父级；原来的位置会被替换，不会复制。
        </Typography>
        <FormControl fullWidth size="small">
          <InputLabel id="task-tree-move-label">目标父级</InputLabel>
          <Select
            labelId="task-tree-move-label"
            label="目标父级"
            value={value}
            onChange={(event) => onChange(String(event.target.value))}
          >
            <MenuItem value="">根级</MenuItem>
            {options.map((option) => (
              <MenuItem key={option.id} value={option.id} sx={{ pl: 2 + option.depth * 1.5 }}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ bgcolor: 'var(--studio-field)', color: 'var(--studio-text-primary)' }}>
          取消
        </Button>
        <Button variant="contained" disableElevation onClick={onConfirm}>
          移动
        </Button>
      </DialogActions>
    </DependableDialog>
  )
}
