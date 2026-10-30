import * as React from 'react'
import type { SxProps, Theme } from '@mui/material'
import { ChatMessageList } from './ChatMessageList'
import { CustomScrollArea } from './CustomScrollArea'
import { useSessionPageScrollRegistry } from './sessionPageScrollRegistry'
import { useSessionPageVisible } from './SessionPageStack'
import { useMessageBatchMount } from '../hooks/useMessageBatchMount'
import { useMessageOffscreen } from '../hooks/useMessageOffscreen'

type ChatMessageListSurfaceProps = Omit<
  React.ComponentProps<typeof ChatMessageList>,
  'messageBatchGroups' | 'messages' | 'chatRootRef' | 'messageOffscreen'
>

// 单个会话的完整消息页面：滚动容器、分批上屏、屏外跳过状态都属于页面自身。
// 页面被缓存（隐藏）时不再接收新的元素，因此这里的状态和 DOM 一并保留。
export function SessionMessagePage(props: {
  sessionKey: string
  messages: any[]
  hasMessages: boolean
  activeRunTailPendingMessage: any
  layoutSignature: string
  messageOffscreenEnabled: boolean
  messageListProps: ChatMessageListSurfaceProps
  emptyContent: React.ReactNode
  scrollHostSx: SxProps<Theme>
  scrollSx: SxProps<Theme>
  revealMessageRef?: React.MutableRefObject<((mid: string) => void) | null>
  onClick?: React.MouseEventHandler<HTMLDivElement>
}) {
  const {
    sessionKey,
    messages,
    hasMessages,
    activeRunTailPendingMessage,
    layoutSignature,
    messageOffscreenEnabled,
    messageListProps,
    emptyContent,
    scrollHostSx,
    scrollSx,
    revealMessageRef,
    onClick,
  } = props
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const scrollRegistry = useSessionPageScrollRegistry()
  // pageActive 是页面内所有调度的统一开关：分批上屏、屏外观察都只在
  // 「本页正在屏幕或正在完成首次绘制」时推进。缓存页不排队、不触发 setTimeout。
  const pageActive = useSessionPageVisible()
  const { handle: messageOffscreen, attachScrollElement } = useMessageOffscreen({
    enabled: messageOffscreenEnabled && pageActive,
    layoutSignature,
    revealMessageRef,
  })
  const setScrollNode = React.useCallback(
    (el: HTMLDivElement | null) => {
      scrollRef.current = el
      scrollRegistry?.register(sessionKey, el)
      attachScrollElement(el)
    },
    [scrollRegistry, sessionKey, attachScrollElement],
  )

  const { batchGroups, visibleMessages } = useMessageBatchMount({ sessionKey, messages, scrollRef, active: pageActive })
  const displayMessages = React.useMemo(
    () => (activeRunTailPendingMessage ? [...visibleMessages, activeRunTailPendingMessage] : visibleMessages),
    [activeRunTailPendingMessage, visibleMessages],
  )

  return (
    <CustomScrollArea ref={setScrollNode} onClick={onClick} hostSx={scrollHostSx} scrollSx={scrollSx}>
      {hasMessages ? (
        <ChatMessageList
          {...messageListProps}
          cacheScope={sessionKey}
          messageBatchGroups={batchGroups}
          messageOffscreen={messageOffscreenEnabled ? messageOffscreen : null}
          messages={displayMessages}
          chatRootRef={scrollRef}
        />
      ) : (
        emptyContent
      )}
    </CustomScrollArea>
  )
}
