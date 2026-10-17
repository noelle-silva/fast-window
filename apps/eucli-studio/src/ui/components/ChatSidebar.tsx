import * as React from 'react'
import { Box, Button, Tab, Tabs, Typography } from '@mui/material'
import { colorMixVar } from '../colorThemeStyles'
import { TOPBAR_H } from '../appConstants'
import { RoleList, WorkspaceList } from './EntityLists'
import { SidebarSessionList } from './SidebarSessionList'
import { getSidebarNavigationMemory } from '../../domain/sidebarNavigationMemory'
import { roleSidebarSessions, workspaceSidebarSessions } from '../../domain/sidebarSessions'
import { workspaceRoleTargetId } from '../../domain/workspaceRoleTarget'
import type { ChatSessionRunIndicatorKind } from './ChatSessionRunIndicator'

export function ChatSidebar(props: {
  controller: any
  side: 'left' | 'right'
  mode: 'role' | 'workspace'
  width: number
  sidebarRef: React.Ref<HTMLElement>
  resizing: boolean
  onSplitterPointerDown: (e: React.PointerEvent) => void
  topbarOpacity: number
  topbarBlur: number
  roles: any[]
  workspaces: any[]
  activeRoleId: string
  activeWorkspaceId: string
  activeTargetKind: 'role' | 'group' | 'workspace'
  activeChatId: string
  data: any
  pendingRoleChat: any
  pendingWorkspaceChat: any
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
  onSelectWorkspace: (workspaceId: string) => void
  onSelectWorkspaceRole: (roleId: string) => void
  onSelectSession: (chatId: string) => void
  onTabChange: (mode: 'role' | 'workspace', tab: string) => void
}) {
  const {
    controller,
    side,
    mode,
    width,
    sidebarRef,
    resizing,
    onSplitterPointerDown,
    topbarOpacity,
    topbarBlur,
    roles,
    workspaces,
    activeRoleId,
    activeWorkspaceId,
    activeTargetKind,
    activeChatId,
    data,
    pendingRoleChat,
    pendingWorkspaceChat,
    formatModelRefText,
    openPluginSettings,
    fmtTime,
    chatSessionRunIndicatorKind,
    onSelectRole,
    onSelectWorkspace,
    onSelectWorkspaceRole,
    onSelectSession,
    onTabChange,
  } = props

  const memory = getSidebarNavigationMemory()
  const activeTab = mode === 'role' ? memory.role.tab : memory.workspace.tab
  const roleSessions = React.useMemo(() => roleSidebarSessions(data, activeRoleId), [data, activeRoleId])
  const workspaceSessions = React.useMemo(
    () => workspaceSidebarSessions(data, activeWorkspaceId, activeRoleId),
    [data, activeWorkspaceId, activeRoleId],
  )
  const rolePendingChat =
    pendingRoleChat && String(pendingRoleChat?.roleId || '') === activeRoleId
      ? pendingRoleChat.chat
      : null
  const workspacePendingChat =
    pendingWorkspaceChat &&
    workspaceRoleTargetId(pendingWorkspaceChat?.workspaceId, pendingWorkspaceChat?.roleId) ===
      workspaceRoleTargetId(activeWorkspaceId, activeRoleId)
      ? pendingWorkspaceChat.chat
      : null

  const sectionTitle = (text: string) => (
    <Typography variant="caption" sx={{ fontWeight: 900, px: 1.5, color: 'text.secondary' }}>
      {text}
    </Typography>
  )

  const emptyHint = (text: string) => (
    <Box sx={{ px: 1.5, py: 1 }}>
      <Typography variant="body2" color="text.secondary">
        {text}
      </Typography>
    </Box>
  )

  const roleList = (isSelected: (roleId: string) => boolean, onSelect: (roleId: string) => void) => (
    roles.length ? (
      <RoleList
        roles={roles}
        isSelected={isSelected}
        onSelect={onSelect}
        onOpenEditor={(id) => controller.actions.openRoleEditor?.(id)}
        formatModelRefText={formatModelRefText}
      />
    ) : (
      <Box sx={{ px: 1.5, py: 1 }}>
        <Typography variant="body2" color="text.secondary">
          还没有角色。
        </Typography>
        <Button size="small" variant="contained" sx={{ mt: 1 }} onClick={() => openPluginSettings('roles')}>
          去创建角色
        </Button>
      </Box>
    )
  )

  const workspaceList = () => (
    workspaces.length ? (
      <WorkspaceList
        workspaces={workspaces}
        isSelected={(id) => id === activeWorkspaceId && activeTargetKind === 'workspace'}
        onSelect={onSelectWorkspace}
        onOpenEditor={(id) => controller.actions.openWorkspaceEditor?.(id)}
      />
    ) : (
      <Box sx={{ px: 1.5, py: 1 }}>
        <Typography variant="body2" color="text.secondary">
          还没有工作区。
        </Typography>
        <Button size="small" variant="contained" sx={{ mt: 1 }} onClick={() => openPluginSettings('workspaces')}>
          去创建工作区
        </Button>
      </Box>
    )
  )

  const tabs = mode === 'role'
    ? [{ value: 'roles', label: '角色' }, { value: 'history', label: '历史会话' }]
    : [{ value: 'workspaces', label: '工作区' }, { value: 'roles', label: '角色' }, { value: 'session', label: '会话' }]

  return (
    <Box
      component="nav"
      aria-label="侧边栏"
      ref={sidebarRef}
      sx={{
        position: 'relative',
        width,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        pt: `${TOPBAR_H}px`,
        bgcolor: colorMixVar('--studio-topbar', topbarOpacity),
        backdropFilter: topbarBlur > 0 ? `blur(${topbarBlur}px)` : 'none',
        WebkitBackdropFilter: topbarBlur > 0 ? `blur(${topbarBlur}px)` : 'none',
      }}
    >
      <Box
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧边栏宽度"
        onPointerDown={onSplitterPointerDown}
        sx={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          width: 6,
          zIndex: 2,
          cursor: 'col-resize',
          ...(side === 'left' ? { right: 0 } : { left: 0 }),
          bgcolor: resizing ? 'primary.main' : 'transparent',
          transition: 'background-color 120ms ease',
          transitionDelay: '0ms',
          '&:hover': { bgcolor: 'primary.main', transitionDelay: '150ms' },
        }}
      />

      <Tabs
        value={activeTab}
        onChange={(_, next) => onTabChange(mode, String(next))}
        variant="fullWidth"
        sx={{ minHeight: 34, flexShrink: 0, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        {tabs.map((item) => (
          <Tab
            key={item.value}
            value={item.value}
            label={item.label}
            sx={{ minWidth: 0, minHeight: 34, px: 0.5, fontSize: 12, fontWeight: 900 }}
          />
        ))}
      </Tabs>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', py: 1 }}>
        {mode === 'role' ? (
          activeTab === 'history' ? (
            <>
              {sectionTitle('历史会话')}
              {activeTargetKind === 'role' ? (
                <SidebarSessionList
                  sessions={roleSessions.sessions}
                  pendingChat={rolePendingChat}
                  pendingTitle="新聊天"
                  targetKind="role"
                  targetId={activeRoleId}
                  activeChatId={activeChatId}
                  fmtTime={fmtTime}
                  onSelect={onSelectSession}
                  chatSessionRunIndicatorKind={chatSessionRunIndicatorKind}
                />
              ) : (
                emptyHint('先选择角色。')
              )}
            </>
          ) : (
            <>
              {sectionTitle('角色')}
              {roleList(
                (id) => id === activeRoleId && activeTargetKind === 'role',
                onSelectRole,
              )}
            </>
          )
        ) : activeTab === 'workspaces' ? (
          <>
            {sectionTitle('工作区')}
            {workspaceList()}
          </>
        ) : activeTab === 'roles' ? (
          <>
            {sectionTitle('角色')}
            {roleList(
              (id) => id === activeRoleId && activeTargetKind === 'workspace',
              onSelectWorkspaceRole,
            )}
          </>
        ) : (
          <>
            {sectionTitle('会话')}
            {activeTargetKind === 'workspace' ? (
              <SidebarSessionList
                sessions={workspaceSessions.sessions}
                pendingChat={workspacePendingChat}
                pendingTitle="工作区会话"
                targetKind="workspace"
                targetId={workspaceRoleTargetId(activeWorkspaceId, activeRoleId)}
                activeChatId={activeChatId}
                fmtTime={fmtTime}
                onSelect={onSelectSession}
                chatSessionRunIndicatorKind={chatSessionRunIndicatorKind}
              />
            ) : (
              emptyHint('先选择工作区。')
            )}
          </>
        )}
      </Box>
    </Box>
  )
}
