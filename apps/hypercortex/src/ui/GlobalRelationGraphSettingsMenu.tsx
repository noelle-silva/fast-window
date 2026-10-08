import * as React from 'react'
import { Box, ClickAwayListener, Paper, Popper, Slider, Switch, Typography } from '@mui/material'
import {
  GRAPH_CENTER_STRENGTH_MAX,
  GRAPH_CENTER_STRENGTH_MIN,
  GRAPH_CENTER_STRENGTH_STEP,
  GRAPH_LINK_WIDTH_MAX,
  GRAPH_LINK_WIDTH_MIN,
  GRAPH_LINK_WIDTH_STEP,
  GRAPH_NODE_RADIUS_LIMIT_MAX,
  GRAPH_NODE_RADIUS_LIMIT_MIN,
  GRAPH_NODE_RADIUS_STEP,
  GRAPH_REPULSION_MAX,
  GRAPH_REPULSION_MIN,
  GRAPH_REPULSION_STEP,
  type HyperCortexGraphSettingsV1,
} from '../graphSettings'

// 全局关系图的设置浮层：斥力、紧凑度、节点半径上下限、连线粗细、箭头显示。
// 全部改动经 onChange 实时回写并持久化；浮层右上角抵着设置按钮。

function SettingSlider(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  const { label, value, min, max, step, onChange } = props
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Typography sx={{ width: 92, fontSize: 12, fontWeight: 800, color: 'var(--hc-text-muted)', whiteSpace: 'nowrap' }}>{label}</Typography>
      <Slider
        size="small"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(_event, next) => onChange(next as number)}
        sx={{ width: 140 }}
      />
    </Box>
  )
}

export function GlobalRelationGraphSettingsMenu(props: {
  open: boolean
  anchorEl: HTMLElement | null
  settings: HyperCortexGraphSettingsV1
  onChange: (next: HyperCortexGraphSettingsV1) => void
  onClose: () => void
}) {
  const { open, anchorEl, settings, onChange, onClose } = props

  return (
    <Popper open={open} anchorEl={anchorEl} placement="bottom-end" disablePortal={false} sx={{ zIndex: 2000 }}>
      <ClickAwayListener
        onClickAway={(event: any) => {
          const anchor = anchorEl
          if (anchor && event?.target && (anchor === event.target || anchor.contains(event.target))) return
          onClose()
        }}
      >
        <Paper
          elevation={10}
          sx={{
            width: 300,
            maxWidth: 'min(360px, calc(100vw - 24px))',
            borderRadius: 3,
            overflow: 'hidden',
            boxShadow: '0 18px 48px rgba(0,0,0,.20)',
            p: 1.25,
            display: 'flex',
            flexDirection: 'column',
            gap: 0.5,
          }}
        >
          <Typography sx={{ fontSize: 12, fontWeight: 900, color: 'var(--hc-text)' }}>关系图设置</Typography>
          <SettingSlider
            label="斥力"
            value={settings.repulsion}
            min={GRAPH_REPULSION_MIN}
            max={GRAPH_REPULSION_MAX}
            step={GRAPH_REPULSION_STEP}
            onChange={repulsion => onChange({ ...settings, repulsion })}
          />
          <SettingSlider
            label="紧凑度"
            value={settings.centerStrength}
            min={GRAPH_CENTER_STRENGTH_MIN}
            max={GRAPH_CENTER_STRENGTH_MAX}
            step={GRAPH_CENTER_STRENGTH_STEP}
            onChange={centerStrength => onChange({ ...settings, centerStrength })}
          />
          <SettingSlider
            label="节点半径最小值"
            value={settings.minNodeRadius}
            min={GRAPH_NODE_RADIUS_LIMIT_MIN}
            max={GRAPH_NODE_RADIUS_LIMIT_MAX}
            step={GRAPH_NODE_RADIUS_STEP}
            onChange={minNodeRadius => onChange({ ...settings, minNodeRadius })}
          />
          <SettingSlider
            label="节点半径最大值"
            value={settings.maxNodeRadius}
            min={GRAPH_NODE_RADIUS_LIMIT_MIN}
            max={GRAPH_NODE_RADIUS_LIMIT_MAX}
            step={GRAPH_NODE_RADIUS_STEP}
            onChange={maxNodeRadius => onChange({ ...settings, maxNodeRadius })}
          />
          <SettingSlider
            label="连线粗细"
            value={settings.linkWidth}
            min={GRAPH_LINK_WIDTH_MIN}
            max={GRAPH_LINK_WIDTH_MAX}
            step={GRAPH_LINK_WIDTH_STEP}
            onChange={linkWidth => onChange({ ...settings, linkWidth })}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, pl: 0.25 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'var(--hc-text-muted)', whiteSpace: 'nowrap' }}>箭头显示</Typography>
            <Switch size="small" checked={settings.showArrows} onChange={(_event, checked) => onChange({ ...settings, showArrows: checked })} />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, pl: 0.25 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'var(--hc-text-muted)', whiteSpace: 'nowrap' }}>悬停时虚化其他节点</Typography>
            <Switch size="small" checked={settings.dimOnHover} onChange={(_event, checked) => onChange({ ...settings, dimOnHover: checked })} />
          </Box>
        </Paper>
      </ClickAwayListener>
    </Popper>
  )
}
