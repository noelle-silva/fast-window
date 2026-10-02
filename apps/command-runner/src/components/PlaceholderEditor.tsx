import * as React from 'react'
import AddIcon from '@mui/icons-material/Add'
import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DragIndicatorOutlinedIcon from '@mui/icons-material/DragIndicatorOutlined'
import KeyboardIcon from '@mui/icons-material/Keyboard'
import ListAltIcon from '@mui/icons-material/ListAlt'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import { Box, Button, IconButton, Menu, MenuItem, TextField, Tooltip, Typography } from '@mui/material'
import { DeleteConfirmDialog } from './DeleteConfirmDialog'
import {
  SortableItem,
  SortableRoot,
  SortableSection,
  arrayMove,
  createScopedCollisionDetection,
  type SortableItemRenderArgs,
} from './SortableDnd'
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

// 拖拽条目的稳定标识：整块占位符为 ph:<下标>，候选值行为 phv:<占位符下标>:<值下标>。
// 由标识反解出拖拽目标的类型与位置，供排序回调按类型分派。
type SortableEntry =
  | { kind: 'block'; placeholder: number }
  | { kind: 'value'; placeholder: number; value: number }

const BLOCK_PREFIX = 'ph:'
const VALUE_PREFIX = 'phv:'

function blockId(index: number): string {
  return `${BLOCK_PREFIX}${index}`
}

function valueId(placeholder: number, value: number): string {
  return `${VALUE_PREFIX}${placeholder}:${value}`
}

function parseSortableId(id: string): SortableEntry | null {
  if (id.startsWith(VALUE_PREFIX)) {
    const [placeholder, value] = id.slice(VALUE_PREFIX.length).split(':')
    const placeholderIndex = Number(placeholder)
    const valueIndex = Number(value)
    if (Number.isInteger(placeholderIndex) && Number.isInteger(valueIndex)) {
      return { kind: 'value', placeholder: placeholderIndex, value: valueIndex }
    }
    return null
  }
  if (id.startsWith(BLOCK_PREFIX)) {
    const index = Number(id.slice(BLOCK_PREFIX.length))
    return Number.isInteger(index) ? { kind: 'block', placeholder: index } : null
  }
  return null
}

// sortableGroupOf 把条目归入可互相排序的组：整块占位符同属一组，
// 候选值行按所属占位符分组，保证不同占位符的值行互不干扰。
function sortableGroupOf(id: string): string | null {
  const entry = parseSortableId(id)
  if (!entry) return null
  return entry.kind === 'block' ? 'blocks' : `values:${entry.placeholder}`
}

