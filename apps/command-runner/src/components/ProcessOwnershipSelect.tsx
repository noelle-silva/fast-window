import * as React from 'react'
import { Box, MenuItem, TextField } from '@mui/material'
import { InheritBadge } from './InheritBadge'
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
  /** 继承到的真实值：当 value 为空（跟随上级）时，用于显示真实生效的选项+继承徽章 */
  effectiveValue?: ProcessOwnership
  label?: string
  disabled?: boolean
}

export function ProcessOwnershipSelect({
  value,
  onChange,
  includeInherit = false,
  inheritLabel = '跟随上级默认',
  effectiveValue = '',
  label = '进程归属',
  disabled = false,
}: ProcessOwnershipSelectProps) {
  const showingValue = value || effectiveValue || 'detached'
  const isInheriting = includeInherit && value === '' && effectiveValue !== ''
  return (
    <TextField
      select
      label={label}
      value={showingValue}
      disabled={disabled}
      onChange={event => onChange(event.target.value as ProcessOwnership)}
      fullWidth
      helperText={isInheriting ? `当前：继承上级（${processOwnershipLabel(effectiveValue)}）` : '仅独立命令行窗口模式生效；内置执行空间固定挂载在 App 进程树下。'}
      slotProps={{
        select: {
          renderValue: selected => (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {processOwnershipLabel(selected as ProcessOwnership) || inheritLabel}
              </Box>
              {isInheriting ? <InheritBadge /> : null}
            </Box>
          ),
        },
      }}
    >
      {includeInherit ? (
        <MenuItem value="">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {isInheriting ? `${inheritLabel} · ${processOwnershipLabel(effectiveValue)}` : inheritLabel}
            </Box>
            {isInheriting ? <InheritBadge /> : null}
          </Box>
        </MenuItem>
      ) : null}
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
