import * as React from 'react'
import { Avatar, Box, Button, IconButton, List, ListItemAvatar, ListItemButton, ListItemText, Popover, Tab, Tabs, Tooltip, Typography } from '@mui/material'
import SettingsIcon from '@mui/icons-material/Settings'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { SOFT_POPOVER_ITEM_SX, SOFT_POPOVER_LIST_SX, SOFT_POPOVER_PAPER_SX } from '../softPopoverStyles'

export function RolePickerPopover(props: {
  controller: any
  rolePickerEl: HTMLElement | null
  closeRolePicker: () => void
  rolePickerMode: 'global' | 'workspaceRole'
  rolePickerTab: 'roles' | 'groups' | 'workspaces'
  setRolePickerTab: React.Dispatch<React.SetStateAction<'roles' | 'groups' | 'workspaces'>>
  roles: any[]
  groups: any[]
  workspaces: any[]
  draftActiveRoleId: string
  activeGroupId: string
  activeWorkspaceId: string
  activeTargetKind: 'role' | 'group' | 'workspace'
  formatModelRefText: (modelRef: any) => string
  openPluginSettings: (tab: any) => void
}) {
  const {
    controller,
    rolePickerEl,
    closeRolePicker,
    rolePickerMode,
    rolePickerTab,
    setRolePickerTab,
    roles,
    groups,
    workspaces,
    draftActiveRoleId,
    activeGroupId,
    activeWorkspaceId,
    activeTargetKind,
    formatModelRefText,
    openPluginSettings,
  } = props

  return (
    <Popover
      open={!!rolePickerEl}
      anchorEl={rolePickerEl}
      onClose={closeRolePicker}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      PaperProps={{ sx: SOFT_POPOVER_PAPER_SX }}
    >
      <CustomScrollArea hostSx={{ width: 380, maxHeight: '70vh' }} scrollSx={{ maxHeight: '70vh' }}>
        {rolePickerMode === 'global' ? (
          <Box sx={{ px: 1.5, pt: 1.25, pb: 0.5 }}>
            <Tabs
              value={rolePickerTab}
              onChange={(_e, v) => setRolePickerTab(v === 'groups' ? 'groups' : v === 'workspaces' ? 'workspaces' : 'roles')}
              variant="fullWidth"
            >
              <Tab value="roles" label="选择角色" />
              <Tab value="groups" label="群组" />
              <Tab value="workspaces" label="工作区" />
            </Tabs>
          </Box>
        ) : null}
        {rolePickerTab === 'roles' ? (
          <List dense sx={SOFT_POPOVER_LIST_SX}>
            {roles.map((r: any) => {
              const on = String(r?.id || '') === String(draftActiveRoleId || '')
              const modelRefText = formatModelRefText(r?.modelRef)
              const selected = rolePickerMode === 'workspaceRole' ? on && activeTargetKind === 'workspace' : on && activeTargetKind === 'role'
              return (
                <ListItemButton
                  key={String(r?.id || '')}
                  selected={selected}
                  onClick={() => {
                    if (rolePickerMode === 'workspaceRole' && activeTargetKind === 'workspace') controller.actions.setWorkspaceRole?.(String(r?.id || ''))
                    else controller.actions.setActiveRole(String(r?.id || ''))
                    closeRolePicker()
                  }}
                  sx={SOFT_POPOVER_ITEM_SX}
                >
                  <ListItemAvatar>
                    <Avatar src={String(r?.avatarImage || '') || undefined} sx={{ width: 28, height: 28, fontSize: 14 }}>
                      {String(r?.avatar || '🙂')}
                    </Avatar>
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
                        closeRolePicker()
                        controller.actions.openRoleEditor(String(r?.id || ''))
                      }}
                    >
                      <SettingsIcon fontSize="inherit" />
                    </IconButton>
                  </Tooltip>
                </ListItemButton>
              )
            })}
          </List>
        ) : rolePickerTab === 'groups' ? groups.length ? (
          <List dense sx={SOFT_POPOVER_LIST_SX}>
            {groups.map((g: any) => {
              const on = String(g?.id || '') === String(activeGroupId || '')
              return (
                <ListItemButton
                  key={String(g?.id || '')}
                  selected={on && activeTargetKind === 'group'}
                  onClick={() => {
                    controller.actions.setActiveGroup?.(String(g?.id || ''))
                    closeRolePicker()
                  }}
                  sx={SOFT_POPOVER_ITEM_SX}
                >
                  <ListItemAvatar>
                    <Avatar src={String(g?.avatarImage || '') || undefined} sx={{ width: 28, height: 28, fontSize: 14 }}>
                      {String(g?.avatar || '👥')}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    sx={{ minWidth: 0 }}
                    primary={
                      <Typography sx={{ fontWeight: 900, fontSize: 13 }} noWrap>
                        {String(g?.name || '')}
                      </Typography>
                    }
                    secondary={
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {Array.isArray(g?.memberRoleIds) ? `${g.memberRoleIds.length} 个成员` : '群聊'}
                      </Typography>
                    }
                  />
                  <Tooltip title="设置">
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        closeRolePicker()
                        controller.actions.openGroupEditor?.(String(g?.id || ''))
                      }}
                    >
                      <SettingsIcon fontSize="inherit" />
                    </IconButton>
                  </Tooltip>
                </ListItemButton>
              )
            })}
          </List>
        ) : (
          <Box sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              还没有群组。
            </Typography>
            <Button
              size="small"
              variant="contained"
              sx={{ mt: 1 }}
              onClick={() => {
                closeRolePicker()
                openPluginSettings('groups')
              }}
            >
              去创建群组
            </Button>
          </Box>
        ) : workspaces.length ? (
          <List dense sx={SOFT_POPOVER_LIST_SX}>
            {workspaces.map((workspace: any) => {
              const workspaceId = String(workspace?.id || '')
              const on = workspaceId === String(activeWorkspaceId || '')
              const directoryCount = Array.isArray(workspace?.directories) ? workspace.directories.length : 0
              return (
                <ListItemButton
                  key={workspaceId}
                  selected={on && activeTargetKind === 'workspace'}
                  onClick={() => {
                    controller.actions.setActiveWorkspace?.(workspaceId)
                    closeRolePicker()
                  }}
                  sx={SOFT_POPOVER_ITEM_SX}
                >
                  <ListItemAvatar>
                    <Avatar sx={{ width: 28, height: 28, fontSize: 14, bgcolor: 'rgba(59,130,246,.12)', color: 'primary.main' }}>
                      📁
                    </Avatar>
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
                        closeRolePicker()
                        controller.actions.openWorkspaceEditor?.(workspaceId)
                      }}
                    >
                      <SettingsIcon fontSize="inherit" />
                    </IconButton>
                  </Tooltip>
                </ListItemButton>
              )
            })}
          </List>
        ) : (
          <Box sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              还没有工作区。
            </Typography>
            <Button
              size="small"
              variant="contained"
              sx={{ mt: 1 }}
              onClick={() => {
                closeRolePicker()
                openPluginSettings('workspaces')
              }}
            >
              去创建工作区
            </Button>
          </Box>
        )}
      </CustomScrollArea>
    </Popover>
  )
}
