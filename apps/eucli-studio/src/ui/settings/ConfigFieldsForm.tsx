import * as React from 'react'
import { Box, Button, FormControl, FormControlLabel, IconButton, InputLabel, MenuItem, Select, Stack, Switch, TextField, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { SettingsListItem, SettingsSection } from './SettingsSurfaces'
import { plainObject } from './schemaFieldValues'
import {
  arrayItemSeed,
  buildArrayItemFields,
  buildConfigFields,
  buildObjectChildFields,
  isBlankConfigValue,
  type ConfigField,
  type ConfigOption,
} from './configFieldModel'

export function ConfigFieldsForm(props: {
  schema: any
  defaultConfig: any
  userConfig: any
  draftConfig: any
  emptyText: string
  onSetValue: (path: string[], value: any) => void
  onRemoveValue: (path: string[]) => void
}) {
  const fields = buildConfigFields(props.schema, props.defaultConfig, props.userConfig, props.draftConfig)
  if (!fields.length) {
    return <Typography variant="body2" color="text.secondary">{props.emptyText}</Typography>
  }
  return (
    <Stack spacing={1.25}>
      {fields.map((field) => <ConfigFieldControl key={field.path.join('.')} field={field} onSetValue={props.onSetValue} onRemoveValue={props.onRemoveValue} />)}
    </Stack>
  )
}

function ConfigFieldControl(props: { field: ConfigField; onSetValue: (path: string[], value: any) => void; onRemoveValue: (path: string[]) => void }) {
  const { field, onSetValue, onRemoveValue } = props
  const hasValue = !isBlankConfigValue(field.currentValue)
  const displayValue = hasValue ? field.currentValue : field.defaultValue
  const helper = configFieldHelper(field, hasValue)

  if (field.type === 'boolean') {
    return (
      <SettingsSection tone={hasValue ? 'default' : 'muted'}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontWeight: 900 }}>{field.label}{field.required ? ' *' : ''}</Typography>
            {helper ? <Typography variant="caption" color="text.secondary">{helper}</Typography> : null}
          </Box>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">
            <FormControlLabel control={<Switch checked={!!displayValue} onChange={(event) => onSetValue(field.path, event.target.checked)} />} label={displayValue ? '开启' : '关闭'} />
            <Button size="small" onClick={() => onRemoveValue(field.path)} disabled={!hasValue}>恢复默认</Button>
          </Stack>
        </Stack>
      </SettingsSection>
    )
  }

  if (field.enumOptions.length) {
    const selectOptions = configSelectOptions(field, displayValue)
    return (
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'flex-start' }}>
        <FormControl size="small" fullWidth>
          <InputLabel>{field.label}{field.required ? ' *' : ''}</InputLabel>
          <Select label={`${field.label}${field.required ? ' *' : ''}`} value={String(displayValue ?? '')} onChange={(event) => event.target.value === '' ? onRemoveValue(field.path) : onSetValue(field.path, event.target.value)}>
            <MenuItem value=""><em>使用默认值</em></MenuItem>
            {selectOptions.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
          </Select>
          {helper ? <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>{helper}</Typography> : null}
        </FormControl>
        <Button size="small" onClick={() => onRemoveValue(field.path)} disabled={!hasValue} sx={{ mt: { sm: 0.5 } }}>恢复默认</Button>
      </Stack>
    )
  }

  if (field.type === 'object') {
    return <ConfigObjectField field={field} hasValue={hasValue} helper={helper} onSetValue={onSetValue} onRemoveValue={onRemoveValue} />
  }

  if (field.type === 'array') {
    if (field.itemKind === 'object') {
      return <ConfigObjectListField field={field} hasValue={hasValue} helper={helper} onSetValue={onSetValue} onRemoveValue={onRemoveValue} />
    }
    if (field.itemKind === 'other') {
      return <ConfigJsonField field={field} hasValue={hasValue} helper={helper} onSetValue={onSetValue} onRemoveValue={onRemoveValue} />
    }
    return <ConfigStringListField field={field} hasValue={hasValue} helper={helper} onSetValue={onSetValue} onRemoveValue={onRemoveValue} />
  }

  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'flex-start' }}>
      <TextField
        size="small"
        label={`${field.label}${field.required ? ' *' : ''}`}
        type={field.type === 'number' ? 'number' : 'text'}
        value={displayValue ?? ''}
        onChange={(event) => {
          if (field.type === 'number' && event.target.value.trim() === '') onRemoveValue(field.path)
          else if (field.type === 'number') {
            const nextValue = numberFromInput(event.target.value)
            if (nextValue === '') onRemoveValue(field.path)
            else onSetValue(field.path, nextValue)
          } else onSetValue(field.path, event.target.value)
        }}
        placeholder={field.defaultValue == null ? '' : String(field.defaultValue)}
        helperText={helper}
        fullWidth
      />
      <Button size="small" onClick={() => onRemoveValue(field.path)} disabled={!hasValue} sx={{ mt: { sm: 0.5 } }}>恢复默认</Button>
    </Stack>
  )
}