// PlaceholderEditor 以左右两栏编辑一组占位符定义：
// 左栏是占位符名称（一格一个）与取值方式切换，右栏是该占位符的候选值（一行一格，可直接编辑）；
// 整块与候选值行均可在左侧把手处拖拽排序；左栏底部加号新增占位符，每块右栏底部加号新增值行，
// 每块右侧提供复制引用与更多操作（删除走二次确认）。
// 取值方式为「临时填写」时，候选值区域锁定但原样保留，作为切回「预选值」时的草稿；
// 名称与候选值的合法性由后端统一校验，保存失败时在表单内提示。
export function PlaceholderEditor({ value, disabled = false, hint, onChange }: PlaceholderEditorProps) {
  const [menu, setMenu] = React.useState<{ target: PlaceholderTarget; anchor: HTMLElement } | null>(null)
  const [pendingDelete, setPendingDelete] = React.useState<PlaceholderTarget | null>(null)
  const [focusRequest, setFocusRequest] = React.useState<{ placeholder: number; value: number } | null>(null)
  const valueInputRefs = React.useRef(new Map<string, HTMLInputElement>())
  const { copiedKey, copy } = useCopyFeedback()

  const collisionDetection = React.useMemo(() => createScopedCollisionDetection(sortableGroupOf), [])

  const patchPlaceholder = React.useCallback((index: number, patch: Partial<Placeholder>) => {
    onChange(value.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)))
  }, [onChange, value])

  const addPlaceholder = React.useCallback(() => {
    onChange([...value, { name: '', valueMode: 'select', values: [] }])
  }, [onChange, value])

  // toggleValueMode 在「预选值」与「临时填写」之间切换取值方式；
  // 候选值不动，作为切回预选值时的草稿保留。
  const toggleValueMode = React.useCallback((index: number) => {
    onChange(value.map((item, itemIndex) => (
      itemIndex === index ? { ...item, valueMode: item.valueMode === 'input' ? 'select' : 'input' } : item
    )))
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

  // handleMove 按拖拽条目类型分派排序：整块之间重排占位符，值行之间重排同占位符的候选值。
  const handleMove = React.useCallback((activeId: string, overId: string) => {
    const active = parseSortableId(activeId)
    const over = parseSortableId(overId)
    if (!active || !over) return
    if (active.kind === 'block' && over.kind === 'block') {
      onChange(arrayMove(value, active.placeholder, over.placeholder))
      return
    }
    if (active.kind === 'value' && over.kind === 'value' && active.placeholder === over.placeholder) {
      onChange(value.map((item, itemIndex) => itemIndex === active.placeholder
        ? { ...item, values: arrayMove(item.values, active.value, over.value) }
        : item))
    }
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

  const blockIds = React.useMemo(() => value.map((_, index) => blockId(index)), [value])

  return (
    <Box className="cr-placeholder-editor">
      <Box className="cr-placeholder-editor-head">
        <Typography component="h3" sx={{ fontSize: 13, fontWeight: 900 }}>运行占位符</Typography>
        <Typography color="text.secondary" sx={{ fontSize: 12 }}>在命令脚本中用 {'{{名称}}'} 引用</Typography>
      </Box>
      {hint ? <Typography color="text.secondary" sx={{ fontSize: 12, lineHeight: 1.6 }}>{hint}</Typography> : null}
      {value.length > 0 ? (
        <SortableRoot onMove={handleMove} collisionDetection={collisionDetection} enableTransition={false}>
          <SortableSection items={blockIds}>
            <Box className="cr-placeholder-list">
              {value.map((item, index) => (
                <SortableItem key={blockId(index)} id={blockId(index)} disabled={disabled}>
                  {(blockSortable) => (
                    <Box ref={blockSortable.setNodeRef} style={blockSortable.style} className="cr-placeholder-block">
                      <PlaceholderDragHandle sortable={blockSortable} label="拖拽排序占位符" />
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
                        <Tooltip title={item.valueMode === 'input'
                          ? '临时填写：运行时现场输入。点击改为预选值。'
                          : '预选值：运行时从候选值中选择。点击改为临时填写。'}>
                          <span>
                            <IconButton
                              size="small"
                              disabled={disabled}
                              aria-label="切换占位符取值方式"
                              onClick={() => toggleValueMode(index)}
                            >
                              {item.valueMode === 'input' ? <KeyboardIcon fontSize="small" /> : <ListAltIcon fontSize="small" />}
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
                        {item.valueMode === 'input' ? (
                          <Typography color="text.secondary" sx={{ fontSize: 12, lineHeight: 1.6 }}>
                            临时填写：运行时现场输入，可留空；下方候选值暂存，切回预选值后可继续编辑。
                          </Typography>
                        ) : null}
                        <SortableSection items={item.values.map((_, valueIndex) => valueId(index, valueIndex))}>
                          {item.values.map((current, valueIndex) => (
                            <SortableItem
                              key={valueId(index, valueIndex)}
                              id={valueId(index, valueIndex)}
                              disabled={disabled || item.valueMode === 'input'}
                            >
                              {(valueSortable) => (
                                <Box ref={valueSortable.setNodeRef} style={valueSortable.style} className="cr-placeholder-value-row">
                                  <PlaceholderDragHandle sortable={valueSortable} label="拖拽排序候选值" />
                                  <TextField
                                    size="small"
                                    placeholder={`候选值 ${valueIndex + 1}`}
                                    value={current}
                                    disabled={disabled || item.valueMode === 'input'}
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
                                    disabled={disabled || item.valueMode === 'input'}
                                    aria-label="候选值更多操作"
                                    onClick={event => setMenu({
                                      target: { kind: 'value', placeholder: index, value: valueIndex },
                                      anchor: event.currentTarget,
                                    })}
                                  >
                                    <MoreVertIcon fontSize="small" />
                                  </IconButton>
                                </Box>
                              )}
                            </SortableItem>
                          ))}
                        </SortableSection>
                        <Box className="cr-placeholder-add-value">
                          <Button
                            size="small"
                            startIcon={<AddIcon fontSize="small" />}
                            disabled={disabled || item.valueMode === 'input'}
                            onClick={() => addValue(index)}
                          >
                            添加值
                          </Button>
                        </Box>
                      </Box>
                    </Box>
                  )}
                </SortableItem>
              ))}
            </Box>
          </SortableSection>
        </SortableRoot>
      ) : (
        <Typography color="text.secondary" sx={{ fontSize: 12 }}>暂无占位符。添加后，运行命令时会弹窗为每个引用取值。</Typography>
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

// PlaceholderDragHandle 是占位符编辑器内统一的拖拽把手：承载排序把手引用与交互属性。
function PlaceholderDragHandle({ sortable, label }: { sortable: SortableItemRenderArgs; label: string }) {
  return (
    <Box
      component="span"
      ref={sortable.setHandleRef}
      className="cr-placeholder-drag-handle"
      aria-label={label}
      {...sortable.handleProps}
    >
      <DragIndicatorOutlinedIcon fontSize="small" />
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
