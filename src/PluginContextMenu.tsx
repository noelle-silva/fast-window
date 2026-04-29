import { Menu, MenuItem } from '@mui/material'
import type { Plugin } from './constants'

interface PluginContextMenuProps {
  plugin: Plugin | null
  mouseX: number
  mouseY: number
  loading: boolean
  refreshingId: string | null
  onClose: () => void
  onRefresh: (plugin: Plugin) => void
  onDetail: (plugin: Plugin) => void
  onChangeIcon: () => void
  onResetIcon: () => void
}

export default function PluginContextMenu({
  plugin, mouseX, mouseY,
  loading, refreshingId,
  onClose, onRefresh, onDetail, onChangeIcon, onResetIcon,
}: PluginContextMenuProps) {
  const open = !!plugin

  return (
    <Menu
      open={open}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={open ? { top: mouseY, left: mouseX } : { top: 0, left: 0 }}
    >
      <MenuItem
        disabled={loading || refreshingId === plugin?.id}
        onClick={() => {
          if (!plugin) return
          onClose()
          onRefresh(plugin)
        }}
      >
        刷新
      </MenuItem>
      <MenuItem
        onClick={() => {
          if (!plugin) return
          onDetail(plugin)
        }}
      >
        详情
      </MenuItem>
      <MenuItem onClick={() => { onClose(); onChangeIcon() }}>
        更改图标…
      </MenuItem>
      <MenuItem onClick={() => { onClose(); onResetIcon() }}>
        恢复默认图标
      </MenuItem>
    </Menu>
  )
}
