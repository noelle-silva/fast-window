import * as React from 'react'
import { Box, ButtonBase, Stack, Typography } from '@mui/material'
import type { ClipboardHistoryThemeId } from '../../shared/types'
import { CLIPBOARD_HISTORY_THEME_PRESETS } from '../theme'

type ThemePickerProps = {
  value: ClipboardHistoryThemeId
  disabled?: boolean
  onChange: (themeId: ClipboardHistoryThemeId) => void
}

export function ThemePicker(props: ThemePickerProps) {
  const { value, disabled, onChange } = props

  return (
    <Box role="radiogroup" aria-label="配色方案" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1 }}>
      {CLIPBOARD_HISTORY_THEME_PRESETS.map((preset) => {
        const active = preset.id === value
        const colors = preset.colors
        return (
          <ButtonBase
            key={preset.id}
            role="radio"
            aria-checked={active}
            aria-label={`切换到${preset.label}`}
            disabled={disabled}
            onClick={() => onChange(preset.id)}
            sx={{
              display: 'block',
              width: '100%',
              borderRadius: 2.5,
              p: 1,
              textAlign: 'left',
              color: colors.textPrimary,
              bgcolor: colors.paper,
              boxShadow: active ? `0 0 0 3px ${colors.focusRing}, 0 12px 26px ${colors.shadow}` : `0 8px 20px ${colors.shadow}`,
              transition: 'background-color 120ms ease, box-shadow 120ms ease, transform 120ms ease',
              opacity: disabled ? 0.62 : 1,
              '&:hover': {
                bgcolor: colors.input,
                transform: disabled ? 'none' : 'translateY(-1px)',
              },
              '&.Mui-focusVisible': {
                boxShadow: `0 0 0 3px ${colors.focusRing}, 0 12px 26px ${colors.shadow}`,
              },
            }}
          >
            <Stack spacing={0.75}>
              <Stack direction="row" spacing={0.5} alignItems="center">
                {preset.swatches.map((color) => (
                  <Box key={color} sx={{ width: 18, height: 18, borderRadius: 999, bgcolor: color, boxShadow: `0 2px 8px ${colors.shadow}` }} />
                ))}
              </Stack>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>{preset.label}</Typography>
              <Typography variant="caption" sx={{ color: colors.textSecondary }}>{preset.description}</Typography>
            </Stack>
          </ButtonBase>
        )
      })}
    </Box>
  )
}
