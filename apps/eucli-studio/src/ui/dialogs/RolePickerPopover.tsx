import * as React from 'react'
import { Box, Button, Typography } from '@mui/material'
import { DependablePopover } from '../components/DependableOverlay'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { RoleList, WorkspaceList } from '../components/EntityLists'
import { SOFT_POPOVER_PAPER_SX } from '../softPopoverStyles'
import { refreshScopes } from '../../domain/uiRefreshScope'
import { useScopedUiVersions } from '../hooks/useScopedUiVersion'

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
  workspaceRoles: any[]
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
    workspaceRoles,
    workspaces,
    draftActiveRoleId,
    activeWorkspaceId,
    activeTargetKind,
    formatModelRefText,
    openPluginSettings,
  } = props

  // 角色 / 工作区选择器打开时才订阅各自的实体域；供应商与模型组
  // 只用于模型标识展示，同样按实体地址刷新。关闭时不订阅。
  useScopedUiVersions(
    controller,
    [
      refreshScopes.entities('roles'),
      refreshScopes.entities('workspaces'),
      refreshScopes.entities('providers'),
      refreshScopes.entities('modelGroups'),
    ],
    !!rolePickerEl,
  )

  const showWorkspaces = rolePickerView === 'workspace'
  const pickerRoles = rolePickerView === 'workspaceRole' ? workspaceRoles : roles
  const showWorkspaceRoleEmpty = rolePickerView === 'workspaceRole' && !pickerRoles.length

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
            <WorkspaceList
              workspaces={workspaces}
              isSelected={(id) => id === String(activeWorkspaceId || '') && activeTargetKind === 'workspace'}
              onSelect={(id) => {
                controller.actions.setActiveWorkspace?.(id)
                closeRolePicker()
              }}
              onOpenEditor={(id) => {
                closeRolePicker()
                controller.actions.openWorkspaceEditor?.(id)
              }}
            />
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
        ) : showWorkspaceRoleEmpty ? (
          <Box sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {activeWorkspaceId ? '当前工作区还没有注册角色。' : '请先选择工作区。'}
            </Typography>
            {activeWorkspaceId ? (
              <Button
                size="small"
                variant="contained"
                sx={{ mt: 1 }}
                onClick={() => {
                  closeRolePicker()
                  openPluginSettings('workspaces')
                }}
              >
                去注册角色
              </Button>
            ) : null}
          </Box>
        ) : (
          <RoleList
            roles={pickerRoles}
            isSelected={(id) => {
              if (id !== String(draftActiveRoleId || '')) return false
              return rolePickerView === 'workspaceRole' ? activeTargetKind === 'workspace' : activeTargetKind === 'role'
            }}
            onSelect={(id) => {
              if (rolePickerView === 'workspaceRole' && activeTargetKind === 'workspace') controller.actions.setWorkspaceRole?.(id)
              else controller.actions.setActiveRole(id)
              closeRolePicker()
            }}
            onOpenEditor={(id) => {
              closeRolePicker()
              controller.actions.openRoleEditor(id)
            }}
            formatModelRefText={formatModelRefText}
          />
        )}
      </CustomScrollArea>
    </DependablePopover>
  )
})
