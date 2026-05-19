import * as React from 'react'
import { Box, FormControlLabel, Radio, RadioGroup, Typography } from '@mui/material'
import type { HyperCortexSidebarSortModeV1 } from '../core'
import { FEATURE_TONES, toneBgVar, toneHoverVar } from './uiTones'

type SidebarSortSettingsPanelProps = {
  mode: HyperCortexSidebarSortModeV1
  onChange: (mode: HyperCortexSidebarSortModeV1) => void
}

const OPTIONS: { value: HyperCortexSidebarSortModeV1; title: string; description: string }[] = [
  {
    value: 'precision',
    title: '精准投放',
    description: '保留当前左侧标签页拖拽：可直接拖到顶层、分组内或空分组。',
  },
  {
    value: 'sortable',
    title: '@dnd-kit/sortable',
    description: '使用 @dnd-kit/sortable 的拖拽排序体验，适合快速调整相邻顺序。',
  },
]

export function SidebarSortSettingsPanel(props: SidebarSortSettingsPanelProps) {
  const { mode, onChange } = props

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography sx={{ fontSize: 18, lineHeight: 1.25, fontWeight: 900, color: 'var(--hc-text)' }}>左侧标签页排序</Typography>
        <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'var(--hc-text-muted)' }}>
          在这里切换左侧标签页的拖拽排序方式；切换只影响交互方式，不改变现有标签页顺序。
        </Typography>
      </Box>

      <RadioGroup
        value={mode}
        onChange={(_, value) => {
          if (value === 'precision' || value === 'sortable') onChange(value)
        }}
        sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}
      >
        {OPTIONS.map(option => (
          <Box
            key={option.value}
            sx={{
              borderRadius: 3,
              bgcolor: mode === option.value ? toneBgVar(FEATURE_TONES.display) : 'var(--hc-surface-soft)',
              boxShadow: mode === option.value ? '0 12px 26px var(--hc-shadow)' : 'none',
              px: 1.25,
              py: 1,
              '&:hover': { bgcolor: mode === option.value ? toneHoverVar(FEATURE_TONES.display) : 'var(--hc-surface-muted)' },
            }}
          >
            <FormControlLabel
              value={option.value}
              control={<Radio size="small" />}
              label={<Typography sx={{ fontSize: 13, fontWeight: 900, color: 'var(--hc-text)' }}>{option.title}</Typography>}
              sx={{ m: 0, alignItems: 'flex-start' }}
            />
            <Typography sx={{ mt: 0.5, pl: 3.75, fontSize: 12, lineHeight: 1.55, color: 'var(--hc-text-muted)' }}>
              {option.description}
            </Typography>
          </Box>
        ))}
      </RadioGroup>
    </Box>
  )
}
