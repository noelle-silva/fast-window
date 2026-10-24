import * as React from 'react'
import type { SxProps, Theme } from '@mui/material'
import { ChatMessageList } from './ChatMessageList'
import { CustomScrollArea } from './CustomScrollArea'
import { useSessionPageScrollRegistry } from './sessionPageScrollRegistry'
import { useMessageBatchMount } from '../hooks/useMessageBatchMount'

type ChatMessageListSurfaceProps = Omit<
  React.ComponentProps<typeof ChatMessageList>,
  'messageBatchGroups' | 'messages' | 'chatRootRef'
>

// 单个会话的完整消息页面：滚动容器、分批上屏状态都属于页面自身。
// 页面被缓存（隐藏）时不再接收新的元素，因此这里的状态和 DOM 一并保留。
export function SessionMessagePage(props: {
  sessionKey: string
  messages: any[]
  hasMessages: boolean
  activeRunTailPendingMessage: any
  messageListProps: ChatMessageListSurfaceProps
  emptyContent: React.ReactNode
  scrollHostSx: SxProps<Theme>
  scrollSx: SxProps<Theme>
  onClick?: React.MouseEventHandler<HTMLDivElement>
}) {
  const { sessionKey, messages, hasMessages, activeRunTailPendingMessage, messageListProps, emptyContent, scrollHostSx, scrollSx, onClick } = props
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const scrollRegistry = useSessionPageScrollRegistry()
  const setScrollNode = React.useCallback(
    (el: HTMLDivElement | null) => {
      scrollRef.current = el
      scrollRegistry?.register(sessionKey, el)
    },
    [scrollRegistry, sessionKey],
  )
  const { batchGroups, visibleMessages } = useMessageBatchMount({ sessionKey, messages, scrollRef })
  const displayMessages = React.useMemo(
    () => (activeRunTailPendingMessage ? [...visibleMessages, activeRunTailPendingMessage] : visibleMessages),
    [activeRunTailPendingMessage, visibleMessages],
  )

  return (
    <CustomScrollArea ref={setScrollNode} onClick={onClick} hostSx={scrollHostSx} scrollSx={scrollSx}>
      {hasMessages ? (
        <ChatMessageList
          {...messageListProps}
          messageBatchGroups={batchGroups}
          messages={displayMessages}
          chatRootRef={scrollRef}
        />
      ) : (
        emptyContent
      )}
    </CustomScrollArea>
  )
}
