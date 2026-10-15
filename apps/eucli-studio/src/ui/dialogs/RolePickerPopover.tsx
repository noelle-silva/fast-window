import * as React from 'react'
import { Box, Button, IconButton, List, ListItemAvatar, ListItemButton, ListItemText, Tooltip, Typography } from '@mui/material'
import { DependablePopover } from '../components/DependableOverlay'
import SettingsIcon from '@mui/icons-material/Settings'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { EntityAvatar } from '../components/avatar/EntityAvatar'
import { SOFT_POPOVER_ITEM_SX, SOFT_POPOVER_LIST_SX, SOFT_POPOVER_PAPER_SX } from '../softPopoverStyles'
import { useUiDataVersion } from '../hooks/useScopedUiVersion'

// 选择器一次只服务一个目标，不再用页签在「角色 / 工作区」之间切换：
// - 'role'：角色按钮（角色模式）打开，选中写进当前角色。
// - 'workspace'：工作区按钮（工作区模式）打开，选中写进当前工作区。
// - 'workspaceRole'：工作区模式下的角色按钮打开，选中写进工作区角色。
export type RolePickerView = 'role' | 'workspace' | 'workspaceRole'

// 独立刷新：用 memo 隔离，只有自身输入变化时才重绘，不被无关整页刷新牵连。
export const RolePickerPopover = React.memo(function RolePickerPopover(props: {
  controller: any
  rolePickerEl: HTMLElement | null
  closeRolePicker: () => void
  rolePickerView: RolePickerView
  roles: any[]
  workspaces: any[]
  draftActiveRoleId: string
  activeWorkspaceId: string
  activeTargetKind: 'role' | 'group' | 'workspace'
  formatModelRefText: (modelRef: any) => string
  openPluginSettings: (tab: any) => void
}) {
  const {
    controller,
    rolePickerEl,
    closeRolePicker,
    rolePickerView,
    roles,
    workspaces,
    draftActiveRoleId,
    activeWorkspaceId,
    activeTargetKind,
    formatModelRefText,
    openPluginSettings,
  } = props

  // 订阅全局数据版本：数据变化时本组件仍刷新；父级本地 UI 变化被 memo 挡在外面。
  useUiDataVersion(controller)

  const showWorkspaces = rolePickerView === 'workspace'

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
        {showWorkspaces ? (
          workspaces.length ? (
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
          )
        ) : (
          <List dense sx={SOFT_POPOVER_LIST_SX}>
            {roles.map((r: any) => {
              const on = String(r?.id || '') === String(draftActiveRoleId || '')
              const modelRefText = formatModelRefText(r?.modelRef)
              const selected = rolePickerView === 'workspaceRole' ? on && activeTargetKind === 'workspace' : on && activeTargetKind === 'role'
              return (
                <ListItemButton
                  key={String(r?.id || '')}
                  selected={selected}
                  onClick={() => {
                    if (rolePickerView === 'workspaceRole' && activeTargetKind === 'workspace') controller.actions.setWorkspaceRole?.(String(r?.id || ''))
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
        )}
      </CustomScrollArea>
    </DependablePopover>
  )
})
