import * as React from 'react'
import { Box, Button, CircularProgress, Tooltip } from '@mui/material'
import { HookPromptPopover } from './HookPromptPopover'
import {
  hookPromptSelectionLabel,
  normalizeHookPromptSelectionMode,
  type HookPromptLibrary,
  type HookPromptSelectionMode,
} from '../../domain/hookPrompt'

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
  const mode = normalizeHookPromptSelectionMode(selectedMode)
  const label = hookPromptSelectionLabel(library, mode, selectedPresetId, roleDefaultPresetId)

  const close = () => setAnchorEl(null)
  React.useEffect(() => {
    if (disabled) setAnchorEl(null)
  }, [disabled])

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

      <HookPromptPopover
        anchorEl={anchorEl}
        onClose={close}
        library={library}
        selectedMode={mode}
        selectedPresetId={selectedPresetId}
        roleDefaultPresetId={roleDefaultPresetId}
        disabled={disabled}
        onSelect={onSelect}
      />
    </>
  )
}
