import * as React from 'react'
import type { RoleSidebarTab } from '../../../domain/sidebarNavigationMemory'
import { roleSidebarSessions } from '../../../domain/sidebarSessions'
import type { ChatSessionRunIndicatorKind } from '../ChatSessionRunIndicator'
import { SidebarSessionList } from '../SidebarSessionList'
import { SidebarRoleList } from './SidebarRoleList'
import { SidebarEmptyHint, SidebarSectionTitle } from './SidebarSection'

export function RoleSidebarPanel(props: {
  tab: RoleSidebarTab
  roles: any[]
  activeRoleId: string
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
  onSelectRole: (roleId: string) => void
  onOpenRoleEditor: (roleId: string) => void
  onMoveRole: (activeId: string, overId: string) => void
  onSelectSession: (chatId: string) => void
}) {
  const sessions = React.useMemo(
    () => roleSidebarSessions(props.data, props.activeRoleId),
    [props.data, props.activeRoleId],
  )

  if (props.tab === 'history') {
    return (
      <>
        <SidebarSectionTitle>历史会话</SidebarSectionTitle>
        {props.activeRoleId ? (
          <SidebarSessionList
            sessions={sessions.sessions}
            pendingChat={props.pendingChat}
            pendingTitle="新聊天"
            roleAvatarImage={props.roleAvatarImage}
            searchText={props.searchText}
            targetKind="role"
            targetId={props.activeRoleId}
            activeChatId={props.activeChatId}
            fmtTime={props.fmtTime}
            onSelect={props.onSelectSession}
            chatSessionRunIndicatorKind={props.chatSessionRunIndicatorKind}
          />
        ) : (
          <SidebarEmptyHint>先选择角色。</SidebarEmptyHint>
        )}
      </>
    )
  }

  return (
    <>
      <SidebarSectionTitle>角色</SidebarSectionTitle>
      <SidebarRoleList
        roles={props.roles}
        scope="role"
        workspaceId=""
        activeRoleId={props.activeRoleId}
        activeTargetKind={props.activeTargetKind}
        formatModelRefText={props.formatModelRefText}
        openPluginSettings={props.openPluginSettings}
        onSelect={props.onSelectRole}
        onOpenEditor={props.onOpenRoleEditor}
        onMove={props.onMoveRole}
      />
    </>
  )
}
