import * as React from 'react'
import { Box, IconButton, MenuItem, TextField } from '@mui/material'
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import { stepPlaceholderValue } from '../placeholders'
import type { Placeholder } from '../types'

type PlaceholderValueFieldProps = {
  placeholder: Placeholder
  value: string
  disabled?: boolean
  onChange: (next: string) => void
}

// PlaceholderValueField 渲染本次运行中单个占位符的取值控件：
// 预选值型为「下拉选择 + 左右切换按钮」，临时填写型为多行输入；临时填写型可留空，留空替换为空内容。
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
  const previous = stepPlaceholderValue(placeholder.values, value, -1)
  const next = stepPlaceholderValue(placeholder.values, value, 1)
  return (
    <Box className="cr-placeholder-value-select">
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
      <Box className="cr-placeholder-cycle">
        <IconButton
          size="small"
          disabled={disabled || previous === null}
          aria-label="上一个候选值"
          onClick={() => previous !== null && onChange(previous)}
        >
          <ChevronLeftRoundedIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          disabled={disabled || next === null}
          aria-label="下一个候选值"
          onClick={() => next !== null && onChange(next)}
        >
          <ChevronRightRoundedIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  )
}
