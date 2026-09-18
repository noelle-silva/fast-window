import * as React from 'react'
import { Box, Button, Chip, CircularProgress, Divider, List, ListItemButton, ListItemText, Popover, Stack, Tooltip, Typography } from '@mui/material'
import { hookPromptPresetName, hookPromptSelectionLabel, normalizeHookPromptSelectionMode, type HookPromptLibrary, type HookPromptSelectionMode } from '../../domain/hookPrompt'

type HookPromptSelectorProps = {
  library: HookPromptLibrary
  selectedMode: HookPromptSelectionMode
  selectedPresetId: string
  roleDefaultPresetId?: string
  disabled?: boolean
  saving?: boolean
  disabledReason?: string
  onSelect: (mode: HookPromptSelectionMode, presetId: string) => void | Promise<void>
}

export function HookPromptSelector(props: HookPromptSelectorProps) {
  const { library, selectedMode, selectedPresetId, roleDefaultPresetId = '', disabled = false, saving = false, disabledReason = '', onSelect } = props
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null)
  const presets = Array.isArray(library?.presets) ? library.presets : []
  const mode = normalizeHookPromptSelectionMode(selectedMode)
  const label = hookPromptSelectionLabel(library, mode, selectedPresetId, roleDefaultPresetId)
  const open = !!anchorEl

  const close = () => setAnchorEl(null)
  React.useEffect(() => {
    if (disabled) setAnchorEl(null)
  }, [disabled])

  const select = (nextMode: HookPromptSelectionMode, presetId: string) => {
    if (disabled) return
    close()
    onSelect(nextMode, String(presetId || '').trim())
  }

  return (
    <>
      <Tooltip title={disabled ? disabledReason || '当前不可选择 hook 提示词' : saving ? 'hook 提示词保存中…' : `hook 提示词：${label}`}>
        <span>
          <Button
            aria-label="选择 hook 提示词"
            size="small"
            variant="text"
            disabled={disabled}
            onClick={(e) => setAnchorEl(e.currentTarget)}
            sx={{
              minWidth: 0,
              maxWidth: 180,
              px: 1,
              py: 0.25,
              borderRadius: 999,
              color: mode === 'inherit' ? 'text.secondary' : 'primary.main',
              textTransform: 'none',
              fontWeight: 900,
            }}
          >
            {saving ? <CircularProgress size={14} thickness={5} color="inherit" sx={{ mr: 0.5 }} /> : null}
            <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {saving ? '保存中…' : label}
            </Box>
          </Button>
        </span>
      </Tooltip>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={close}
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
      </Popover>
    </>
  )
}
