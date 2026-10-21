import * as React from 'react'
import { Box, Button, Typography } from '@mui/material'
import type { WorkspaceSidebarTab } from '../../../domain/sidebarNavigationMemory'
import { workspaceSidebarSessions } from '../../../domain/sidebarSessions'
import { workspaceRoleTargetId } from '../../../domain/workspaceRoleTarget'
import type { ChatSessionRunIndicatorKind } from '../ChatSessionRunIndicator'
import { WorkspaceList } from '../EntityLists'
import { SidebarSessionList } from '../SidebarSessionList'
import { SidebarRoleList } from './SidebarRoleList'
import { SidebarEmptyHint, SidebarSectionTitle } from './SidebarSection'

export function WorkspaceSidebarPanel(props: {
  tab: WorkspaceSidebarTab
  roles: any[]
  workspaces: any[]
  activeRoleId: string
  activeWorkspaceId: string
  activeTargetKind: 'role' | 'group' | 'workspace'
  activeChatId: string
  data: any
  pendingChat: any
  roleAvatarImage: string
  searchText: string
  formatModelRefText: (modelRef: any) => string
  openPluginSettings: (tab: any) => void
  fmtTime: (value: number) => string
  chatSessionRunIndicatorKind: (
    targetKind: 'role' | 'group' | 'workspace',
    targetId: string,
    chat: any,
    selected: boolean,
  ) => ChatSessionRunIndicatorKind | ''
  onSelectWorkspace: (workspaceId: string) => void
  onSelectWorkspaceRole: (roleId: string) => void
  onOpenWorkspaceEditor: (workspaceId: string) => void
  onOpenRoleEditor: (roleId: string) => void
  onMoveWorkspace: (activeId: string, overId: string) => void
  onMoveRole: (activeId: string, overId: string) => void
  onSelectSession: (chatId: string) => void
}) {
  const sessions = React.useMemo(
    () => workspaceSidebarSessions(props.data, props.activeWorkspaceId, props.activeRoleId),
    [props.data, props.activeWorkspaceId, props.activeRoleId],
  )

  if (props.tab === 'workspaces') {
    return (
      <>
        <SidebarSectionTitle>工作区</SidebarSectionTitle>
        {props.workspaces.length ? (
          <WorkspaceList
            workspaces={props.workspaces}
            isSelected={(id) => id === props.activeWorkspaceId && props.activeTargetKind === 'workspace'}
            onSelect={props.onSelectWorkspace}
            onOpenEditor={props.onOpenWorkspaceEditor}
            sortable={{ onMove: props.onMoveWorkspace }}
          />
        ) : (
          <Box sx={{ px: 1.5, py: 1 }}>
            <Typography variant="body2" color="text.secondary">
              还没有工作区。
            </Typography>
            <Button size="small" variant="contained" sx={{ mt: 1 }} onClick={() => props.openPluginSettings('workspaces')}>
              去创建工作区
            </Button>
          </Box>
        )}
      </>
    )
  }

  if (props.tab === 'roles') {
    return (
      <>
        <SidebarSectionTitle>角色</SidebarSectionTitle>
        <SidebarRoleList
          roles={props.roles}
          scope="workspace"
          workspaceId={props.activeWorkspaceId}
          activeRoleId={props.activeRoleId}
          activeTargetKind={props.activeTargetKind}
          formatModelRefText={props.formatModelRefText}
          openPluginSettings={props.openPluginSettings}
          onSelect={props.onSelectWorkspaceRole}
          onOpenEditor={props.onOpenRoleEditor}
          onMove={props.onMoveRole}
        />
      </>
    )
  }

  return (
    <>
      <SidebarSectionTitle>会话</SidebarSectionTitle>
      {!props.activeWorkspaceId ? (
        <SidebarEmptyHint>先选择工作区。</SidebarEmptyHint>
      ) : !props.activeRoleId ? (
        <SidebarEmptyHint>先选择角色。</SidebarEmptyHint>
      ) : (
        <SidebarSessionList
          sessions={sessions.sessions}
          pendingChat={props.pendingChat}
          pendingTitle="工作区会话"
          roleAvatarImage={props.roleAvatarImage}
          searchText={props.searchText}
          targetKind="workspace"
          targetId={workspaceRoleTargetId(props.activeWorkspaceId, props.activeRoleId)}
          activeChatId={props.activeChatId}
          fmtTime={props.fmtTime}
          onSelect={props.onSelectSession}
          chatSessionRunIndicatorKind={props.chatSessionRunIndicatorKind}
        />
      )}
    </>
  )
}
