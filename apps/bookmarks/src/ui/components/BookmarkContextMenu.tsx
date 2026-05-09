import * as React from 'react'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import { ListItemIcon, ListItemText, Menu, MenuItem } from '@mui/material'
import type { BookmarkItem, ContextMenuState } from '../types'

type Props = {
  menu: ContextMenuState
  onClose(): void
  onDelete(item: BookmarkItem): void
  onEdit(item: BookmarkItem): void
  onOpen(item: BookmarkItem): void
  onRefreshIcon(item: BookmarkItem): void
}

export function BookmarkContextMenu(props: Props): React.ReactNode {
  const item = props.menu?.item
  return (
    <Menu
      open={Boolean(props.menu)}
      onClose={props.onClose}
      anchorReference="anchorPosition"
      anchorPosition={props.menu ? { left: props.menu.x, top: props.menu.y } : undefined}
      onClick={event => event.stopPropagation()}
    >
      {item ? [
        <MenuItem key="open" onClick={() => props.onOpen(item)}>
          <ListItemIcon><OpenInNewRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>打开</ListItemText>
        </MenuItem>,
        <MenuItem key="edit" onClick={() => props.onEdit(item)}>
          <ListItemIcon><EditRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>编辑</ListItemText>
        </MenuItem>,
        <MenuItem key="refresh" onClick={() => props.onRefreshIcon(item)}>
          <ListItemIcon><RefreshRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>刷新图标</ListItemText>
        </MenuItem>,
        <MenuItem key="delete" onClick={() => props.onDelete(item)} sx={{ color: 'error.main' }}>
          <ListItemIcon><DeleteOutlineRoundedIcon fontSize="small" color="error" /></ListItemIcon>
          <ListItemText>删除</ListItemText>
        </MenuItem>,
      ] : null}
    </Menu>
  )
}
