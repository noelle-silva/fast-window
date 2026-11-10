import * as React from 'react'
import {
  Box,
  Chip,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { DependablePopover } from '../components/DependableOverlay'
import { useEvent } from '../hooks/useEvent'
import { findAtMentionTrigger } from '../utils/mention'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { CustomScrollbarThumbs, useCustomScrollbar } from '../scroll/CustomScrollbar'
import { customScrollbarHiddenSx, customScrollbarRevealSx } from '../scroll/customScrollbars'
import { EntityAvatar } from '../components/avatar/EntityAvatar'
import { roleDefaultModelRef } from '../../domain/roleModelCandidates'
import { clampNum } from '../utils/numbers'
import { COMPOSER_SLASH_COMMANDS, findSlashCommandTrigger } from './composerSlashCommands'

// 撑满模式的两段样式：
// TextareaAutosize 会往 textarea 内联写 height 与 overflow:hidden，必须用 !important 压回去；
// 高度交给父级 flex 决定，内容超出就框内滚，滑块仍是同一套自制滑块。
const FILL_HOST_SX = {
  flex: '1 1 auto',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
}

const FILL_INPUT_SX = {
  flex: '1 1 auto',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  '& .MuiOutlinedInput-root': { flex: '1 1 auto', minHeight: 0, alignItems: 'stretch' },
  '& .MuiInputBase-inputMultiline': {
    flex: '1 1 auto',
    minWidth: 0,
    minHeight: 160,
    height: 'auto !important',
    overflowY: 'auto !important',
  },
}

// 聊天输入框的本体：受控值、框内自滚与自制滑块、斜杠命令与 @ 点名的选择器、
// 粘贴与键盘行为都在这里。聊天输入区和提示词库模态窗的右栏共用同一份，
// 两边的打字、选中、复制粘贴手感才真的一致。
// 工具条与发送按钮不在这份里：那是聊天输入区自己的编排。
export type ComposerTextAreaInsertApi = {
  /** 在光标处插入一段文字；有选中就替换选中段。返回是否插进去了。 */
  insertAtCaret: (text: string) => boolean
}

export function ComposerTextArea(props: {
  value: string
  onChange: (next: string) => void
  inputRef: React.MutableRefObject<HTMLTextAreaElement | HTMLInputElement | null>
  disabled: boolean
  activeTargetKind: 'role' | 'group' | 'workspace'
  activeGroup: any
  roles: any[]
  formatModelRefText: (modelRef: any) => string
  minRows: number
  radius: number
  placeholder?: string
  onPaste?: (e: React.ClipboardEvent) => void
  /** 无 Shift 的回车要做什么；不传就当普通换行。 */
  onEnter?: () => void
  /** 换会话时用它清掉选择器，避免上一段会话的候选留在新草稿上。 */
  resetKey?: string
  /** 撑满模式：吃掉父级剩余高度，内容超出就框内滚（右栏编辑区用）。 */
  fill?: boolean
  /** 把「光标处插入」的能力交出去，按钮抢走焦点后也能落准位置。 */
  insertApi?: (api: ComposerTextAreaInsertApi | null) => void
}) {
  const {
    value,
    onChange,
    inputRef,
    disabled,
    activeTargetKind,
    activeGroup,
    roles,
    formatModelRefText,
    minRows,
    radius,
    placeholder = '输入消息…（Enter 发送 / Shift+Enter 换行；支持粘贴图片）',
    onPaste,
    onEnter,
    resetKey,
    fill = false,
    insertApi,
  } = props
  const localInputRef = React.useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)
  const inputBoxRef = React.useRef<HTMLDivElement | null>(null)
  const [atPicker, setAtPicker] = React.useState<null | { triggerIndex: number; cursorIndex: number; query: string }>(null)
  const [slashPicker, setSlashPicker] = React.useState<null | { query: string; selectedIndex: number }>(null)

  // 记住最后一次选区：点按钮时焦点离开输入框，selectionStart 会退回起点甚至 0。
  const caretRef = React.useRef<{ start: number; end: number }>({ start: 0, end: 0 })
  React.useEffect(() => {
    const el = localInputRef.current
    if (!el) return
    const record = () => {
      const start = typeof el.selectionStart === 'number' ? el.selectionStart : null
      const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : null
      if (start === null || end === null) return
      caretRef.current = { start, end }
    }
    record()
    el.addEventListener('keyup', record)
    el.addEventListener('mouseup', record)
    el.addEventListener('blur', record)
    return () => {
      el.removeEventListener('keyup', record)
      el.removeEventListener('mouseup', record)
      el.removeEventListener('blur', record)
    }
  }, [])

  const insertAtCaret = useEvent((text: string) => {
    const body = String(text || '')
    if (!body) return false
    const el = localInputRef.current
    const current = String(value || '')
    const clamp = (value: number) => Math.max(0, Math.min(value, current.length))
    const focused = el != null && document.activeElement === el
    const start = clamp(focused && typeof el.selectionStart === 'number' ? el.selectionStart : caretRef.current.start)
    const end = clamp(focused && typeof el.selectionEnd === 'number' ? el.selectionEnd : caretRef.current.end)
    onChange(current.slice(0, start) + body + current.slice(end))
    const caret = start + body.length
    caretRef.current = { start: caret, end: caret }
    // 定位放到下一次绘制之后：这一步的 onChange 会重渲染输入框，选区会被重置。
    requestAnimationFrame(() => {
      try {
        el?.focus()
        el?.setSelectionRange?.(caret, caret)
      } catch (_) {}
    })
    return true
  })

  React.useEffect(() => {
    insertApi?.({ insertAtCaret })
    return () => insertApi?.(null)
  }, [insertApi, insertAtCaret])

  const { metrics, viewport, dragging, beginDrag, updateMetrics } = useCustomScrollbar({
    scrollRef: localInputRef,
    containerRef: inputBoxRef,
    axis: 'y',
  })

  // 内容变化时 scrollHeight 会变，但已到最大行数后元素尺寸不变、不触发 ResizeObserver，
  // 故在值变化后主动重测一次，保证滑块高度与位置及时刷新。
  React.useEffect(() => {
    updateMetrics()
  }, [value, updateMetrics])

  const setInputRef = React.useCallback(
    (el: HTMLTextAreaElement | HTMLInputElement | null) => {
      localInputRef.current = el
      inputRef.current = el
    },
    [inputRef],
  )

  React.useEffect(() => {
    setAtPicker(null)
    setSlashPicker(null)
  }, [resetKey])

  // 内容被清空（发送后草稿复位，或用户删光）时，选择器不该留在界面上。
  React.useEffect(() => {
    if (String(value || '').trim()) return
    setAtPicker(null)
    setSlashPicker(null)
  }, [value])

  const closeAtPicker = useEvent(() => setAtPicker(null))
  const closeSlashPicker = useEvent(() => setSlashPicker(null))

  const slashCommandOptions = React.useMemo(() => {
    if (!slashPicker) return []
    const q = String(slashPicker.query || '').trim().toLowerCase()
    if (!q) return COMPOSER_SLASH_COMMANDS
    return COMPOSER_SLASH_COMMANDS.filter((item) => {
      const haystack = [item.command, item.title, item.description, ...item.keywords].join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [slashPicker])

  React.useEffect(() => {
    if (!slashPicker) return
    if (!slashCommandOptions.length) {
      if (slashPicker.query) closeSlashPicker()
      return
    }
    if (slashPicker.selectedIndex >= 0 && slashPicker.selectedIndex < slashCommandOptions.length) return
    setSlashPicker((current) => (current ? { ...current, selectedIndex: 0 } : current))
  }, [slashPicker, slashCommandOptions.length, closeSlashPicker])

  const syncSlashPicker = useEvent((text?: string, cursorIndex?: number) => {
    if (disabled) {
      closeSlashPicker()
      return false
    }
    const el = localInputRef.current as any
    const currentValue = typeof text === 'string' ? text : el && typeof el.value === 'string' ? String(el.value || '') : value
    const cursor =
      typeof cursorIndex === 'number'
        ? cursorIndex
        : el && typeof el.selectionStart === 'number'
          ? Number(el.selectionStart || 0)
          : currentValue.length
    const hit = findSlashCommandTrigger(currentValue, cursor)
    if (!hit) {
      closeSlashPicker()
      return false
    }
    setSlashPicker((current) => ({ query: hit.query, selectedIndex: current && current.query === hit.query ? Math.max(0, current.selectedIndex) : 0 }))
    closeAtPicker()
    return true
  })

  const syncAtPicker = useEvent((text?: string, cursorIndex?: number) => {
    if (disabled) return closeAtPicker()
    if (syncSlashPicker(text, cursorIndex)) return closeAtPicker()
    if (activeTargetKind !== 'group' || !activeGroup) return closeAtPicker()

    const memberIds = (Array.isArray((activeGroup as any)?.memberRoleIds) ? ((activeGroup as any).memberRoleIds as any[]) : [])
      .map((x) => String(x || '').trim())
      .filter((x) => !!x)
    if (!memberIds.length) return closeAtPicker()

    const el = localInputRef.current as any
    const currentValue = typeof text === 'string' ? text : el && typeof el.value === 'string' ? String(el.value || '') : value
    const cursor =
      typeof cursorIndex === 'number'
        ? cursorIndex
        : el && typeof el.selectionStart === 'number'
          ? Number(el.selectionStart || 0)
          : currentValue.length

    const hit = findAtMentionTrigger(currentValue, cursor)
    if (!hit) return closeAtPicker()
    setAtPicker(hit)
  })

  const atPickerOptions = React.useMemo(() => {
    if (!atPicker) return []
    if (activeTargetKind !== 'group' || !activeGroup) return []
    const memberIds = (Array.isArray((activeGroup as any)?.memberRoleIds) ? ((activeGroup as any).memberRoleIds as any[]) : [])
      .map((x) => String(x || '').trim())
      .filter((x) => !!x)
    if (!memberIds.length) return []
    const memberRoles = memberIds.map((rid) => roles.find((r: any) => String(r?.id || '') === rid) || null).filter((x) => !!x) as any[]
    const q = String(atPicker.query || '').trim().toLowerCase()
    if (!q) return memberRoles.slice(0, 30)
    return memberRoles
      .filter((r: any) => String(r?.name || '').toLowerCase().includes(q) || String(r?.id || '').toLowerCase().includes(q))
      .slice(0, 30)
  }, [atPicker, activeTargetKind, activeGroup, roles])

  const setDraftInput = useEvent((next: string) => {
    onChange(next)
  })

  const sendSlashCommand = useEvent((command: string) => {
    const next = String(command || '').trim()
    if (!next) return
    setDraftInput(next)
    closeSlashPicker()
    closeAtPicker()
    requestAnimationFrame(() => {
      try {
        localInputRef.current?.focus?.()
        ;(localInputRef.current as any)?.setSelectionRange?.(next.length, next.length)
      } catch (_) {}
      onEnter?.()
    })
  })

  const applyAtPickRole = useEvent((role: any) => {
    const el = localInputRef.current as any
    const currentValue = el && typeof el.value === 'string' ? String(el.value || '') : value
    const cursor = el && typeof el.selectionStart === 'number' ? Number(el.selectionStart || 0) : currentValue.length
    const hit = atPicker ? findAtMentionTrigger(currentValue, cursor) : null
    if (!hit) return closeAtPicker()

    const rawName = String(role?.name || '').trim()
    const safeName = rawName.replace(/[{}]/g, '').slice(0, 80) || 'AI'
    const insert = `@{${safeName}} `
    const next = currentValue.slice(0, hit.triggerIndex) + insert + currentValue.slice(hit.cursorIndex)
    setDraftInput(next)
    closeAtPicker()

    requestAnimationFrame(() => {
      try {
        el?.focus?.()
        const pos = Math.min(next.length, hit.triggerIndex + insert.length)
        el?.setSelectionRange?.(pos, pos)
      } catch (_) {}
    })
  })

  const sendFromInput = useEvent(() => {
    closeAtPicker()
    closeSlashPicker()
    onEnter?.()
  })

  const onInputKeyDown = useEvent((e: React.KeyboardEvent) => {
    if (slashPicker) {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeSlashPicker()
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (!slashCommandOptions.length) return
        const delta = e.key === 'ArrowDown' ? 1 : -1
        setSlashPicker((current) => {
          if (!current) return current
          const count = slashCommandOptions.length
          return { ...current, selectedIndex: (current.selectedIndex + delta + count) % count }
        })
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === ' ') {
        if (!slashCommandOptions.length) return
        e.preventDefault()
        const selected = slashCommandOptions[clampNum(Math.floor(Number(slashPicker.selectedIndex || 0)), 0, slashCommandOptions.length - 1)]
        if (selected) sendSlashCommand(selected.command)
        return
      }
    }

    if (atPicker) {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeAtPicker()
        return
      }
      if (e.key === 'Enter' && !e.shiftKey && atPickerOptions.length) {
        e.preventDefault()
        applyAtPickRole(atPickerOptions[0])
        return
      }
    }
    // 没给 onEnter（右栏编辑草稿）时，Enter 保持换行的原生行为。
    if (e.key === 'Enter' && !e.shiftKey && onEnter) {
      e.preventDefault()
      sendFromInput()
    }
  })

  return (
    <>
      <Box ref={inputBoxRef} sx={[{ position: 'relative', ...customScrollbarRevealSx }, fill ? FILL_HOST_SX : null]}>
        <TextField
          fullWidth
          multiline
          minRows={minRows}
          maxRows={Math.max(minRows, 8)}
          variant="outlined"
          className="fw-chat-text"
          placeholder={placeholder}
          value={value}
          inputRef={setInputRef}
          onChange={(e) => {
            const next = e.target.value
            setDraftInput(next)
            if (!syncSlashPicker(next, typeof (e.target as any).selectionStart === 'number' ? Number((e.target as any).selectionStart || 0) : next.length)) {
              syncAtPicker(next, typeof (e.target as any).selectionStart === 'number' ? Number((e.target as any).selectionStart || 0) : next.length)
            }
          }}
          onKeyDown={onInputKeyDown}
          onKeyUp={() => syncAtPicker()}
          onClick={() => syncAtPicker()}
          onPaste={onPaste}
          disabled={disabled}
          sx={[
            {
              '& .MuiOutlinedInput-root': { borderRadius: `${radius}px` },
              '& .MuiOutlinedInput-root textarea': customScrollbarHiddenSx,
              '& .MuiOutlinedInput-notchedOutline': { border: 0 },
              '&:hover .MuiOutlinedInput-notchedOutline': { border: 0 },
              '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': { border: 0 },
            },
            fill ? FILL_INPUT_SX : null,
          ]}
        />
        <CustomScrollbarThumbs metrics={metrics} dragging={dragging} onBeginDrag={beginDrag} viewport={viewport} />
      </Box>

      <DependablePopover
        open={!!slashPicker && !!localInputRef.current}
        anchorEl={(localInputRef.current as any) || undefined}
        onClose={closeSlashPicker}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        disableAutoFocus
        disableEnforceFocus
        PaperProps={{
          sx: {
            width: 360,
            maxWidth: 'calc(100vw - 32px)',
            maxHeight: 340,
            overflow: 'hidden',
            borderRadius: 3,
            border: '1px solid rgba(124,58,237,.20)',
            boxShadow: '0 18px 42px rgba(88,28,135,.18)',
          },
        }}
      >
        <CustomScrollArea hostSx={{ maxHeight: 340, bgcolor: 'rgba(250,245,255,.96)' }} scrollSx={{ maxHeight: 340 }}>
          <Box sx={{ p: 0.75 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1, pb: 0.75 }}>
            <Chip size="small" color="secondary" label="/" />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="caption" sx={{ display: 'block', fontWeight: 900, color: 'secondary.dark' }}>
                命令表
              </Typography>
              <Typography variant="caption" color="text.secondary">
                上下键选择，回车/空格发送
              </Typography>
            </Box>
          </Stack>

          {slashCommandOptions.length ? (
            <List dense sx={{ py: 0 }}>
              {slashCommandOptions.map((item, index) => {
                const selected = index === clampNum(Math.floor(Number(slashPicker?.selectedIndex || 0)), 0, Math.max(0, slashCommandOptions.length - 1))
                return (
                  <ListItemButton
                    key={item.command}
                    selected={selected}
                    onMouseEnter={() => setSlashPicker((current) => (current ? { ...current, selectedIndex: index } : current))}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      sendSlashCommand(item.command)
                    }}
                    sx={{
                      borderRadius: 2,
                      alignItems: 'flex-start',
                      gap: 1,
                      '&.Mui-selected': {
                        bgcolor: 'rgba(124,58,237,.14)',
                      },
                      '&.Mui-selected:hover': {
                        bgcolor: 'rgba(124,58,237,.18)',
                      },
                    }}
                  >
                    <Chip size="small" variant={selected ? 'filled' : 'outlined'} color="secondary" label={item.command} sx={{ mt: 0.25, fontWeight: 900 }} />
                    <ListItemText
                      primary={item.title}
                      secondary={item.description}
                      primaryTypographyProps={{ fontWeight: 900, fontSize: 13 }}
                      secondaryTypographyProps={{ fontSize: 12 }}
                    />
                  </ListItemButton>
                )
              })}
            </List>
          ) : (
            <Typography variant="body2" sx={{ px: 1, py: 1 }} color="text.secondary">
              没有匹配的命令
            </Typography>
          )}
          </Box>
        </CustomScrollArea>
      </DependablePopover>

      <DependablePopover
        open={!!atPicker && !!localInputRef.current && activeTargetKind === 'group' && !!activeGroup}
        anchorEl={(localInputRef.current as any) || undefined}
        onClose={closeAtPicker}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        disableAutoFocus
        disableEnforceFocus
        PaperProps={{ sx: { width: 280, maxHeight: 320, overflow: 'hidden' } }}
      >
        <CustomScrollArea hostSx={{ maxHeight: 320 }} scrollSx={{ maxHeight: 320 }}>
          <Box sx={{ p: 0.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ px: 1, display: 'block', pb: 0.5 }}>
            点名回答：选择要被 @ 的角色
          </Typography>
          {atPickerOptions.length ? (
            <List dense sx={{ py: 0 }}>
              {atPickerOptions.map((r: any) => {
                const id = String(r?.id || '')
                const name = String(r?.name || '')
                const avatarImage = String(r?.avatarImage || '')
                const modelRefText = formatModelRefText(roleDefaultModelRef(r))
                return (
                  <ListItemButton
                    key={id || name}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      applyAtPickRole(r)
                    }}
                    sx={{ borderRadius: 1 }}
                  >
                    <ListItemAvatar sx={{ minWidth: 40 }}>
                      <EntityAvatar kind="role" image={avatarImage} size={28} />
                    </ListItemAvatar>
                    <ListItemText primary={name || '未命名角色'} secondary={modelRefText || '未配置模型'} />
                  </ListItemButton>
                )
              })}
            </List>
          ) : (
            <Typography variant="body2" sx={{ px: 1, py: 1 }} color="text.secondary">
              没找到匹配的角色
            </Typography>
          )}
          </Box>
        </CustomScrollArea>
      </DependablePopover>
    </>
  )
}
