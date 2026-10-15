import * as React from 'react'
import { AppBar, Box, Button, IconButton, Toolbar, Tooltip, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import HistoryIcon from '@mui/icons-material/History'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import SettingsIcon from '@mui/icons-material/Settings'
import StorageIcon from '@mui/icons-material/Storage'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import { colorMixVar } from '../colorThemeStyles'
import { EntityAvatar } from './avatar/EntityAvatar'

// 顶栏两种工作模式：角色模式只出角色按钮；工作区模式出工作区按钮 + 角色按钮。
// 模式按钮是唯一的切换入口，点一下就在两者间来回切。
export type TopbarMode = 'role' | 'workspace'

export function ChatTopBar(props: {
  page: 'chat' | 'settings'
  loading: boolean
  mode: TopbarMode
  roles: any[]
  workspaces: any[]
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
  onToggleMode: () => void
  onOpenRolePicker: (e: React.MouseEvent<HTMLElement>) => void
  onOpenWorkspacePicker: (e: React.MouseEvent<HTMLElement>) => void
  onOpenChatPicker: (e: React.MouseEvent<HTMLElement>) => void
  onCreateChat: () => void
  onOpenProviders: () => void
  onOpenSettings: (tab?: any) => void
  onSwitchChat: (chatId: any) => void
}) {
  const {
    page,
    loading,
    mode,
    roles,
    workspaces,
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
    onToggleMode,
    onOpenRolePicker,
    onOpenWorkspacePicker,
    onOpenChatPicker,
    onCreateChat,
    onOpenProviders,
    onOpenSettings,
    onSwitchChat,
  } = props

  const modeLabel = mode === 'workspace' ? '工作区模式' : '角色模式'
  const nextModeLabel = mode === 'workspace' ? '角色模式' : '工作区模式'
  const workspaceName = activeWorkspace ? String((activeWorkspace as any)?.name || '') || '无' : '无'
  const roleName = activeRole ? String(activeRole?.name || '') : '请选择角色'
  const createDisabled = mode === 'workspace' ? !activeWorkspace || !activeRole : !activeRole

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
            <Tooltip title={`切换到${nextModeLabel}`}>
              <span>
                <Button
                  variant="text"
                  size="small"
                  onClick={onToggleMode}
                  disabled={loading}
                  startIcon={<SwapHorizIcon fontSize="small" />}
                  sx={{ borderRadius: 999, px: 1, py: 0.25, minWidth: 0, gap: 0.5, borderColor: 'divider', fontWeight: 900 }}
                >
                  {modeLabel}
                </Button>
              </span>
            </Tooltip>

            {mode === 'workspace' ? (
              <Button
                variant="text"
                size="small"
                onClick={onOpenWorkspacePicker}
                disabled={loading}
                sx={{ borderRadius: 999, px: 1, py: 0.25, minWidth: 0, gap: 0.75, borderColor: 'divider' }}
              >
                <EntityAvatar kind="workspace" size={22} />
                <Typography variant="body2" sx={{ fontWeight: 900, maxWidth: 180 }} noWrap>
                  {workspaceName}
                </Typography>
              </Button>
            ) : null}

            <Button
              variant="text"
              size="small"
              onClick={onOpenRolePicker}
              disabled={loading || !roles.length}
              sx={{ borderRadius: 999, px: 1, py: 0.25, minWidth: 0, gap: 0.75, borderColor: 'divider' }}
            >
              <EntityAvatar kind="role" image={String(activeRole?.avatarImage || '')} size={22} />
              <Typography variant="body2" sx={{ fontWeight: 900, maxWidth: 180 }} noWrap>
                {roleName}
              </Typography>
            </Button>

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
                  disabled={createDisabled}
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
            <Tooltip title="供应商">
              <IconButton onClick={onOpenProviders} size="small" aria-label="供应商">
                <StorageIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="设置">
              <IconButton onClick={() => onOpenSettings()} size="small">
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
