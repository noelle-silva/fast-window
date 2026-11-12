import * as React from 'react'
import { Box, Button, DialogActions, DialogContent, DialogTitle, Menu, MenuItem, TextField } from '@mui/material'
import { DependableDialog } from '../DependableOverlay'
import {
  DESK_GROUP_NAME_MAX,
  DESK_GROUP_PRESET_COLORS,
  type DeskGroup,
} from '../../../domain/desks'

// 分组标签的菜单与对话框。
//
// 菜单沿用之前那版：改名、20 色网格、仅解散分组、连组内会话一起移出。
// 本轮组里还没有内容，所以后两项当前效果相同，等能装会话了再分开。

export type DeskGroupTagMenuState = { mouseX: number; mouseY: number; group: DeskGroup } | null

const SWATCH = 20

export function DeskGroupTagMenu(props: {
  state: DeskGroupTagMenuState
  onClose: () => void
  onRename: (group: DeskGroup) => void
  onSetColor: (groupId: string, color: string) => void
  onRemove: (group: DeskGroup) => void
  onRemoveWithChats: (group: DeskGroup) => void
}) {
  const { state, onClose, onRename, onSetColor, onRemove, onRemoveWithChats } = props
  const group = state?.group

  return (
    <Menu
      open={!!state}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={state ? { top: state.mouseY, left: state.mouseX } : undefined}
      slotProps={{ paper: { sx: { minWidth: 200, py: 0.5 } } }}
    >
      <MenuItem
        onClick={() => {
          onClose()
          if (group) onRename(group)
        }}
        sx={{ fontSize: 13 }}
      >
        改名…
      </MenuItem>

      <Box sx={{ px: 1.5, py: 1, display: 'grid', gridTemplateColumns: `repeat(5, ${SWATCH}px)`, gap: 0.75 }}>
        {DESK_GROUP_PRESET_COLORS.map((color) => {
          const selected = group?.color === color
          return (
            <Box
              key={color}
              role="button"
              tabIndex={0}
              aria-label={`分组颜色 ${color}`}
              aria-pressed={selected}
              onClick={() => {
                if (!group) return
                onSetColor(group.id, color)
                onClose()
              }}
              sx={{
                width: SWATCH,
                height: SWATCH,
                borderRadius: 1.5,
                bgcolor: color,
                cursor: 'pointer',
                boxShadow: selected
                  ? (theme) => `0 0 0 2px ${theme.palette.background.paper}, 0 0 0 4px ${color}`
                  : '0 4px 10px rgba(15,23,42,.12)',
                transition: 'transform 120ms ease, filter 120ms ease',
                '&:hover': { transform: 'translateY(-1px) scale(1.06)', filter: 'brightness(1.06)' },
              }}
            />
          )
        })}
      </Box>

      <MenuItem
        onClick={() => {
          onClose()
          if (group) onRemove(group)
        }}
        sx={{ fontSize: 13 }}
      >
        仅解散分组
      </MenuItem>
      <MenuItem
        onClick={() => {
          onClose()
          if (group) onRemoveWithChats(group)
        }}
        sx={{ fontSize: 13, color: 'error.main' }}
      >
        连同组内会话移出桌面
      </MenuItem>
    </Menu>
  )
}

export function DeskGroupTagRenameDialog(props: {
  open: boolean
  group: DeskGroup | null
  onClose: () => void
  onSubmit: (groupId: string, name: string) => void
}) {
  const { open, group, onClose, onSubmit } = props
  const [name, setName] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    setName(String(group?.name || ''))
  }, [group?.id, group?.name, open])

  const trimmed = name.trim()
  const submit = () => {
    if (!group || !trimmed) return
    onSubmit(group.id, trimmed)
    onClose()
  }

  return (
    <DependableDialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>重命名分组</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          size="small"
          label="分组名"
          value={name}
          onChange={(event) => setName(event.target.value)}
          inputProps={{ maxLength: DESK_GROUP_NAME_MAX }}
          fullWidth
          sx={{ mt: 0.5 }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            submit()
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={submit} disabled={!trimmed}>
          保存
        </Button>
      </DialogActions>
    </DependableDialog>
  )
}

export function DeskGroupTagRemoveDialog(props: {
  group: DeskGroup | null
  onClose: () => void
  onConfirm: (groupId: string) => void
}) {
  const { group, onClose, onConfirm } = props
  return (
    <DependableDialog open={!!group} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>移出桌面？</DialogTitle>
      <DialogContent>
        <Box sx={{ fontSize: 13, color: 'text.secondary', lineHeight: 1.8 }}>
          分组「{group?.name || ''}」会从工作桌面移除。本轮分组里还没有承载会话，所以不会带走任何东西。
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button
          color="error"
          variant="contained"
          onClick={() => {
            if (!group) return
            onConfirm(group.id)
            onClose()
          }}
        >
          移出
        </Button>
      </DialogActions>
    </DependableDialog>
  )
}
