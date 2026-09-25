import * as React from 'react'
import { Box, Typography } from '@mui/material'

import { settingsChoiceMarkSx, settingsSelectableSurfaceSx } from '../settingsUiStyles'

/** 设置选项卡：全局面板与笔记级覆盖共用的枚举选项展示与选择。 */
export function FaceSettingChoiceCard(props: {
  label: string
  description?: string
  active: boolean
  disabled?: boolean
  /** 笔记级面板的紧凑字号。 */
  dense?: boolean
  onSelect: () => void
}): React.ReactNode {
  const { label, description, active, disabled, dense, onSelect } = props
  const locked = disabled || active
  return (
    <Box
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={() => {
        if (locked) return
        onSelect()
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (!locked) onSelect()
        }
      }}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.5,
        px: 1.5,
        py: 1,
        borderRadius: 2,
        ...settingsSelectableSurfaceSx(active),
        cursor: locked ? 'default' : 'pointer',
        userSelect: 'none',
        transition: 'background 120ms, box-shadow 120ms',
      }}
    >
      <Box sx={settingsChoiceMarkSx(active)}>
        {active ? <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'var(--hc-surface)' }} /> : null}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: dense ? 13.5 : 14, fontWeight: 700, color: 'var(--hc-text)', lineHeight: 1.3 }}>
          {label}
        </Typography>
        {description ? (
          <Typography sx={{ mt: 0.35, fontSize: 12, lineHeight: 1.5, color: 'var(--hc-text-muted)' }}>
            {description}
          </Typography>
        ) : null}
      </Box>
    </Box>
  )
}
