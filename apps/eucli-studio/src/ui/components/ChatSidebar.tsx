import * as React from 'react'
import { Box, IconButton, InputAdornment, TextField, Tooltip } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import SearchIcon from '@mui/icons-material/Search'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import {
  getSidebarNavigationMemory,
  type RoleSidebarTab,
  type WorkspaceSidebarTab,
} from '../../domain/sidebarNavigationMemory'
import type { SidebarView } from '../../domain/sidebarView'
import type { SidebarTabsVariant } from '../../domain/sidebarTabs'
import { refreshScopes } from '../../domain/uiRefreshScope'
import { workspaceRoleTargetId } from '../../domain/workspaceRoleTarget'
import { useScopedUiVersion } from '../hooks/useScopedUiVersion'
import type { ChatSessionRunIndicatorKind } from './ChatSessionRunIndicator'
import { SidebarFrame } from './SidebarFrame'
import { SidebarTabsHeader, type SidebarTabItem } from './SidebarTabsHeader'
import { RoleSidebarPanel } from './sidebar/RoleSidebarPanel'
import { WorkspaceSidebarPanel } from './sidebar/WorkspaceSidebarPanel'

// 侧边栏 A：原有的角色 / 工作区侧边栏。
// 外壳（位置、宽度、拖拽把手）交给 SidebarFrame，这里只负责 A 的头部页签与两个面板。
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
  tabsVariant: SidebarTabsVariant
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
  /** Ctrl / Cmd 点会话：直接放进工作桌面，不切换当前会话。 */
  onAddSessionToDesk?: (targetKind: 'role' | 'workspace', targetId: string, chatId: string) => void
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
    tabsVariant,
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
    onAddSessionToDesk,
    onChatContextMenu,
    onTabChange,
  } = props

  // 列表 / 运行卡 / 导航各自建立范围订阅：数据变化由 App 的实体订阅驱动 props，
  // 这里只负责列表与运行指示的细粒度刷新，不再保留全局兜底。
  const chatListTargetId =
    activeTargetKind === 'workspace'
      ? workspaceRoleTargetId(activeWorkspaceId, activeRoleId)
      : activeTargetKind === 'group'
        ? String((data as any)?.ui?.activeGroupId || '').trim()
        : String(activeRoleId || '').trim()
  const chatListVersion = useScopedUiVersion(
    controller,
    refreshScopes.chatList(activeTargetKind, chatListTargetId),
    !!chatListTargetId,
  )
  const runCardsVersion = useScopedUiVersion(controller, refreshScopes.runCards())
  const navigationVersion = useScopedUiVersion(controller, refreshScopes.navigation())
  const refreshVersion = `${chatListVersion}:${runCardsVersion}:${navigationVersion}`
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
  const tabs: SidebarTabItem<RoleSidebarTab | WorkspaceSidebarTab>[] =
    view === 'role'
      ? [{ value: 'roles', label: '角色' }, { value: 'history', label: '历史会话' }]
      : [{ value: 'workspaces', label: '工作区' }, { value: 'roles', label: '角色' }, { value: 'session', label: '会话' }]
  const toggleLabel = view === 'role' ? '切换到工作区面板' : '切换到角色面板'

  const header = (
    <SidebarTabsHeader
      ariaLabel="侧边栏 A 页签"
      tabs={tabs}
      value={activeTab}
      onChange={(tab) => onTabChange(view, tab)}
      variant={tabsVariant}
      leading={
        <Tooltip title={toggleLabel}>
          <IconButton size="small" aria-label={toggleLabel} onClick={onToggleView} sx={{ mx: 0.25, flexShrink: 0 }}>
            <SwapHorizIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      }
    />
  )

  return (
    <SidebarFrame
      sidebarId="a"
      ariaLabel="侧边栏 A"
      side={side}
      width={width}
      sidebarRef={sidebarRef}
      resizing={resizing}
      onSplitterPointerDown={onSplitterPointerDown}
      topbarOpacity={topbarOpacity}
      topbarBlur={topbarBlur}
      header={header}
    >
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
            refreshVersion={refreshVersion}
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
            onAddSessionToDesk={onAddSessionToDesk}
            onChatContextMenu={onChatContextMenu}
          />
        ) : (
          <WorkspaceSidebarPanel
            tab={memory.workspace.tab}
            refreshVersion={refreshVersion}
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
            onAddSessionToDesk={onAddSessionToDesk}
            onChatContextMenu={onChatContextMenu}
          />
        )}
      </Box>
    </SidebarFrame>
  )
}