function ConfigObjectField(props: { field: ConfigField; hasValue: boolean; helper: string; onSetValue: (path: string[], value: any) => void; onRemoveValue: (path: string[]) => void }) {
  const { field, hasValue, helper, onSetValue, onRemoveValue } = props
  const childFields = buildObjectChildFields(field.schema, field.currentValue, field.path, field.defaultValue)
  return (
    <SettingsSection tone={hasValue ? 'default' : 'muted'}>
      <Stack spacing={1.25}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontWeight: 900 }}>{field.label}{field.required ? ' *' : ''}</Typography>
            {helper ? <Typography variant="caption" color="text.secondary">{helper}</Typography> : null}
          </Box>
          <Button size="small" onClick={() => onRemoveValue(field.path)} disabled={!hasValue}>恢复默认</Button>
        </Stack>
        {childFields.length ? (
          <Stack spacing={1.25} sx={{ pl: { xs: 0, sm: 1.5 }, bgcolor: { sm: 'rgba(248,250,252,.72)' }, borderRadius: 2, py: { sm: 1 } }}>
            {childFields.map((child) => <ConfigFieldControl key={child.path.join('.')} field={child} onSetValue={onSetValue} onRemoveValue={onRemoveValue} />)}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">该对象当前没有可编辑子字段。</Typography>
        )}
      </Stack>
    </SettingsSection>
  )
}

function ConfigStringListField(props: { field: ConfigField; hasValue: boolean; helper: string; onSetValue: (path: string[], value: any) => void; onRemoveValue: (path: string[]) => void }) {
  const { field, hasValue, helper, onSetValue, onRemoveValue } = props
  const lines = Array.isArray(field.currentValue) ? field.currentValue.map((item) => String(item ?? '')).join('\n') : ''
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'flex-start' }}>
      <TextField
        size="small"
        label={`${field.label}${field.required ? ' *' : ''}`}
        value={lines}
        onChange={(event) => onSetValue(field.path, arrayFromLines(event.target.value))}
        helperText={helper ? `${helper} 一行一个值。` : '一行一个值。'}
        fullWidth
        multiline
        minRows={3}
      />
      <Button size="small" onClick={() => onRemoveValue(field.path)} disabled={!hasValue} sx={{ mt: { sm: 0.5 } }}>恢复默认</Button>
    </Stack>
  )
}

// ConfigObjectListField 渲染「对象行列表」：行内字段按条目声明递归渲染，行可删、列表可增。
function ConfigObjectListField(props: { field: ConfigField; hasValue: boolean; helper: string; onSetValue: (path: string[], value: any) => void; onRemoveValue: (path: string[]) => void }) {
  const { field, hasValue, helper, onSetValue, onRemoveValue } = props
  const itemSchema = plainObject(field.schema.items)
  const itemTitle = field.itemTitle || '条目'
  const items = Array.isArray(field.currentValue) ? field.currentValue : []
  const malformed = !Array.isArray(field.currentValue) && !isBlankConfigValue(field.currentValue)
  const addItem = () => onSetValue(field.path, [...items, arrayItemSeed(itemSchema)])
  return (
    <SettingsSection tone={hasValue ? 'default' : 'muted'}>
      <Stack spacing={1.25}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontWeight: 900 }}>{field.label}{field.required ? ' *' : ''}</Typography>
            {helper ? <Typography variant="caption" color="text.secondary">{helper}</Typography> : null}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>共 {items.length} 条</Typography>
          </Box>
          <Button size="small" onClick={() => onRemoveValue(field.path)} disabled={!hasValue}>恢复默认</Button>
        </Stack>

        {malformed ? (
          <Typography variant="body2" color="warning.main">当前值不是列表，可在下方按 JSON 原文修正。</Typography>
        ) : items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">暂无条目。</Typography>
        ) : (
          <Stack spacing={1}>
            {items.map((item, index) => {
              const rowPath = [...field.path, String(index)]
              return (
                <SettingsListItem key={index} sx={{ p: 1 }}>
                  <Stack spacing={1}>
                    <Stack direction="row" spacing={0.75} alignItems="center" justifyContent="space-between">
                      <Typography variant="body2" sx={{ fontWeight: 900 }}>{itemTitle} {index + 1}</Typography>
                      <IconButton size="small" color="error" aria-label={`删除${itemTitle} ${index + 1}`} onClick={() => onRemoveValue(rowPath)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                    {isPlainObject(item) ? (
                      buildArrayItemFields(itemSchema, item, rowPath).map((child) => (
                        <ConfigFieldControl key={child.path.join('.')} field={child} onSetValue={onSetValue} onRemoveValue={onRemoveValue} />
                      ))
                    ) : (
                      <ConfigJsonField
                        field={{ ...field, path: rowPath, currentValue: item, required: false, label: `${itemTitle} ${index + 1} 的值` }}
                        hasValue={true}
                        helper=""
                        onSetValue={onSetValue}
                      />
                    )}
                  </Stack>
                </SettingsListItem>
              )
            })}
          </Stack>
        )}

        {malformed ? (
          <ConfigJsonField field={{ ...field, currentValue: field.currentValue, label: `${field.label}（JSON 原文）` }} hasValue={hasValue} helper="" onSetValue={onSetValue} onRemoveValue={onRemoveValue} />
        ) : (
          <Box>
            <Button size="small" startIcon={<AddIcon />} onClick={addItem}>新增{itemTitle}</Button>
          </Box>
        )}
      </Stack>
    </SettingsSection>
  )
}

