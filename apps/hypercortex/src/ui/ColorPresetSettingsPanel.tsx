import * as React from 'react'
import { Box, Typography } from '@mui/material'
import type { HyperCortexColorPresetIdV1 } from '../core'
import { HYPERCORTEX_COLOR_PRESETS } from './colorPresets'
import { ColorPresetOption } from './ColorPresetOption'

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
          return <ColorPresetOption key={preset.id} preset={preset} active={active} onChange={onChange} />
        })}
      </Box>
    </Box>
  )
}
