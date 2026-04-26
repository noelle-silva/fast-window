import * as React from 'react'
import { Box, FormControlLabel, Radio, RadioGroup, Typography } from '@mui/material'
import type { HyperCortexSidebarSortModeV1 } from '../core'

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
    title: 'AI Draw 同款排序',
    description: '使用和 ai-draw 一致的拖拽手柄排序体验，适合快速调整相邻顺序。',
  },
]

export function SidebarSortSettingsPanel(props: SidebarSortSettingsPanelProps) {
  const { mode, onChange } = props

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography sx={{ fontSize: 18, lineHeight: 1.25, fontWeight: 900, color: '#111' }}>左侧标签页排序</Typography>
        <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.62)' }}>
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
              border: mode === option.value ? '1px solid rgba(25,118,210,.48)' : '1px solid rgba(0,0,0,.08)',
              bgcolor: mode === option.value ? 'rgba(25,118,210,.06)' : 'rgba(0,0,0,.02)',
              px: 1.25,
              py: 1,
            }}
          >
            <FormControlLabel
              value={option.value}
              control={<Radio size="small" />}
              label={<Typography sx={{ fontSize: 13, fontWeight: 900, color: '#111' }}>{option.title}</Typography>}
              sx={{ m: 0, alignItems: 'flex-start' }}
            />
            <Typography sx={{ mt: 0.5, pl: 3.75, fontSize: 12, lineHeight: 1.55, color: 'rgba(0,0,0,.56)' }}>
              {option.description}
            </Typography>
          </Box>
        ))}
      </RadioGroup>
    </Box>
  )
}
