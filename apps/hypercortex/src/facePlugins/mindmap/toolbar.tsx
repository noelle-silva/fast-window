import * as React from 'react'
import AccountTreeRoundedIcon from '@mui/icons-material/AccountTreeRounded'
import AddCircleOutlineRoundedIcon from '@mui/icons-material/AddCircleOutlineRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import PaletteRoundedIcon from '@mui/icons-material/PaletteRounded'
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import { Divider, IconButton, Menu, MenuItem, Tooltip } from '@mui/material'

const LAYOUT_OPTIONS = [
  { value: 'logicalStructure', label: '逻辑结构图' },
  { value: 'mindMap', label: '思维导图' },
  { value: 'organizationStructure', label: '组织结构图' },
  { value: 'timeline', label: '时间轴' },
  { value: 'fishbone', label: '鱼骨图' },
]

const THEME_OPTIONS = [
  { value: 'default', label: '默认' },
  { value: 'dark', label: '暗色' },
]

const iconSx = {
  color: 'rgba(0,0,0,.6)',
  p: 0.5,
  '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
  '&.Mui-disabled': { color: 'rgba(0,0,0,.24)' },
} as const

/** 画布内悬浮工具条：添加子节点 + 缩放 + 布局/主题切换。 */
export type MindmapFloatingToolbarProps = {
  scale: number
  onZoomIn: () => void
  onZoomOut: () => void
  onResetZoom: () => void
  /** 添加子节点（作用于当前选中节点）；缺省不显示该控件（阅读态）。 */
  onAddChild?: () => void
  /** 无选中节点时置灰。 */
  addChildDisabled?: boolean
  layout?: string
  theme?: string
  onSelectLayout?: (layout: string) => void
  onSelectTheme?: (theme: string) => void
}

export function MindmapFloatingToolbar(props: MindmapFloatingToolbarProps): React.ReactNode {
  const { scale, onZoomIn, onZoomOut, onResetZoom, onAddChild, addChildDisabled, layout, theme, onSelectLayout, onSelectTheme } = props
  const [layoutAnchor, setLayoutAnchor] = React.useState<HTMLElement | null>(null)
  const [themeAnchor, setThemeAnchor] = React.useState<HTMLElement | null>(null)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        padding: '2px 6px',
        borderRadius: 999,
        background: 'rgba(255,255,255,.92)',
        boxShadow: '0 1px 6px rgba(0,0,0,.14)',
        backdropFilter: 'blur(8px)',
      }}
    >
      {onAddChild ? (
        <>
          <Tooltip title={addChildDisabled ? '先选中一个节点' : '添加子节点'}>
            <span style={{ display: 'inline-flex' }}>
              <IconButton size="small" aria-label="添加子节点" disabled={addChildDisabled} onClick={onAddChild} sx={iconSx}>
                <AddCircleOutlineRoundedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Divider orientation="vertical" flexItem sx={{ my: 0.75, mx: 0.25, borderColor: 'rgba(0,0,0,.12)' }} />
        </>
      ) : null}

      <Tooltip title="缩小">
        <IconButton size="small" aria-label="缩小" onClick={onZoomOut} sx={iconSx}>
          <RemoveRoundedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <span style={{ minWidth: 42, textAlign: 'center', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'rgba(0,0,0,.6)' }}>
        {Math.round(scale * 100)}%
      </span>
      <Tooltip title="放大">
        <IconButton size="small" aria-label="放大" onClick={onZoomIn} sx={iconSx}>
          <AddRoundedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="重置缩放">
        <IconButton size="small" aria-label="重置缩放" onClick={onResetZoom} sx={iconSx}>
          <RestartAltRoundedIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      {onSelectLayout ? (
        <>
          <Tooltip title="布局结构">
            <IconButton size="small" aria-label="布局结构" onClick={event => setLayoutAnchor(event.currentTarget)} sx={iconSx}>
              <AccountTreeRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Menu anchorEl={layoutAnchor} open={Boolean(layoutAnchor)} onClose={() => setLayoutAnchor(null)}>
            {LAYOUT_OPTIONS.map(option => (
              <MenuItem
                key={option.value}
                selected={option.value === layout}
                onClick={() => {
                  onSelectLayout(option.value)
                  setLayoutAnchor(null)
                }}
                sx={{ fontSize: 13 }}
              >
                {option.label}
              </MenuItem>
            ))}
          </Menu>
        </>
      ) : null}

      {onSelectTheme ? (
        <>
          <Tooltip title="主题">
            <IconButton size="small" aria-label="主题" onClick={event => setThemeAnchor(event.currentTarget)} sx={iconSx}>
              <PaletteRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Menu anchorEl={themeAnchor} open={Boolean(themeAnchor)} onClose={() => setThemeAnchor(null)}>
            {THEME_OPTIONS.map(option => (
              <MenuItem
                key={option.value}
                selected={option.value === theme}
                onClick={() => {
                  onSelectTheme(option.value)
                  setThemeAnchor(null)
                }}
                sx={{ fontSize: 13 }}
              >
                {option.label}
              </MenuItem>
            ))}
          </Menu>
        </>
      ) : null}
    </div>
  )
}
