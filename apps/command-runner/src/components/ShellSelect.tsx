import * as React from 'react'
import { Box, MenuItem, TextField } from '@mui/material'
import type { ShellInfo } from '../types'

type ShellSelectProps = {
  value: string
  shells: ShellInfo[]
  onChange: (shellId: string) => void
  includeInherit?: boolean
  inheritLabel?: string
  label?: string
  disabled?: boolean
}

export function ShellSelect({
  value,
  shells,
  onChange,
  includeInherit = false,
  inheritLabel = '继承上级默认',
  label = '命令行终端',
  disabled = false,
}: ShellSelectProps) {
  return (
    <TextField
      select
      label={label}
      value={value}
      disabled={disabled}
      onChange={event => onChange(event.target.value)}
      fullWidth
      helperText={includeInherit ? inheritLabel : undefined}
    >
      {includeInherit ? <MenuItem value="">继承上级默认</MenuItem> : null}
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
