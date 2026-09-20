import * as React from 'react'
import AddIcon from '@mui/icons-material/Add'
import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import { Box, Button, IconButton, Menu, MenuItem, TextField, Tooltip, Typography } from '@mui/material'
import { DeleteConfirmDialog } from './DeleteConfirmDialog'
import { useCopyFeedback } from '../clipboard'
import { placeholderReference } from '../placeholders'
import type { Placeholder } from '../types'

type PlaceholderEditorProps = {
  value: Placeholder[]
  disabled?: boolean
  hint?: string
  onChange: (next: Placeholder[]) => void
}

// 菜单与删除确认的定位目标：整块占位符，或其中某一行候选值。
type PlaceholderTarget =
  | { kind: 'block'; placeholder: number }
  | { kind: 'value'; placeholder: number; value: number }

// PlaceholderEditor 以左右两栏编辑一组占位符定义：
// 左栏是占位符名称（一格一个），右栏是该占位符的候选值（一行一格，可直接编辑）；
// 左栏底部加号新增占位符，每块右栏底部加号新增值行，每块右侧提供复制引用与更多操作（删除走二次确认）。
// 名称与候选值的合法性由后端统一校验，保存失败时在表单内提示。
export function PlaceholderEditor({ value, disabled = false, hint, onChange }: PlaceholderEditorProps) {
  const [menu, setMenu] = React.useState<{ target: PlaceholderTarget; anchor: HTMLElement } | null>(null)
  const [pendingDelete, setPendingDelete] = React.useState<PlaceholderTarget | null>(null)
  const [focusRequest, setFocusRequest] = React.useState<{ placeholder: number; value: number } | null>(null)
  const valueInputRefs = React.useRef(new Map<string, HTMLInputElement>())
  const { copiedKey, copy } = useCopyFeedback()

  const patchPlaceholder = React.useCallback((index: number, patch: Partial<Placeholder>) => {
    onChange(value.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)))
  }, [onChange, value])

  const addPlaceholder = React.useCallback(() => {
    onChange([...value, { name: '', values: [] }])
  }, [onChange, value])

  const removePlaceholder = React.useCallback((index: number) => {
    onChange(value.filter((_, itemIndex) => itemIndex !== index))
  }, [onChange, value])

  const addValue = React.useCallback((index: number) => {
    onChange(value.map((item, itemIndex) => (
      itemIndex === index ? { ...item, values: [...item.values, ''] } : item
    )))
    setFocusRequest({ placeholder: index, value: value[index].values.length })
  }, [onChange, value])

  const patchValue = React.useCallback((placeholderIndex: number, valueIndex: number, text: string) => {
    onChange(value.map((item, itemIndex) => itemIndex === placeholderIndex
      ? { ...item, values: item.values.map((current, currentIndex) => (currentIndex === valueIndex ? text : current)) }
      : item))
  }, [onChange, value])

  const removeValue = React.useCallback((placeholderIndex: number, valueIndex: number) => {
    onChange(value.map((item, itemIndex) => itemIndex === placeholderIndex
      ? { ...item, values: item.values.filter((_, currentIndex) => currentIndex !== valueIndex) }
      : item))
  }, [onChange, value])

  // 新增值行后把焦点交给新输入框，省掉一次点击。
  React.useEffect(() => {
    if (!focusRequest) return
    const element = valueInputRefs.current.get(`${focusRequest.placeholder}:${focusRequest.value}`)
    if (!element) return
    element.focus()
    setFocusRequest(null)
  }, [focusRequest, value])

  const confirmDelete = React.useCallback(() => {
    if (!pendingDelete) return
    if (pendingDelete.kind === 'block') removePlaceholder(pendingDelete.placeholder)
    else removeValue(pendingDelete.placeholder, pendingDelete.value)
    setPendingDelete(null)
  }, [pendingDelete, removePlaceholder, removeValue])

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
            <Box key={index} className="cr-placeholder-block">
              <Box className="cr-placeholder-name-cell">
                <TextField
                  size="small"
                  label="占位符名称"
                  value={item.name}
                  disabled={disabled}
                  fullWidth
                  onChange={event => patchPlaceholder(index, { name: event.target.value })}
                />
                <Tooltip title={copiedKey === `placeholder-${index}` ? '已复制' : '复制引用'}>
                  <span>
                    <IconButton
                      size="small"
                      disabled={disabled || item.name.trim().length === 0}
                      aria-label="复制占位符引用"
                      onClick={() => void copy(`placeholder-${index}`, placeholderReference(item.name))}
                    >
                      {copiedKey === `placeholder-${index}` ? <CheckIcon fontSize="small" color="success" /> : <ContentCopyIcon fontSize="small" />}
                    </IconButton>
                  </span>
                </Tooltip>
                <IconButton
                  size="small"
                  disabled={disabled}
                  aria-label="占位符更多操作"
                  onClick={event => setMenu({ target: { kind: 'block', placeholder: index }, anchor: event.currentTarget })}
                >
                  <MoreVertIcon fontSize="small" />
                </IconButton>
              </Box>
              <Box className="cr-placeholder-values-cell">
                {item.values.map((current, valueIndex) => (
                  <Box key={valueIndex} className="cr-placeholder-value-row">
                    <TextField
                      size="small"
                      placeholder={`候选值 ${valueIndex + 1}`}
                      value={current}
                      disabled={disabled}
                      fullWidth
                      inputRef={element => {
                        const key = `${index}:${valueIndex}`
                        if (element) valueInputRefs.current.set(key, element)
                        else valueInputRefs.current.delete(key)
                      }}
                      onChange={event => patchValue(index, valueIndex, event.target.value)}
                    />
                    <IconButton
                      size="small"
                      disabled={disabled}
                      aria-label="候选值更多操作"
                      onClick={event => setMenu({
                        target: { kind: 'value', placeholder: index, value: valueIndex },
                        anchor: event.currentTarget,
                      })}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </Box>
                ))}
                <Box className="cr-placeholder-add-value">
                  <Button size="small" startIcon={<AddIcon fontSize="small" />} disabled={disabled} onClick={() => addValue(index)}>
                    添加值
                  </Button>
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      ) : (
        <Typography color="text.secondary" sx={{ fontSize: 12 }}>暂无占位符。添加后，运行命令时会弹窗为每个引用选择取值。</Typography>
      )}
      <Box className="cr-placeholder-add-row">
        <Button size="small" startIcon={<AddIcon fontSize="small" />} disabled={disabled} onClick={addPlaceholder}>
          添加占位符
        </Button>
      </Box>

      <Menu open={Boolean(menu)} anchorEl={menu?.anchor ?? null} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            if (menu) setPendingDelete(menu.target)
            setMenu(null)
          }}
        >
          删除{menu?.target.kind === 'block' ? '占位符' : '这一行'}
        </MenuItem>
      </Menu>

      {pendingDelete ? (
        <DeleteConfirmDialog
          title={pendingDelete.kind === 'block' ? '删除占位符' : '删除候选值'}
          message={deleteMessage(value, pendingDelete)}
          disabled={disabled}
          onConfirm={confirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      ) : null}
    </Box>
  )
}

function deleteMessage(value: Placeholder[], target: PlaceholderTarget): string {
  const item = value[target.placeholder]
  const name = item?.name.trim() || '未命名占位符'
  if (target.kind === 'block') {
    return `将删除占位符「${name}」及其全部候选值。`
  }
  const current = (item?.values[target.value] ?? '').trim()
  return `将从占位符「${name}」中删除候选值「${current || '（空值）'}」。`
}
