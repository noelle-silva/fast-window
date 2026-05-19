import * as React from 'react'
import { Box } from '@mui/material'
import { createColorPresetPreviewModel } from './colorPresetPreview'
import type { HyperCortexColorPreset } from './colorPresetTypes'

export function ColorPresetMiniPreview(props: { preset: HyperCortexColorPreset }): React.ReactNode {
  const preview = createColorPresetPreviewModel(props.preset)
  const { shell } = preview

  return (
    <Box
      aria-hidden
      sx={{
        minHeight: 96,
        borderRadius: 3,
        bgcolor: shell.appBg,
        color: shell.text,
        boxShadow: `0 10px 24px ${shell.shadow}`,
        overflow: 'hidden',
        display: 'grid',
        gridTemplateColumns: '1fr 72px',
      }}
    >
      <Box sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 0.7, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {preview.headerBars.map((bar, index) => (
            <Box key={bar.id} sx={{ width: bar.width, height: index === 0 ? 16 : 7, borderRadius: 999, bgcolor: bar.color }} />
          ))}
        </Box>

        <Box sx={{ borderRadius: 2, bgcolor: shell.surface, boxShadow: `0 6px 14px ${shell.shadow}`, p: 0.8, display: 'grid', gap: 0.55 }}>
          {preview.contentBars.map((bar, index) => (
            <Box key={bar.id} sx={{ height: index === 0 ? 7 : 6, width: bar.width, maxWidth: '100%', borderRadius: 999, bgcolor: bar.color }} />
          ))}
          <Box sx={{ display: 'flex', gap: 0.4, pt: 0.15 }}>
            {preview.emphasisBars.map(bar => (
              <Box key={bar.id} sx={{ width: bar.width, height: 13, borderRadius: 999, bgcolor: bar.color }} />
            ))}
          </Box>
        </Box>
      </Box>

      <Box sx={{ bgcolor: shell.codeBg, p: 0.8, display: 'grid', alignContent: 'center', gap: 0.5 }}>
        {preview.contrastBars.map(bar => (
          <Box key={bar.id} sx={{ height: 6, width: bar.width, borderRadius: 999, bgcolor: bar.color }} />
        ))}
      </Box>
    </Box>
  )
}
