import * as React from 'react'
import { Box, Button, Typography } from '@mui/material'
import { RoleList } from '../EntityLists'
import { SidebarEmptyHint } from './SidebarSection'

// 角色 / 工作区两个侧边栏视图共用的角色列表：
// 选中态与空态文案由视图范围决定，点选和编辑回调由所在面板提供。
export function SidebarRoleList(props: {
  roles: any[]
  scope: 'role' | 'workspace'
  workspaceId: string
  activeRoleId: string
  activeTargetKind: 'role' | 'group' | 'workspace'
  formatModelRefText: (modelRef: any) => string
  openPluginSettings: (tab: any) => void
  onSelect: (roleId: string) => void
  onOpenEditor: (roleId: string) => void
  onMove: (activeId: string, overId: string) => void
}) {
  const {
    roles,
    scope,
    workspaceId,
    activeRoleId,
    activeTargetKind,
    formatModelRefText,
    openPluginSettings,
    onSelect,
    onOpenEditor,
    onMove,
  } = props

  if (scope === 'workspace' && !workspaceId) return <SidebarEmptyHint>先选择工作区。</SidebarEmptyHint>

  if (!roles.length) {
    const emptyTitle = scope === 'workspace' ? '当前工作区还没有注册角色。' : '还没有角色。'
    const actionLabel = scope === 'workspace' ? '去注册角色' : '去创建角色'
    const settingsTab = scope === 'workspace' ? 'workspaces' : 'roles'
    return (
      <Box sx={{ px: 1.5, py: 1 }}>
        <Typography variant="body2" color="text.secondary">
          {emptyTitle}
        </Typography>
        <Button size="small" variant="contained" sx={{ mt: 1 }} onClick={() => openPluginSettings(settingsTab)}>
          {actionLabel}
        </Button>
      </Box>
    )
  }

  const isSelected = (roleId: string) => {
    if (roleId !== activeRoleId) return false
    return activeTargetKind === (scope === 'workspace' ? 'workspace' : 'role')
  }

  return (
    <RoleList
      roles={roles}
      isSelected={isSelected}
      onSelect={onSelect}
      onOpenEditor={onOpenEditor}
      formatModelRefText={formatModelRefText}
      sortable={{ onMove }}
    />
  )
}
