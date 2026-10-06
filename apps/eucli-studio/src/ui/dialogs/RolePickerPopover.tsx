import * as React from 'react'
import { Box, Button, IconButton, List, ListItemAvatar, ListItemButton, ListItemText, Tab, Tabs, Tooltip, Typography } from '@mui/material'
import { DependablePopover } from '../components/DependableOverlay'
import SettingsIcon from '@mui/icons-material/Settings'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { EntityAvatar } from '../components/avatar/EntityAvatar'
import { SOFT_POPOVER_ITEM_SX, SOFT_POPOVER_LIST_SX, SOFT_POPOVER_PAPER_SX } from '../softPopoverStyles'
import { useUiDataVersion } from '../hooks/useScopedUiVersion'
import { GROUP_ENTRY_VISIBLE } from '../appConstants'

type RolePickerTab = 'roles' | 'groups' | 'workspaces'

// 选择器页签的唯一来源：群组页签的可见性由总开关决定。
// 页签的显示与当前页签的回落都从这份清单派生，开关只在这一处被判断。
const ROLE_PICKER_TABS: Array<{ value: RolePickerTab; label: string; visible: boolean }> = [
  { value: 'roles', label: '选择角色', visible: true },
  { value: 'groups', label: '群组', visible: GROUP_ENTRY_VISIBLE },
  { value: 'workspaces', label: '工作区', visible: true },
]
const VISIBLE_ROLE_PICKER_TABS = ROLE_PICKER_TABS.filter((tab) => tab.visible)

// 独立刷新：用 memo 隔离，只有自身输入变化时才重绘，不被无关整页刷新牵连。
export const RolePickerPopover = React.memo(function RolePickerPopover(props: {
  controller: any
  rolePickerEl: HTMLElement | null
  closeRolePicker: () => void
  rolePickerMode: 'global' | 'workspaceRole'
  rolePickerTab: RolePickerTab
  setRolePickerTab: React.Dispatch<React.SetStateAction<RolePickerTab>>
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

  // 订阅全局数据版本：数据变化时本组件仍刷新；父级本地 UI 变化被 memo 挡在外面。
  useUiDataVersion(controller)

  // 当前页签若落在被藏页签上，自动回落到第一个可见页签。
  const activeTab = VISIBLE_ROLE_PICKER_TABS.some((tab) => tab.value === rolePickerTab)
    ? rolePickerTab
    : VISIBLE_ROLE_PICKER_TABS[0].value

  return (
    <DependablePopover
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
              value={activeTab}
              onChange={(_e, v) => setRolePickerTab(v)}
              variant="fullWidth"
            >
              {VISIBLE_ROLE_PICKER_TABS.map((tab) => (
                <Tab key={tab.value} value={tab.value} label={tab.label} />
              ))}
            </Tabs>
          </Box>
        ) : null}
        {activeTab === 'roles' ? (
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
                    <EntityAvatar kind="role" image={String(r?.avatarImage || '')} size={28} />
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
        ) : activeTab === 'groups' ? groups.length ? (
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
                    <EntityAvatar kind="group" image={String(g?.avatarImage || '')} size={28} />
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
    </DependablePopover>
  )
})
