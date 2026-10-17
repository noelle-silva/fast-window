import * as React from 'react'
import { IconButton, List, ListItemAvatar, ListItemButton, ListItemText, Tooltip, Typography } from '@mui/material'
import SettingsIcon from '@mui/icons-material/Settings'
import { EntityAvatar } from './avatar/EntityAvatar'
import { SOFT_POPOVER_ITEM_SX, SOFT_POPOVER_LIST_SX } from '../softPopoverStyles'

// 角色 / 工作区列表项：选择器浮层与侧边栏共用同一份渲染，
// 差异只在「哪些算选中」和「点选后做什么」——都由调用方注入。

export function RoleList(props: {
  roles: any[]
  isSelected: (roleId: string) => boolean
  onSelect: (roleId: string) => void
  onOpenEditor: (roleId: string) => void
  formatModelRefText: (modelRef: any) => string
}) {
  const { roles, isSelected, onSelect, onOpenEditor, formatModelRefText } = props
  return (
    <List dense sx={SOFT_POPOVER_LIST_SX}>
      {roles.map((r: any) => {
        const roleId = String(r?.id || '')
        const modelRefText = formatModelRefText(r?.modelRef)
        return (
          <ListItemButton
            key={roleId}
            selected={isSelected(roleId)}
            onClick={() => onSelect(roleId)}
            sx={SOFT_POPOVER_ITEM_SX}
          >
            <ListItemAvatar>
              <EntityAvatar kind="role" image={String(r?.avatarImage || '')} size={42} />
            </ListItemAvatar>
            <ListItemText
              sx={{ minWidth: 0 }}
              primary={
                <Typography sx={{ fontWeight: 900, fontSize: 13 }} noWrap>
                  {String(r?.name || '')}
                </Typography>
              }
              secondary={
                <Typography variant="caption" color="text.secondary" noWrap>
                  {modelRefText || '未配置模型'}
                </Typography>
              }
            />
            <Tooltip title="设置">
              <IconButton
                size="small"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onOpenEditor(roleId)
                }}
              >
                <SettingsIcon fontSize="inherit" />
              </IconButton>
            </Tooltip>
          </ListItemButton>
        )
      })}
    </List>
  )
}

export function WorkspaceList(props: {
  workspaces: any[]
  isSelected: (workspaceId: string) => boolean
  onSelect: (workspaceId: string) => void
  onOpenEditor: (workspaceId: string) => void
}) {
  const { workspaces, isSelected, onSelect, onOpenEditor } = props
  return (
    <List dense sx={SOFT_POPOVER_LIST_SX}>
      {workspaces.map((workspace: any) => {
        const workspaceId = String(workspace?.id || '')
        const directoryCount = Array.isArray(workspace?.directories) ? workspace.directories.length : 0
        return (
          <ListItemButton
            key={workspaceId}
            selected={isSelected(workspaceId)}
            onClick={() => onSelect(workspaceId)}
            sx={SOFT_POPOVER_ITEM_SX}
          >
            <ListItemAvatar>
              <EntityAvatar kind="workspace" size={28} />
            </ListItemAvatar>
            <ListItemText
              sx={{ minWidth: 0 }}
              primary={
                <Typography sx={{ fontWeight: 900, fontSize: 13 }} noWrap>
                  {String(workspace?.name || '')}
                </Typography>
              }
              secondary={
                <Typography variant="caption" color="text.secondary" noWrap>
                  {directoryCount ? `${directoryCount} 个目录` : '暂未登记目录'}
                </Typography>
              }
            />
            <Tooltip title="设置">
              <IconButton
                size="small"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onOpenEditor(workspaceId)
                }}
              >
                <SettingsIcon fontSize="inherit" />
              </IconButton>
            </Tooltip>
          </ListItemButton>
        )
      })}
    </List>
  )
}
