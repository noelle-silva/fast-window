import * as React from 'react'
import AddIcon from '@mui/icons-material/Add'
import BoltOutlinedIcon from '@mui/icons-material/BoltOutlined'
import CropSquareIcon from '@mui/icons-material/CropSquare'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import RemoveIcon from '@mui/icons-material/Remove'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import CloseIcon from '@mui/icons-material/Close'
import TerminalOutlinedIcon from '@mui/icons-material/TerminalOutlined'
import { Box, Button, IconButton, Menu, MenuItem, Tooltip, Typography } from '@mui/material'

type WindowActions = {
  minimize: () => Promise<void> | void
  toggleMaximize: () => Promise<void> | void
  closeToTray: () => Promise<void> | void
}

// TopbarMenuItem 是顶部栏下拉菜单的一项；key 的语义由主界面解释为对应的跳转目标。
export type TopbarMenuItem = {
  key: string
  label: string
}

type AppTopbarProps = {
  standalone: boolean
  disabled?: boolean
  repoItems: TopbarMenuItem[]
  activeRepoKey: string | null
  spaceItems: TopbarMenuItem[]
  activeSpaceKey: string | null
  onCreateRepo: () => void
  onOpenQuickRuns: () => void
  onOpenRepo: (key: string) => void
  onOpenSpace: (key: string) => void
  onOpenSettings: () => void
  onStartDragging: () => Promise<void> | void
  windowActions: WindowActions
}

// topbarActionSx 统一顶部栏圆角矩形动作按钮（图标 + 文字）的外观。
const topbarActionSx = {
  minWidth: 0,
  flexShrink: 0,
  height: 28,
  px: 1.5,
  borderRadius: '10px',
  fontSize: 12,
  fontWeight: 900,
  color: 'text.primary',
  backgroundColor: 'rgba(17, 24, 39, 0.05)',
  '&:hover': {
    backgroundColor: 'rgba(17, 24, 39, 0.09)',
  },
  '&.Mui-disabled': {
    color: 'text.disabled',
    backgroundColor: 'rgba(17, 24, 39, 0.04)',
  },
}

type TopbarDropdownProps = {
  disabled?: boolean
  items: TopbarMenuItem[]
  activeKey: string | null
  fallbackLabel: string
  onSelect: (key: string) => void
}

// TopbarDropdown 是顶部栏通用下拉切换按钮：按钮显示当前选中项（未选中时用占位文案），菜单列出全部条目。
function TopbarDropdown({ disabled = false, items, activeKey, fallbackLabel, onSelect }: TopbarDropdownProps) {
  const [menuAnchor, setMenuAnchor] = React.useState<HTMLElement | null>(null)
  const label = items.find(item => item.key === activeKey)?.label ?? fallbackLabel

  return (
    <>
      <Button
        size="small"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={Boolean(menuAnchor)}
        endIcon={<ExpandMoreIcon sx={{ fontSize: 16 }} />}
        onClick={event => setMenuAnchor(event.currentTarget)}
        sx={{ ...topbarActionSx, minWidth: 96 }}
      >
        {label}
      </Button>
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        slotProps={{ paper: { sx: { minWidth: 220, maxWidth: 340 } } }}
      >
        {items.map(item => (
          <MenuItem
            key={item.key}
            selected={item.key === activeKey}
            onClick={() => {
              setMenuAnchor(null)
              onSelect(item.key)
            }}
          >
            <Typography noWrap sx={{ minWidth: 0 }}>{item.label}</Typography>
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

function run(action: () => Promise<void> | void) {
  Promise.resolve(action()).catch(() => {})
}

export function AppTopbar({ standalone, disabled = false, repoItems, activeRepoKey, spaceItems, activeSpaceKey, onCreateRepo, onOpenQuickRuns, onOpenRepo, onOpenSpace, onOpenSettings, onStartDragging, windowActions }: AppTopbarProps) {
  const topbarRef = React.useRef<HTMLElement | null>(null)

  // 仅在按到顶部栏自身区域（排除按钮）时启动窗口拖动。
  // 菜单等浮层经 React 门户渲染，事件会沿 React 树冒泡回顶部栏，
  // 用 DOM 包含关系判断，避免浮层内的点击被误当成拖动而丢失。
  const onPointerDown = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement | null
    if (!target || !topbarRef.current?.contains(target)) return
    if (target.closest('button, a, input, textarea, select, [role="button"], [data-window-controls="true"]')) return
    run(onStartDragging)
  }, [onStartDragging])

  return (
    <Box ref={topbarRef} component="header" className="cr-topbar" onPointerDown={onPointerDown}>
      <Box className="cr-brand">
        <Box className="cr-brand-mark" aria-hidden="true"><TerminalOutlinedIcon sx={{ fontSize: 15 }} /></Box>
        <Typography component="span" noWrap sx={{ minWidth: 0, fontSize: 14, fontWeight: 900 }}>Command Runner</Typography>
      </Box>
      <TopbarDropdown
        disabled={disabled}
        items={repoItems}
        activeKey={activeRepoKey}
        fallbackLabel="仓库"
        onSelect={onOpenRepo}
      />
      <Box className="cr-topbar-spacer" />
      <TopbarDropdown
        disabled={disabled}
        items={spaceItems}
        activeKey={activeSpaceKey}
        fallbackLabel="空间"
        onSelect={onOpenSpace}
      />
      <Button
        size="small"
        disabled={disabled}
        startIcon={<BoltOutlinedIcon sx={{ fontSize: 16 }} />}
        onClick={onOpenQuickRuns}
        sx={topbarActionSx}
      >
        快捷运行
      </Button>
      <Tooltip title="注册仓库">
        <IconButton size="small" disabled={disabled} onClick={onCreateRepo} aria-label="注册仓库">
          <AddIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="设置">
        <IconButton size="small" disabled={disabled} onClick={onOpenSettings} aria-label="设置">
          <SettingsOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      {standalone ? (
        <Box className="cr-window-controls" data-window-controls="true" aria-label="窗口控制">
          <IconButton size="small" aria-label="最小化" onClick={() => run(windowActions.minimize)}><RemoveIcon fontSize="small" /></IconButton>
          <IconButton size="small" aria-label="最大化或还原" onClick={() => run(windowActions.toggleMaximize)}><CropSquareIcon fontSize="small" /></IconButton>
          <IconButton size="small" className="cr-close-button" aria-label="关闭到托盘" onClick={() => run(windowActions.closeToTray)}><CloseIcon fontSize="small" /></IconButton>
        </Box>
      ) : null}
    </Box>
  )
}
