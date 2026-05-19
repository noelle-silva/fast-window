import * as React from 'react'
import { Box, Typography } from '@mui/material'
import type { HyperCortexColorPresetIdV1 } from '../core'
import { HYPERCORTEX_COLOR_PRESETS } from './colorPresets'
import { FEATURE_TONES, toneFocusVisibleSx, toneSelectedSurfaceSx } from './uiTones'

export function ColorPresetSettingsPanel(props: {
  value: HyperCortexColorPresetIdV1
  onChange: (presetId: HyperCortexColorPresetIdV1) => void
}) {
  const { value, onChange } = props

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box>
        <Typography sx={{ fontSize: 18, lineHeight: 1.25, fontWeight: 900, color: 'var(--hc-text)' }}>配色预设</Typography>
        <Typography sx={{ mt: 0.5, fontSize: 13, lineHeight: 1.6, color: 'var(--hc-text-muted)' }}>
          选择一套全局视觉气质；颜色、状态色、附件色和场景 tone 会通过同一套变量机制同步切换。
        </Typography>
      </Box>

      <Box sx={{ display: 'grid', gap: 1 }}>
        {HYPERCORTEX_COLOR_PRESETS.map(preset => {
          const active = preset.id === value
          return (
            <Box
              key={preset.id}
              role="button"
              tabIndex={0}
              aria-pressed={active}
              onClick={() => onChange(preset.id)}
              onKeyDown={event => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onChange(preset.id)
              }}
              sx={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                alignItems: 'center',
                gap: 1,
                px: 1.25,
                py: 1,
                borderRadius: 3,
                cursor: 'pointer',
                userSelect: 'none',
                ...toneSelectedSurfaceSx(FEATURE_TONES.display, active),
                '&:focus-visible': toneFocusVisibleSx(FEATURE_TONES.display),
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 14, fontWeight: 900, color: 'var(--hc-text)' }}>{preset.label}</Typography>
                <Typography sx={{ mt: 0.35, fontSize: 12, lineHeight: 1.5, color: 'var(--hc-text-muted)' }}>{preset.description}</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }} aria-hidden>
                {[
                  preset.colors.accentSage,
                  preset.colors.accentSky,
                  preset.colors.accentLavender,
                  preset.colors.accentClay,
                  preset.colors.accentButter,
                ].map(color => (
                  <Box key={color} sx={{ width: 18, height: 18, borderRadius: 999, bgcolor: color, boxShadow: '0 6px 14px var(--hc-shadow)' }} />
                ))}
              </Box>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
