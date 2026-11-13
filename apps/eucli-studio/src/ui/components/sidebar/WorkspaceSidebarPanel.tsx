import * as React from 'react'
import type { WorkspaceSidebarTab } from '../../../domain/sidebarNavigationMemory'
import { workspaceSidebarSessions } from '../../../domain/sidebarSessions'
import { workspaceRoleTargetId } from '../../../domain/workspaceRoleTarget'
import type { ChatSessionRunIndicatorKind } from '../ChatSessionRunIndicator'
import { SidebarSessionList, type SidebarSessionTargetKind } from '../SidebarSessionList'
import { SidebarRoleList } from './SidebarRoleList'
import { SidebarWorkspaceList } from './SidebarWorkspaceList'
import { SidebarScrollArea } from './SidebarScrollArea'
import { SidebarEmptyHint } from './SidebarSection'

// 工作区视图：三个页签的分组标题全部退役，顶上那个搜索框就是清单的头；
// 面板只把数据与回调交给列表模块，列表自己管过滤与空态。
export function WorkspaceSidebarPanel(props: {
  tab: WorkspaceSidebarTab
  refreshVersion: string
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
  onAddSessionToDesk?: (targetKind: SidebarSessionTargetKind, targetId: string, chatId: string) => void
  onChatContextMenu: (
    event: React.MouseEvent,
    targetKind: SidebarSessionTargetKind,
    targetId: string,
    chatId: string,
    title: string,
  ) => void
}) {
  const sessions = React.useMemo(
    () => workspaceSidebarSessions(props.data, props.activeWorkspaceId, props.activeRoleId),
    [props.refreshVersion, props.data, props.activeWorkspaceId, props.activeRoleId],
  )

  if (props.tab === 'workspaces') {
    return (
      <SidebarScrollArea>
        <SidebarWorkspaceList
          workspaces={props.workspaces}
          searchText={props.searchText}
          activeWorkspaceId={props.activeWorkspaceId}
          activeTargetKind={props.activeTargetKind}
          openPluginSettings={props.openPluginSettings}
          onSelect={props.onSelectWorkspace}
          onOpenEditor={props.onOpenWorkspaceEditor}
          onMove={props.onMoveWorkspace}
        />
      </SidebarScrollArea>
    )
  }

  if (props.tab === 'roles') {
    return (
      <SidebarScrollArea>
        <SidebarRoleList
          roles={props.roles}
          scope="workspace"
          workspaceId={props.activeWorkspaceId}
          searchText={props.searchText}
          activeRoleId={props.activeRoleId}
          activeTargetKind={props.activeTargetKind}
          formatModelRefText={props.formatModelRefText}
          openPluginSettings={props.openPluginSettings}
          onSelect={props.onSelectWorkspaceRole}
          onOpenEditor={props.onOpenRoleEditor}
          onMove={props.onMoveRole}
        />
      </SidebarScrollArea>
    )
  }

  if (!props.activeWorkspaceId || !props.activeRoleId) {
    return (
      <SidebarScrollArea>
        <SidebarEmptyHint>
          {!props.activeWorkspaceId ? '先选择工作区。' : '先选择角色。'}
        </SidebarEmptyHint>
      </SidebarScrollArea>
    )
  }

  return (
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
      onAddToDesk={props.onAddSessionToDesk}
      onContextMenu={props.onChatContextMenu}
      chatSessionRunIndicatorKind={props.chatSessionRunIndicatorKind}
    />
  )
}
