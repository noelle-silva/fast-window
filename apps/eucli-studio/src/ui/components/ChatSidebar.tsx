import * as React from 'react'
import { Box, IconButton, InputAdornment, Tab, Tabs, TextField, Tooltip } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import SearchIcon from '@mui/icons-material/Search'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import { colorMixVar } from '../colorThemeStyles'
import { TOPBAR_H } from '../appConstants'
import {
  getSidebarNavigationMemory,
  type RoleSidebarTab,
  type WorkspaceSidebarTab,
} from '../../domain/sidebarNavigationMemory'
import type { SidebarView } from '../../domain/sidebarView'
import { workspaceRoleTargetId } from '../../domain/workspaceRoleTarget'
import { useUiDataVersion } from '../hooks/useScopedUiVersion'
import type { ChatSessionRunIndicatorKind } from './ChatSessionRunIndicator'
import { RoleSidebarPanel } from './sidebar/RoleSidebarPanel'
import { WorkspaceSidebarPanel } from './sidebar/WorkspaceSidebarPanel'

// 侧边栏外壳：位置、宽度、视图切换、页签与搜索。
// 角色 / 工作区两个面板只负责各自的内容，不再各自维护一套外壳。
export function ChatSidebar(props: {
  controller: any
  side: 'left' | 'right'
  view: SidebarView
  onToggleView: () => void
  width: number
  sidebarRef: React.Ref<HTMLElement>
  resizing: boolean
  onSplitterPointerDown: (e: React.PointerEvent) => void
  topbarOpacity: number
  topbarBlur: number
  roles: any[]
  workspaceRoles: any[]
  workspaces: any[]
  activeRoleId: string
  activeRoleAvatarImage: string
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
  onMoveRole: (activeId: string, overId: string) => void
  onMoveWorkspace: (activeId: string, overId: string) => void
  onSelectSession: (chatId: string) => void
  onChatContextMenu: (
    event: React.MouseEvent,
    targetKind: 'role' | 'workspace',
    targetId: string,
    chatId: string,
    title: string,
  ) => void
  onTabChange: (view: SidebarView, tab: string) => void
}) {
  const {
    controller,
    side,
    view,
    onToggleView,
    width,
    sidebarRef,
    resizing,
    onSplitterPointerDown,
    topbarOpacity,
    topbarBlur,
    roles,
    workspaceRoles,
    workspaces,
    activeRoleId,
    activeRoleAvatarImage,
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
    onMoveRole,
    onMoveWorkspace,
    onSelectSession,
    onChatContextMenu,
    onTabChange,
  } = props

  const dataVersion = useUiDataVersion(controller)
  const memory = getSidebarNavigationMemory()
  const activeTab: RoleSidebarTab | WorkspaceSidebarTab = view === 'role' ? memory.role.tab : memory.workspace.tab

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

  const [sessionSearchText, setSessionSearchText] = React.useState('')
  React.useEffect(() => {
    setSessionSearchText('')
  }, [view, activeRoleId, activeWorkspaceId])

  const showSessionSearch = view === 'role' ? activeTab === 'history' : activeTab === 'session'
  const tabs = view === 'role'
    ? [{ value: 'roles', label: '角色' }, { value: 'history', label: '历史会话' }]
    : [{ value: 'workspaces', label: '工作区' }, { value: 'roles', label: '角色' }, { value: 'session', label: '会话' }]
  const toggleLabel = view === 'role' ? '切换到工作区面板' : '切换到角色面板'

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

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Tooltip title={toggleLabel}>
          <IconButton size="small" aria-label={toggleLabel} onClick={onToggleView} sx={{ mx: 0.25, flexShrink: 0 }}>
            <SwapHorizIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tabs
          value={activeTab}
          onChange={(_, next) => onTabChange(view, String(next))}
          variant="fullWidth"
          sx={{ minHeight: 34, flex: 1, minWidth: 0 }}
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
      </Box>

      {showSessionSearch ? (
        <Box sx={{ flexShrink: 0, px: 1.5, pt: 1, pb: 0.5 }}>
          <TextField
            fullWidth
            size="small"
            variant="standard"
            placeholder="搜索会话…"
            value={sessionSearchText}
            onChange={(event) => setSessionSearchText(event.target.value)}
            InputProps={{
              disableUnderline: true,
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: sessionSearchText ? (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    edge="end"
                    aria-label="清空搜索"
                    onClick={() => setSessionSearchText('')}
                  >
                    <CloseIcon fontSize="inherit" />
                  </IconButton>
                </InputAdornment>
              ) : null,
            }}
          />
        </Box>
      ) : null}

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {view === 'role' ? (
          <RoleSidebarPanel
            tab={memory.role.tab}
            dataVersion={dataVersion}
            roles={roles}
            activeRoleId={activeRoleId}
            activeTargetKind={activeTargetKind}
            activeChatId={activeChatId}
            data={data}
            pendingChat={rolePendingChat}
            roleAvatarImage={activeRoleAvatarImage}
            searchText={sessionSearchText}
            formatModelRefText={formatModelRefText}
            openPluginSettings={openPluginSettings}
            fmtTime={fmtTime}
            chatSessionRunIndicatorKind={chatSessionRunIndicatorKind}
            onSelectRole={onSelectRole}
            onOpenRoleEditor={(roleId) => controller.actions.openRoleEditor?.(roleId)}
            onMoveRole={onMoveRole}
            onSelectSession={onSelectSession}
            onChatContextMenu={onChatContextMenu}
          />
        ) : (
          <WorkspaceSidebarPanel
            tab={memory.workspace.tab}
            dataVersion={dataVersion}
            roles={workspaceRoles}
            workspaces={workspaces}
            activeRoleId={activeRoleId}
            activeWorkspaceId={activeWorkspaceId}
            activeTargetKind={activeTargetKind}
            activeChatId={activeChatId}
            data={data}
            pendingChat={workspacePendingChat}
            roleAvatarImage={activeRoleAvatarImage}
            searchText={sessionSearchText}
            formatModelRefText={formatModelRefText}
            openPluginSettings={openPluginSettings}
            fmtTime={fmtTime}
            chatSessionRunIndicatorKind={chatSessionRunIndicatorKind}
            onSelectWorkspace={onSelectWorkspace}
            onSelectWorkspaceRole={onSelectWorkspaceRole}
            onOpenWorkspaceEditor={(workspaceId) => controller.actions.openWorkspaceEditor?.(workspaceId)}
            onOpenRoleEditor={(roleId) => controller.actions.openRoleEditor?.(roleId)}
            onMoveWorkspace={onMoveWorkspace}
            onMoveRole={onMoveRole}
            onSelectSession={onSelectSession}
            onChatContextMenu={onChatContextMenu}
          />
        )}
      </Box>
    </Box>
  )
}
