import * as React from 'react'
import { Box, Button, IconButton, Tooltip, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import HistoryIcon from '@mui/icons-material/History'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import SettingsIcon from '@mui/icons-material/Settings'
import StorageIcon from '@mui/icons-material/Storage'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import { EntityAvatar } from './avatar/EntityAvatar'

// 顶栏两种工作模式：角色模式只出角色按钮；工作区模式出工作区按钮 + 角色按钮。
// 模式按钮是唯一的切换入口，点一下就在两者间来回切。
export type TopbarMode = 'role' | 'workspace'

// 顶栏按钮组：模式切换按钮与右侧那排按钮恒定不动；
// showIdentity 决定是否在顶栏里出「选角色 / 选工作区」按钮——
// 侧边栏模式下这两个按钮让位给侧边栏里的列表，故顶栏不再显示。
export type ChatNavControlsProps = {
  showIdentity: boolean
  loading: boolean
  mode: TopbarMode
  roles: any[]
  activeRole: any
  activeWorkspace: any
  treeOpen: boolean
  chatNav: { olderId: any; newerId: any; lockedReason: any }
  onToggleMode: () => void
  onOpenRolePicker: (e: React.MouseEvent<HTMLElement>) => void
  onOpenWorkspacePicker: (e: React.MouseEvent<HTMLElement>) => void
  onOpenChatPicker: (e: React.MouseEvent<HTMLElement>) => void
  onCreateChat: () => void
  onToggleTree: () => void
  onOpenProviders: () => void
  onOpenSettings: (tab?: any) => void
  onSwitchChat: (chatId: any) => void
}

export function ChatNavControls(props: ChatNavControlsProps) {
  const {
    showIdentity,
    loading,
    mode,
    roles,
    activeRole,
    activeWorkspace,
    treeOpen,
    chatNav,
    onToggleMode,
    onOpenRolePicker,
    onOpenWorkspacePicker,
    onOpenChatPicker,
    onCreateChat,
    onToggleTree,
    onOpenProviders,
    onOpenSettings,
    onSwitchChat,
  } = props

  const modeLabel = mode === 'workspace' ? '工作区模式' : '角色模式'
  const nextModeLabel = mode === 'workspace' ? '角色模式' : '工作区模式'
  const workspaceName = activeWorkspace ? String((activeWorkspace as any)?.name || '') || '无' : '无'
  const roleName = activeRole ? String(activeRole?.name || '') : '请选择角色'
  const createDisabled = mode === 'workspace' ? !activeWorkspace || !activeRole : !activeRole

  const pillSx = { borderRadius: 999, px: 1, py: 0.25, minWidth: 0, gap: 0.75, borderColor: 'divider' } as const

  const actions: Array<{
    key: string
    icon: React.ReactNode
    tooltip: string
    aria: string
    disabled: boolean
    onClick: (e: React.MouseEvent<HTMLElement>) => void
  }> = [
    {
      key: 'older',
      icon: <ChevronLeftIcon fontSize="small" />,
      tooltip: chatNav.lockedReason || (chatNav.olderId ? '切换到较旧会话' : '没有更旧的会话'),
      aria: '切换到较旧会话',
      disabled: !!chatNav.lockedReason || !chatNav.olderId,
      onClick: () => onSwitchChat(chatNav.olderId),
    },
    {
      key: 'newer',
      icon: <ChevronRightIcon fontSize="small" />,
      tooltip: chatNav.lockedReason || (chatNav.newerId ? '切换到较新会话' : '没有更新的会话'),
      aria: '切换到较新会话',
      disabled: !!chatNav.lockedReason || !chatNav.newerId,
      onClick: () => onSwitchChat(chatNav.newerId),
    },
    {
      key: 'history',
      icon: <HistoryIcon fontSize="small" />,
      tooltip: '聊天记录',
      aria: '聊天记录',
      disabled: false,
      onClick: (e) => onOpenChatPicker(e),
    },
    {
      key: 'create',
      icon: <AddIcon fontSize="small" />,
      tooltip: '新建聊天',
      aria: '新建聊天',
      disabled: createDisabled,
      onClick: () => onCreateChat(),
    },
    {
      key: 'tree',
      icon: <AccountTreeIcon fontSize="small" />,
      tooltip: treeOpen ? '收起分支树' : '展开分支树',
      aria: treeOpen ? '收起分支树' : '展开分支树',
      disabled: false,
      onClick: () => onToggleTree(),
    },
    {
      key: 'providers',
      icon: <StorageIcon fontSize="small" />,
      tooltip: '供应商',
      aria: '供应商',
      disabled: false,
      onClick: () => onOpenProviders(),
    },
    {
      key: 'settings',
      icon: <SettingsIcon fontSize="small" />,
      tooltip: '设置',
      aria: '设置',
      disabled: false,
      onClick: () => onOpenSettings(),
    },
  ]

  return (
    <>
      <Tooltip title={`切换到${nextModeLabel}`}>
        <span>
          <Button
            variant="text"
            size="small"
            onClick={onToggleMode}
            disabled={loading}
            startIcon={<SwapHorizIcon fontSize="small" />}
            sx={{ ...pillSx, fontWeight: 900 }}
          >
            {modeLabel}
          </Button>
        </span>
      </Tooltip>

      {showIdentity ? (
        <>
          {mode === 'workspace' ? (
            <Button variant="text" size="small" onClick={onOpenWorkspacePicker} disabled={loading} sx={pillSx}>
              <EntityAvatar kind="workspace" size={22} />
              <Typography variant="body2" sx={{ fontWeight: 900, maxWidth: 180 }} noWrap>
                {workspaceName}
              </Typography>
            </Button>
          ) : null}

          <Button variant="text" size="small" onClick={onOpenRolePicker} disabled={loading || !roles.length} sx={pillSx}>
            <EntityAvatar kind="role" image={String(activeRole?.avatarImage || '')} size={22} />
            <Typography variant="body2" sx={{ fontWeight: 900, maxWidth: 180 }} noWrap>
              {roleName}
            </Typography>
          </Button>
        </>
      ) : null}

      <Box sx={{ flex: 1 }} />

      {actions.map((item) => (
        <Tooltip key={item.key} title={item.tooltip}>
          <span>
            <IconButton onClick={item.onClick} size="small" disabled={item.disabled} aria-label={item.aria}>
              {item.icon}
            </IconButton>
          </span>
        </Tooltip>
      ))}
    </>
  )
}
