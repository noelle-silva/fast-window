import * as React from 'react'
import type { RoleSidebarTab } from '../../../domain/sidebarNavigationMemory'
import { roleSidebarSessions } from '../../../domain/sidebarSessions'
import type { ChatSessionRunIndicatorKind } from '../ChatSessionRunIndicator'
import { SidebarSessionList, type SidebarSessionTargetKind } from '../SidebarSessionList'
import { SidebarRoleList } from './SidebarRoleList'
import { SidebarScrollArea } from './SidebarScrollArea'
import { SidebarEmptyHint, SidebarSectionTitle } from './SidebarSection'

export function RoleSidebarPanel(props: {
  tab: RoleSidebarTab
  dataVersion: number
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
  onChatContextMenu: (
    event: React.MouseEvent,
    targetKind: SidebarSessionTargetKind,
    targetId: string,
    chatId: string,
    title: string,
  ) => void
}) {
  const sessions = React.useMemo(
    () => roleSidebarSessions(props.data, props.activeRoleId),
    [props.dataVersion, props.data, props.activeRoleId],
  )

  if (props.tab === 'history') {
    if (!props.activeRoleId) {
      return (
        <SidebarScrollArea>
          <SidebarSectionTitle>历史会话</SidebarSectionTitle>
          <SidebarEmptyHint>先选择角色。</SidebarEmptyHint>
        </SidebarScrollArea>
      )
    }
    return (
      <SidebarSessionList
        title="历史会话"
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
        onContextMenu={props.onChatContextMenu}
        chatSessionRunIndicatorKind={props.chatSessionRunIndicatorKind}
      />
    )
  }

  return (
    <SidebarScrollArea>
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
    </SidebarScrollArea>
  )
}
