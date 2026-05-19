import * as React from 'react'
import { Box, Typography } from '@mui/material'
import type { HyperCortexColorPresetIdV1 } from '../core'
import { ColorPresetMiniPreview } from './ColorPresetMiniPreview'
import type { HyperCortexColorPreset } from './colorPresetTypes'

export function ColorPresetOption(props: {
  preset: HyperCortexColorPreset
  active: boolean
  onChange: (presetId: HyperCortexColorPresetIdV1) => void
}): React.ReactNode {
  const { preset, active, onChange } = props

  return (
    <Box
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
        gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) 230px' },
        alignItems: 'stretch',
        gap: 1.25,
        px: 1.25,
        py: 1,
        borderRadius: 3,
        cursor: 'pointer',
        userSelect: 'none',
        ...colorPresetOptionSx(preset, active),
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 900, color: 'var(--hc-text)' }}>{preset.label}</Typography>
        <Typography sx={{ mt: 0.35, fontSize: 12, lineHeight: 1.5, color: 'var(--hc-text-muted)' }}>{preset.description}</Typography>
        <Box sx={{ mt: 0.65, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          <Typography component="span" sx={colorPresetBadgeSx(preset)}>
            {preset.personality.source}
          </Typography>
          <Typography component="span" sx={colorPresetBadgeSx(preset)}>
            {preset.personality.expression}
          </Typography>
        </Box>
      </Box>
      <ColorPresetMiniPreview preset={preset} />
    </Box>
  )
}

function colorPresetOptionSx(preset: HyperCortexColorPreset, active: boolean) {
  return {
    position: 'relative',
    overflow: 'hidden',
    bgcolor: active ? 'var(--hc-surface)' : 'var(--hc-surface-soft)',
    boxShadow: active ? '0 12px 26px var(--hc-shadow)' : 'none',
    '&:hover': {
      bgcolor: active ? 'var(--hc-surface-soft)' : 'var(--hc-surface-muted)',
    },
    '&:focus-visible': {
      outline: 'none',
      bgcolor: 'var(--hc-surface-soft)',
      boxShadow: '0 12px 26px var(--hc-shadow)',
    },
    '&::before': active ? colorPresetSelectionStripSx(preset) : undefined,
    '&::after': {
      ...colorPresetSelectionStripSx(preset),
      opacity: 0,
    },
    '&:focus-visible::after': {
      opacity: 1,
    },
  }
}

function colorPresetSelectionStripSx(preset: HyperCortexColorPreset) {
  return {
    content: '""',
    position: 'absolute',
    left: 0,
    top: 8,
    bottom: 8,
    width: 4,
    borderRadius: 999,
    bgcolor: preset.preview.selection,
  }
}

function colorPresetBadgeSx(preset: HyperCortexColorPreset) {
  return {
    px: 0.75,
    py: 0.25,
    borderRadius: 999,
    bgcolor: preset.preview.badgeBg,
    color: preset.preview.badgeFg,
    fontSize: 10.5,
    fontWeight: 900,
  }
}
