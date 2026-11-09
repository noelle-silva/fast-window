import * as React from 'react'
import { Box, Chip, Divider, List, ListItemButton, ListItemText, Stack, Typography } from '@mui/material'
import { DependablePopover } from './DependableOverlay'
import {
  hookPromptPresetName,
  normalizeHookPromptSelectionMode,
  type HookPromptLibrary,
  type HookPromptSelectionMode,
} from '../../domain/hookPrompt'

type HookPromptPopoverProps = {
  /** 弹层锚点：工具条按钮自己管，或由更多菜单把「更多」按钮交进来。 */
  anchorEl: HTMLElement | null
  onClose: () => void
  library: HookPromptLibrary
  selectedMode: HookPromptSelectionMode
  selectedPresetId: string
  roleDefaultPresetId?: string
  disabled?: boolean
  onSelect: (mode: HookPromptSelectionMode, presetId: string) => void | Promise<void>
}

// hook 提示词弹层：与触发方式解耦，直显按钮与更多菜单共用同一份内容。
export function HookPromptPopover(props: HookPromptPopoverProps) {
  const { anchorEl, onClose, library, selectedMode, selectedPresetId, roleDefaultPresetId = '', disabled = false, onSelect } = props
  const presets = Array.isArray(library?.presets) ? library.presets : []
  const mode = normalizeHookPromptSelectionMode(selectedMode)

  const select = (nextMode: HookPromptSelectionMode, presetId: string) => {
    if (disabled) return
    onClose()
    onSelect(nextMode, String(presetId || '').trim())
  }

  return (
    <DependablePopover
      open={!!anchorEl}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
      transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
    >
      <Box sx={{ width: 320, maxWidth: 'calc(100vw - 32px)', p: 1 }}>
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>hook 提示词</Typography>
            <Box sx={{ flex: 1 }} />
            <Chip size="small" variant="outlined" label={presets.length ? `${presets.length} 个预设` : '无预设'} />
          </Stack>
          <Typography variant="caption" color="text.secondary">跟随角色默认、临时指定，或明确关闭当前会话预设。</Typography>
          <Divider />
          <List dense sx={{ py: 0 }}>
            <ListItemButton disabled={disabled} selected={mode === 'inherit'} onClick={() => select('inherit', '')} sx={{ borderRadius: 2 }}>
              <ListItemText primary="跟随角色" secondary={roleDefaultPresetId ? `使用角色默认：${hookPromptPresetName(library, roleDefaultPresetId)}` : '角色未设置默认预设'} primaryTypographyProps={{ fontWeight: 900 }} />
            </ListItemButton>
            <ListItemButton disabled={disabled} selected={mode === 'none'} onClick={() => select('none', '')} sx={{ borderRadius: 2 }}>
              <ListItemText primary="无预设" secondary="本会话明确不使用 hook 提示词" primaryTypographyProps={{ fontWeight: 900 }} />
            </ListItemButton>
            {presets.map((preset) => {
              const id = String(preset?.id || '')
              if (!id) return null
              return (
                <ListItemButton key={id} disabled={disabled} selected={mode === 'preset' && id === selectedPresetId} onClick={() => select('preset', id)} sx={{ borderRadius: 2 }}>
                  <ListItemText
                    primary={String(preset?.name || '未命名预设')}
                    secondary={`${Array.isArray(preset?.messages) ? preset.messages.length : 0} 条提示内容`}
                    primaryTypographyProps={{ fontWeight: 900, noWrap: true }}
                  />
                </ListItemButton>
              )
            })}
          </List>
        </Stack>
      </Box>
    </DependablePopover>
  )
}
