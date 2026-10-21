import * as React from 'react'
import { Box, IconButton, Tooltip } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import HistoryIcon from '@mui/icons-material/History'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import SettingsIcon from '@mui/icons-material/Settings'
import StorageIcon from '@mui/icons-material/Storage'

// 顶栏只保留会话操作与全局入口；侧边栏显示视图由侧边栏自己的顶部栏切换。
export type ChatNavControlsProps = {
  canCreateChat: boolean
  treeOpen: boolean
  chatNav: { olderId: any; newerId: any; lockedReason: any }
  onOpenChatPicker: (e: React.MouseEvent<HTMLElement>) => void
  onCreateChat: () => void
  onToggleTree: () => void
  onOpenProviders: () => void
  onOpenSettings: (tab?: any) => void
  onSwitchChat: (chatId: any) => void
}

export function ChatNavControls(props: ChatNavControlsProps) {
  const {
    canCreateChat,
    treeOpen,
    chatNav,
    onOpenChatPicker,
    onCreateChat,
    onToggleTree,
    onOpenProviders,
    onOpenSettings,
    onSwitchChat,
  } = props

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
      disabled: !canCreateChat,
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
