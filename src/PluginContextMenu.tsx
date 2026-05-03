import { Menu, MenuItem } from '@mui/material'
import type { Plugin } from './constants'

export type ContextMenuAction = {
  id: string
  label: string
  disabled?: boolean
  color?: 'error' | 'inherit'
  onSelect: () => void
}

interface PluginContextMenuProps {
  plugin: Plugin | null
  mouseX: number
  mouseY: number
  actions: ContextMenuAction[]
  onClose: () => void
}

export default function PluginContextMenu({
  plugin, mouseX, mouseY,
  actions, onClose,
}: PluginContextMenuProps) {
  const open = !!plugin

  return (
    <Menu
      open={open}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={open ? { top: mouseY, left: mouseX } : { top: 0, left: 0 }}
    >
      {actions.map(action => (
        <MenuItem
          key={action.id}
          disabled={action.disabled}
          sx={action.color === 'error' ? { color: 'error.main' } : undefined}
          onClick={() => {
            onClose()
            action.onSelect()
          }}
        >
          {action.label}
        </MenuItem>
      ))}
    </Menu>
  )
}
