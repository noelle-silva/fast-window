import { useEffect, useRef, useState } from 'react'
import {
  Avatar, Box, Chip, ClickAwayListener, IconButton, InputAdornment,
  List, ListItemButton, Paper, Popper, TextField, Typography,
} from '@mui/material'
import ArrowDropDownRoundedIcon from '@mui/icons-material/ArrowDropDownRounded'
import type { RegisteredAppShortcut } from './types'
import { hostSoftChipSx, hostTextFieldSx } from '../components/hostUiStyles'
import { resolveHostShortcutIcon, resolveHostShortcutIconImageUrl } from './hostShortcutIcon'

interface AppHostShortcutPickerProps {
  candidates: RegisteredAppShortcut[] | null
  registeredShortcuts: RegisteredAppShortcut[]
  appIcon: string
  disabled?: boolean
  onToggle: (candidate: RegisteredAppShortcut) => void
}

const PICKER_LIST_WIDTH = 320
const PICKER_LIST_MAX_HEIGHT = 320

export default function AppHostShortcutPicker({
  candidates,
  registeredShortcuts,
  appIcon,
  disabled = false,
  onToggle,
}: AppHostShortcutPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const anchorRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setQuery('')
  }, [candidates])

  const registeredIds = new Set(registeredShortcuts.map(shortcut => shortcut.id))
  const normalizedQuery = query.trim().toLowerCase()
  const filteredCandidates = (candidates ?? []).filter(candidate =>
    !normalizedQuery
    || candidate.title.toLowerCase().includes(normalizedQuery)
    || candidate.id.toLowerCase().includes(normalizedQuery))

  const emptyMessage = candidates === null
    ? '先点“读取宿主快捷命令”获取候选清单。'
    : candidates.length === 0
      ? '这个 App 没有返回宿主快捷命令。'
      : '没有匹配的条目'

  const handleClickAway = (event: MouseEvent | TouchEvent) => {
    if (anchorRef.current?.contains(event.target as Node)) return
    setOpen(false)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape' || !open) return
    event.stopPropagation()
    setOpen(false)
  }

  return (
    <Box ref={anchorRef} onKeyDown={handleKeyDown} sx={{ flexShrink: 0 }}>
      <TextField
        size="small"
        placeholder="搜索宿主快捷命令"
        value={query}
        disabled={disabled}
        onChange={event => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        inputProps={{ 'aria-label': '搜索宿主快捷命令' }}
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                size="small"
                edge="end"
                disabled={disabled}
                aria-label={open ? '收起候选宿主快捷命令' : '展开候选宿主快捷命令'}
                onClick={() => setOpen(prev => !prev)}
              >
                <ArrowDropDownRoundedIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ),
        }}
        sx={{ ...hostTextFieldSx, width: 220 }}
      />
      <Popper
        open={open}
        anchorEl={anchorRef.current}
        placement="bottom-start"
        modifiers={[{ name: 'offset', options: { offset: [0, 8] } }]}
        sx={{ zIndex: 1600 }}
      >
        <ClickAwayListener onClickAway={handleClickAway}>
          <Paper
            elevation={8}
            sx={{ width: PICKER_LIST_WIDTH, maxHeight: PICKER_LIST_MAX_HEIGHT, overflowY: 'auto', borderRadius: 2.25 }}
          >
            {filteredCandidates.length === 0 ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1.5, py: 1.25 }}>
                {emptyMessage}
              </Typography>
            ) : (
              <List dense disablePadding sx={{ py: 0.5 }}>
                {filteredCandidates.map(candidate => {
                  const registered = registeredIds.has(candidate.id)
                  const displayIcon = resolveHostShortcutIcon(candidate, appIcon)
                  const iconImageUrl = resolveHostShortcutIconImageUrl(candidate, appIcon)

                  return (
                    <ListItemButton
                      key={candidate.id}
                      disabled={disabled}
                      selected={registered}
                      onClick={() => onToggle(candidate)}
                      sx={{ gap: 1, px: 1.25, py: 0.65 }}
                    >
                      <Avatar
                        variant="rounded"
                        src={iconImageUrl}
                        imgProps={{ alt: `${candidate.title || '宿主快捷命令'} 图标预览` }}
                        sx={{ width: 28, height: 28, fontSize: 13, bgcolor: 'action.hover', color: 'text.primary', flexShrink: 0 }}
                      >
                        {iconImageUrl ? null : displayIcon}
                      </Avatar>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography variant="body2" noWrap sx={{ lineHeight: 1.35 }}>
                          {candidate.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                          {candidate.id}
                        </Typography>
                      </Box>
                      {registered ? (
                        <Chip label="已登记" size="small" sx={{ ...hostSoftChipSx, height: 20, fontSize: 11, flexShrink: 0 }} />
                      ) : null}
                    </ListItemButton>
                  )
                })}
              </List>
            )}
          </Paper>
        </ClickAwayListener>
      </Popper>
    </Box>
  )
}
