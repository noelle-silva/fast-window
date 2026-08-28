import * as React from 'react'
import { Box, MenuItem, TextField } from '@mui/material'
import type { ProcessOwnership } from '../types'

type ProcessOwnershipOption = {
  value: ProcessOwnership
  label: string
  hint: string
}

const OPTIONS: ProcessOwnershipOption[] = [
  { value: 'detached', label: '系统级独立进程', hint: '完全脱离 Command Runner，App 关闭不影响' },
  { value: 'attached', label: '挂载在 App 进程树下', hint: '随 Command Runner 关闭而统一结束' },
]

type ProcessOwnershipSelectProps = {
  value: ProcessOwnership
  onChange: (value: ProcessOwnership) => void
  includeInherit?: boolean
  inheritLabel?: string
  label?: string
  disabled?: boolean
}

export function ProcessOwnershipSelect({
  value,
  onChange,
  includeInherit = false,
  inheritLabel = '跟随上级默认',
  label = '进程归属',
  disabled = false,
}: ProcessOwnershipSelectProps) {
  return (
    <TextField
      select
      label={label}
      value={value}
      disabled={disabled}
      onChange={event => onChange(event.target.value as ProcessOwnership)}
      fullWidth
      helperText="仅独立命令行窗口模式生效；内置执行空间固定挂载在 App 进程树下。"
    >
      {includeInherit ? <MenuItem value="">{inheritLabel}</MenuItem> : null}
      {OPTIONS.map(option => (
        <MenuItem key={option.value} value={option.value}>
          <Box sx={{ minWidth: 0 }}>
            <Box component="span" sx={{ fontSize: 13, fontWeight: 700 }}>{option.label}</Box>
            <Box component="span" sx={{ display: 'block', color: 'text.secondary', fontSize: 11 }}>{option.hint}</Box>
          </Box>
        </MenuItem>
      ))}
    </TextField>
  )
}

export function processOwnershipLabel(value: ProcessOwnership): string {
  return OPTIONS.find(option => option.value === value)?.label ?? '跟随上级默认'
}
