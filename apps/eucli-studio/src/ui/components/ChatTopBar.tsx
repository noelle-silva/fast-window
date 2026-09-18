import * as React from 'react'
import { AppBar, Avatar, Box, Button, IconButton, Toolbar, Tooltip, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import HistoryIcon from '@mui/icons-material/History'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import SettingsIcon from '@mui/icons-material/Settings'
import { colorMixVar } from '../colorThemeStyles'

export function ChatTopBar(props: {
  page: 'chat' | 'settings'
  loading: boolean
  roles: any[]
  groups: any[]
  workspaces: any[]
  activeTargetKind: 'role' | 'group' | 'workspace'
  activeGroup: any
  activeRole: any
  activeWorkspace: any
  topbarOpacity: number
  topbarBlur: number
  treeOpen: boolean
  chatNav: { olderId: any; newerId: any; lockedReason: any }
  standaloneWindowControls: React.ReactNode
  onTopbarPointerDown: (e: React.PointerEvent) => void
  onCloseSettings: () => void
  onToggleTree: () => void
  onOpenRolePicker: (e: React.MouseEvent<HTMLElement>) => void
  onOpenWorkspaceRolePicker: (e: React.MouseEvent<HTMLElement>) => void
  onOpenChatPicker: (e: React.MouseEvent<HTMLElement>) => void
  onCreateChat: () => void
  onOpenSettings: (tab: any) => void
  onSwitchChat: (chatId: any) => void
}) {
  const {
    page,
    loading,
    roles,
    groups,
    workspaces,
    activeTargetKind,
    activeGroup,
    activeRole,
    activeWorkspace,
    topbarOpacity,
    topbarBlur,
    treeOpen,
    chatNav,
    standaloneWindowControls,
    onTopbarPointerDown,
    onCloseSettings,
    onToggleTree,
    onOpenRolePicker,
    onOpenWorkspaceRolePicker,
    onOpenChatPicker,
    onCreateChat,
    onOpenSettings,
    onSwitchChat,
  } = props

  return (
    <AppBar
      position="absolute"
      elevation={0}
      sx={{
        bgcolor: colorMixVar('--studio-topbar', topbarOpacity),
        color: 'text.primary',
        borderBottom: 'none',
        backdropFilter: topbarBlur > 0 ? `blur(${topbarBlur}px)` : 'none',
        WebkitBackdropFilter: topbarBlur > 0 ? `blur(${topbarBlur}px)` : 'none',
        top: 0,
        left: 0,
        right: 0,
      }}
    >
      <Toolbar
        variant="dense"
        sx={{
          gap: 0.5,
          minHeight: 40,
          px: 1,
          '&.MuiToolbar-root': { minHeight: 40 },
        }}
        onPointerDown={onTopbarPointerDown}
      >
        {page === 'settings' ? (
          <>
            <IconButton onClick={onCloseSettings} size="small">
              <ChevronLeftIcon fontSize="small" />
            </IconButton>

            <Typography variant="subtitle2" sx={{ fontWeight: 900, mr: 0.5 }}>
              设置
            </Typography>

            <Box sx={{ flex: 1, minWidth: 8 }} />
            {standaloneWindowControls}
          </>
        ) : (
          <>
            <Button
              variant="text"
              size="small"
              onClick={onOpenRolePicker}
              disabled={loading || (!roles.length && !groups.length && !workspaces.length)}
              sx={{ borderRadius: 999, px: 1, py: 0.25, minWidth: 0, gap: 0.75, borderColor: 'divider' }}
            >
              <Avatar
                src={
                  activeTargetKind === 'group'
                    ? String((activeGroup as any)?.avatarImage || '') || undefined
                    : activeTargetKind === 'workspace'
                      ? undefined
                      : String(activeRole?.avatarImage || '') || undefined
                }
                sx={{ width: 22, height: 22, fontSize: 12 }}
              >
                {activeTargetKind === 'group' ? String((activeGroup as any)?.avatar || '👥') : activeTargetKind === 'workspace' ? '📁' : String(activeRole?.avatar || '🙂')}
              </Avatar>
              <Typography variant="body2" sx={{ fontWeight: 900, maxWidth: 180 }} noWrap>
                {activeTargetKind === 'group'
                  ? activeGroup
                    ? String((activeGroup as any)?.name || '')
                    : '请选择群组'
                  : activeTargetKind === 'workspace'
                    ? activeWorkspace
                      ? String((activeWorkspace as any)?.name || '')
                      : '请选择工作区'
                    : activeRole
                      ? String(activeRole?.name || '')
                      : '请选择角色'}
              </Typography>
            </Button>

            {activeTargetKind === 'workspace' ? (
              <Button
                variant="text"
                size="small"
                onClick={onOpenWorkspaceRolePicker}
                disabled={loading || !roles.length}
                sx={{ borderRadius: 999, px: 1, py: 0.25, minWidth: 0, gap: 0.75, borderColor: 'divider' }}
              >
                <Avatar src={String(activeRole?.avatarImage || '') || undefined} sx={{ width: 22, height: 22, fontSize: 12 }}>
                  {String(activeRole?.avatar || '🙂')}
                </Avatar>
                <Typography variant="body2" sx={{ fontWeight: 900, maxWidth: 160 }} noWrap>
                  {activeRole ? String(activeRole?.name || '') : '请选择角色'}
                </Typography>
              </Button>
            ) : null}

            <Box sx={{ flex: 1 }} />

            <Tooltip title={chatNav.lockedReason || (chatNav.olderId ? '切换到较旧会话' : '没有更旧的会话')}>
              <span>
                <IconButton
                  onClick={() => onSwitchChat(chatNav.olderId)}
                  size="small"
                  disabled={!!chatNav.lockedReason || !chatNav.olderId}
                  aria-label="切换到较旧会话"
                >
                  <ChevronLeftIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={chatNav.lockedReason || (chatNav.newerId ? '切换到较新会话' : '没有更新的会话')}>
              <span>
                <IconButton
                  onClick={() => onSwitchChat(chatNav.newerId)}
                  size="small"
                  disabled={!!chatNav.lockedReason || !chatNav.newerId}
                  aria-label="切换到较新会话"
                >
                  <ChevronRightIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="聊天记录">
              <IconButton onClick={onOpenChatPicker} size="small">
                <HistoryIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="新建聊天">
              <span>
                <IconButton
                  onClick={onCreateChat}
                  size="small"
                  disabled={activeTargetKind === 'group' ? !activeGroup : activeTargetKind === 'workspace' ? !activeWorkspace || !activeRole : !activeRole}
                  aria-label="新建聊天"
                >
                  <AddIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={treeOpen ? '收起分支树' : '展开分支树'}>
              <IconButton onClick={onToggleTree} size="small" aria-label={treeOpen ? '收起分支树' : '展开分支树'}>
                <AccountTreeIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="设置">
              <IconButton onClick={() => onOpenSettings(activeTargetKind === 'workspace' ? 'workspaces' : activeTargetKind === 'group' ? 'groups' : 'roles')} size="small">
                <SettingsIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {standaloneWindowControls}
          </>
        )}
      </Toolbar>
    </AppBar>
  )
}
