import * as React from 'react'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { Box, Button, Chip, IconButton, TextField, Typography } from '@mui/material'
import type { Placeholder } from '../types'

type PlaceholderEditorProps = {
  value: Placeholder[]
  disabled?: boolean
  hint?: string
  onChange: (next: Placeholder[]) => void
}

// PlaceholderEditor 编辑一组占位符定义：名称 + 候选值列表。
// 名称与候选值的合法性由后端统一校验，保存失败时在表单内提示。
export function PlaceholderEditor({ value, disabled = false, hint, onChange }: PlaceholderEditorProps) {
  const addPlaceholder = React.useCallback(() => {
    onChange([...value, { name: '', values: [] }])
  }, [onChange, value])

  const patchPlaceholder = React.useCallback((index: number, patch: Partial<Placeholder>) => {
    onChange(value.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)))
  }, [onChange, value])

  const removePlaceholder = React.useCallback((index: number) => {
    onChange(value.filter((_, itemIndex) => itemIndex !== index))
  }, [onChange, value])

  return (
    <Box className="cr-placeholder-editor">
      <Box className="cr-placeholder-editor-head">
        <Typography component="h3" sx={{ fontSize: 13, fontWeight: 900 }}>运行占位符</Typography>
        <Typography color="text.secondary" sx={{ fontSize: 12 }}>在命令脚本中用 {'{{名称}}'} 引用</Typography>
      </Box>
      {hint ? <Typography color="text.secondary" sx={{ fontSize: 12, lineHeight: 1.6 }}>{hint}</Typography> : null}
      {value.length > 0 ? (
        <Box className="cr-placeholder-list">
          {value.map((item, index) => (
            <PlaceholderRow
              key={index}
              item={item}
              disabled={disabled}
              onNameChange={name => patchPlaceholder(index, { name })}
              onValuesChange={values => patchPlaceholder(index, { values })}
              onRemove={() => removePlaceholder(index)}
            />
          ))}
        </Box>
      ) : (
        <Typography color="text.secondary" sx={{ fontSize: 12 }}>暂无占位符。添加后，运行命令时会弹窗为每个引用选择取值。</Typography>
      )}
      <Box>
        <Button size="small" startIcon={<AddIcon fontSize="small" />} disabled={disabled} onClick={addPlaceholder}>
          添加占位符
        </Button>
      </Box>
    </Box>
  )
}

type PlaceholderRowProps = {
  item: Placeholder
  disabled: boolean
  onNameChange: (name: string) => void
  onValuesChange: (values: string[]) => void
  onRemove: () => void
}

function PlaceholderRow({ item, disabled, onNameChange, onValuesChange, onRemove }: PlaceholderRowProps) {
  const [draftValue, setDraftValue] = React.useState('')

  const commitValue = React.useCallback(() => {
    const value = draftValue.trim()
    if (!value || disabled) return
    onValuesChange([...item.values, value])
    setDraftValue('')
  }, [disabled, draftValue, item.values, onValuesChange])

  return (
    <Box className="cr-placeholder-item">
      <Box className="cr-placeholder-item-head">
        <TextField
          size="small"
          label="占位符名称"
          value={item.name}
          disabled={disabled}
          onChange={event => onNameChange(event.target.value)}
        />
        <IconButton size="small" disabled={disabled} aria-label="删除占位符" onClick={onRemove}>
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      </Box>
      <Box className="cr-placeholder-values">
        {item.values.map((value, valueIndex) => (
          <Chip
            key={`${valueIndex}-${value}`}
            size="small"
            label={value}
            disabled={disabled}
            onDelete={disabled ? undefined : () => onValuesChange(item.values.filter((_, index) => index !== valueIndex))}
          />
        ))}
        {item.values.length === 0 ? (
          <Typography color="text.secondary" sx={{ fontSize: 12 }}>至少添加一个候选值</Typography>
        ) : null}
      </Box>
      <Box className="cr-placeholder-value-add">
        <TextField
          size="small"
          placeholder="输入候选值"
          value={draftValue}
          disabled={disabled}
          onChange={event => setDraftValue(event.target.value)}
          onKeyDown={event => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            commitValue()
          }}
          sx={{ flex: 1, minWidth: 160 }}
        />
        <Button size="small" disabled={disabled || draftValue.trim().length === 0} onClick={commitValue}>
          添加值
        </Button>
      </Box>
    </Box>
  )
}
