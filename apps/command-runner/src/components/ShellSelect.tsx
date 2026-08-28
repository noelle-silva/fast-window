import * as React from 'react'
import { Box, MenuItem, TextField } from '@mui/material'
import { InheritBadge } from './InheritBadge'
import type { ShellInfo } from '../types'

type ShellSelectProps = {
  value: string
  shells: ShellInfo[]
  onChange: (shellId: string) => void
  includeInherit?: boolean
  inheritLabel?: string
  /** 继承到的真实值：当 value 为空（跟随上级）时，用于显示真实生效的选项+继承徽章 */
  effectiveValue?: string
  label?: string
  disabled?: boolean
}

export function ShellSelect({
  value,
  shells,
  onChange,
  includeInherit = false,
  inheritLabel = '继承上级默认',
  effectiveValue = '',
  label = '命令行终端',
  disabled = false,
}: ShellSelectProps) {
  const showingValue = value || effectiveValue
  const isInheriting = includeInherit && value === '' && effectiveValue !== ''
  const effectiveShell = shells.find(shell => shell.id === effectiveValue)
  return (
    <TextField
      select
      label={label}
      value={showingValue}
      disabled={disabled}
      onChange={event => onChange(event.target.value)}
      fullWidth
      helperText={isInheriting ? `当前：继承上级（${effectiveShell?.name ?? '未知终端'}）` : includeInherit ? inheritLabel : undefined}
      slotProps={{
        select: {
          renderValue: selected => (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {shells.find(shell => shell.id === selected)?.name || inheritLabel}
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
              {isInheriting ? `${inheritLabel} · ${effectiveShell?.name ?? '未知终端'}` : inheritLabel}
            </Box>
            {isInheriting ? <InheritBadge /> : null}
          </Box>
        </MenuItem>
      ) : null}
      {shells.map(shell => (
        <MenuItem key={shell.id} value={shell.id} disabled={!shell.available}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {shell.name}
            </Box>
            <Box component="span" sx={{ color: 'text.secondary', fontSize: 11, whiteSpace: 'nowrap' }}>
              {shell.builtin ? '本机' : '自定义'}
              {!shell.available ? ' · 不可用' : ''}
            </Box>
          </Box>
        </MenuItem>
      ))}
    </TextField>
  )
}
