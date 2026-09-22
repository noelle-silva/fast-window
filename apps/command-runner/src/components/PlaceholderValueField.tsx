import * as React from 'react'
import { MenuItem, TextField } from '@mui/material'
import type { Placeholder } from '../types'

type PlaceholderValueFieldProps = {
  placeholder: Placeholder
  value: string
  disabled?: boolean
  onChange: (next: string) => void
}

// PlaceholderValueField 渲染本次运行中单个占位符的取值控件：
// 预选值型为下拉选择，临时填写型为多行输入；临时填写型可留空，留空替换为空内容。
export function PlaceholderValueField({ placeholder, value, disabled = false, onChange }: PlaceholderValueFieldProps) {
  if (placeholder.valueMode === 'input') {
    return (
      <TextField
        size="small"
        multiline
        minRows={2}
        maxRows={8}
        placeholder="本次运行填写，可留空"
        value={value}
        disabled={disabled}
        fullWidth
        onChange={event => onChange(event.target.value)}
      />
    )
  }
  return (
    <TextField
      select
      size="small"
      value={value}
      disabled={disabled}
      fullWidth
      onChange={event => onChange(event.target.value)}
    >
      {placeholder.values.map(item => <MenuItem key={item} value={item}>{item}</MenuItem>)}
    </TextField>
  )
}
