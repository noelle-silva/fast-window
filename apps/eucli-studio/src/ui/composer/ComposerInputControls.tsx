import * as React from 'react'
import {
  Avatar,
  Box,
  Button,
  Chip,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Popover,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEvent } from '../hooks/useEvent'
import { findAtMentionTrigger } from '../utils/mention'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { clampNum } from '../utils/numbers'
import { COMPOSER_SLASH_COMMANDS, findSlashCommandTrigger } from './composerSlashCommands'

export function ComposerInputControls(props: {
  controller: any
  draftKey: string
  initialValue: string
  inputRef: React.MutableRefObject<HTMLTextAreaElement | HTMLInputElement | null>
  disabled: boolean
  draftFilesPending: boolean
  draftFilesWarn: boolean
  hasDraftNonText: boolean
  activeTargetKind: 'role' | 'group' | 'workspace'
  activeGroup: any
  roles: any[]
  activeStopRunId: string
  formatModelRefText: (modelRef: any) => string
  toolbarStart?: React.ReactNode
  onSend: () => void
  onStop: () => void
  onPaste: (e: React.ClipboardEvent) => void
}) {
  const {
    controller,
    draftKey,
    initialValue,
    inputRef,
    disabled,
    draftFilesPending,
    draftFilesWarn,
    hasDraftNonText,
    activeTargetKind,
    activeGroup,
    roles,
    activeStopRunId,
    formatModelRefText,
    toolbarStart,
    onSend,
    onStop,
    onPaste,
  } = props
  const localInputRef = React.useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)
  const [value, setValue] = React.useState(() => String(initialValue || ''))
  const [atPicker, setAtPicker] = React.useState<null | { triggerIndex: number; cursorIndex: number; query: string }>(null)
  const [slashPicker, setSlashPicker] = React.useState<null | { query: string; selectedIndex: number }>(null)

  const setInputRef = React.useCallback(
    (el: HTMLTextAreaElement | HTMLInputElement | null) => {
      localInputRef.current = el
      inputRef.current = el
    },
    [inputRef],
  )

  React.useEffect(() => {
    setValue(String(initialValue || ''))
    setAtPicker(null)
    setSlashPicker(null)
  }, [draftKey, initialValue])

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
    setValue(next)
    controller.actions.setDraft('input', next)
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
      onSend()
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
    onSend()
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendFromInput()
    }
  })

  const sendDisabled = disabled || draftFilesPending || (!String(value || '').trim() && !hasDraftNonText)

  return (
    <>
      <TextField
        fullWidth
        multiline
        minRows={2}
        maxRows={8}
        variant="outlined"
        placeholder="输入消息…（Enter 发送 / Shift+Enter 换行；支持粘贴图片/选择文件）"
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
        sx={{
          '& .MuiOutlinedInput-notchedOutline': { border: 0 },
          '&:hover .MuiOutlinedInput-notchedOutline': { border: 0 },
          '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': { border: 0 },
        }}
      />

      <Popover
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
      </Popover>

      <Popover
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
                const avatar = String(r?.avatar || '🙂')
                const avatarImage = String(r?.avatarImage || '')
                const modelRefText = formatModelRefText(r?.modelRef)
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
                      <Avatar src={avatarImage || undefined} sx={{ width: 28, height: 28, fontSize: 16 }}>
                        {avatar}
                      </Avatar>
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
      </Popover>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', px: 0.25 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', flex: 1, minWidth: 0, pl: 1 }}>
          {toolbarStart}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, ml: 'auto', pr: 1 }}>
          {activeStopRunId ? (
            <Button variant="contained" color="error" onClick={onStop} disabled={disabled} sx={{ borderRadius: 999 }}>
              停止
            </Button>
          ) : null}

          <Button variant="contained" color={draftFilesWarn ? 'warning' : 'primary'} onClick={sendFromInput} disabled={sendDisabled} sx={{ borderRadius: 999 }}>
            发送
          </Button>
        </Box>
      </Box>
    </>
  )
}
