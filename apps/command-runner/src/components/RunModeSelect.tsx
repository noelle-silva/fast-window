import * as React from 'react'
import { Box, MenuItem, TextField } from '@mui/material'
import type { CommandRunMode } from '../types'

type RunModeOption = {
  value: CommandRunMode
  label: string
  hint: string
}

const OPTIONS: RunModeOption[] = [
  { value: 'console', label: '独立命令行窗口', hint: '弹出独立窗口运行，输出不在 App 内显示' },
  { value: 'embedded', label: '内置执行空间', hint: '不弹窗口，输出实时显示在 App 的执行空间页面' },
]

type RunModeSelectProps = {
  value: CommandRunMode | ''
  onChange: (value: CommandRunMode | '') => void
  includeInherit?: boolean
  inheritLabel?: string
  label?: string
  disabled?: boolean
}

export function RunModeSelect({
  value,
  onChange,
  includeInherit = false,
  inheritLabel = '跟随上级默认',
  label = '运行模式',
  disabled = false,
}: RunModeSelectProps) {
  return (
    <TextField
      select
      label={label}
      value={value}
      disabled={disabled}
      onChange={event => onChange(event.target.value as CommandRunMode | '')}
      fullWidth
      helperText="独立窗口模式支持配置进程归属；内置执行空间固定挂载在 App 进程树下。"
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