// ConfigJsonField 是表达力出口：任何无法按字段描述渲染的形状都以 JSON 原文编辑；
// 解析成功才回写草稿，解析失败当场提示、不污染草稿。
function ConfigJsonField(props: { field: ConfigField; hasValue: boolean; helper: string; onSetValue: (path: string[], value: any) => void; onRemoveValue?: (path: string[]) => void }) {
  const { field, hasValue, helper, onSetValue, onRemoveValue } = props
  const [text, setText] = React.useState(() => jsonText(field.currentValue))
  const [error, setError] = React.useState('')
  const lastEmittedRef = React.useRef('')
  React.useEffect(() => {
    const current = jsonText(field.currentValue)
    if (current === lastEmittedRef.current) return
    setText(current)
    setError('')
  }, [field.currentValue])
  const handleChange = (next: string) => {
    setText(next)
    const parsed = parseJsonText(next)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setError('')
    lastEmittedRef.current = jsonText(parsed.value)
    onSetValue(field.path, parsed.value)
  }
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'flex-start' }}>
      <TextField
        size="small"
        label={`${field.label}${field.required ? ' *' : ''}`}
        value={text}
        onChange={(event) => handleChange(event.target.value)}
        helperText={error || (helper ? `${helper}（JSON 原文编辑）` : 'JSON 原文编辑')}
        error={!!error}
        fullWidth
        multiline
        minRows={3}
        slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 13 } } }}
      />
      {onRemoveValue ? <Button size="small" onClick={() => onRemoveValue(field.path)} disabled={!hasValue} sx={{ mt: { sm: 0.5 } }}>恢复默认</Button> : null}
    </Stack>
  )
}

function configFieldHelper(field: ConfigField, hasValue: boolean): string {
  const parts: string[] = []
  if (field.description) parts.push(field.description)
  if (!hasValue && field.defaultValue != null && field.type !== 'object' && field.type !== 'array') parts.push(`当前使用默认值：${configDisplayValue(field, field.defaultValue) || '（空）'}`)
  return parts.join(' ')
}

function configSelectOptions(field: ConfigField, displayValue: any): ConfigOption[] {
  const labels = new Map(field.enumOptions.map((option) => [option.value, option.label]))
  const values = orderedUniqueStrings([...(displayValue == null || displayValue === '' ? [] : [String(displayValue)]), ...field.enumOptions.map((option) => option.value)])
  return values.map((value) => ({ value, label: labels.get(value) || value }))
}

function configDisplayValue(field: ConfigField, value: any): string {
  const text = String(value ?? '')
  const option = field.enumOptions.find((item) => item.value === text)
  return option?.label || text
}

function numberFromInput(value: string): number | '' {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : ''
}

function arrayFromLines(value: string): string[] {
  return String(value || '').split('\n').map((line) => line.trim()).filter(Boolean)
}

function orderedUniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const key = String(value || '').trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

function isPlainObject(value: any): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function jsonText(value: any): string {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2) ?? ''
  } catch {
    return ''
  }
}

function parseJsonText(text: string): { ok: true; value: any } | { ok: false; error: string } {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, error: '请输入 JSON 内容；如需清空请用「恢复默认」。' }
  try {
    return { ok: true, value: JSON.parse(trimmed) }
  } catch (e: any) {
    return { ok: false, error: `JSON 解析失败：${String(e?.message || e)}` }
  }
}
