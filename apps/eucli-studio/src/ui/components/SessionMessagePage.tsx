import * as React from 'react'
import type { SxProps, Theme } from '@mui/material'
import { ChatMessageList } from './ChatMessageList'
import { CustomScrollArea } from './CustomScrollArea'
import { useSessionPageScrollRegistry } from './sessionPageScrollRegistry'
import { useSessionPageVisible } from './SessionPageStack'
import { useMessageBatchMount } from '../hooks/useMessageBatchMount'
import { useMessageOffscreen } from '../hooks/useMessageOffscreen'
import { useLoadOlderMessages } from '../hooks/useLoadOlderMessages'
import { markSwitchEnhanceEnd, markSwitchEnhanceStart, markSwitchPainted } from '../../domain/switchSpan'

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
  // 往上翻页：窗口是首屏读源，滚到顶部时按 cursor 续翻。
  const onScrollPositionChange = useLoadOlderMessages({ controller: messageListProps.controller, sessionKey })
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

  // 首屏提交且浏览器真正完成一次绘制（双 rAF）之后，再请求后台预计算：
  // 首屏 5 条由同步引擎直接渲染，绝不等后台；预计算只负责把后续批次提前算好。
  // 会话切换、页面隐藏/卸载时立即取消，旧会话的产物不会再写入缓存。
  //
  // 失效键是「会话」而不是「消息条数」：预计算只负责把会话的后续批次提前算好，
  // 与消息条数无关，因此会话内新增消息不推翻已发起的预热（否则每来一条消息都要
  // 重算全窗口渲染缓存键、取消在途 Worker、重投批次，白付一次 O(会话文本) 的开销）。
  // 标记在发起预热时写入，在 cleanup 里按会话身份清除：被取消的预热不算已预热，
  // 页面重新激活或切回该会话时会补跑（缓存已热，成本极低）。
  const messagesRef = React.useRef(messages)
  messagesRef.current = messages
  const prewarmRenderCache = messageListProps.controller?.actions?.prewarmRenderCache
  const prewarmedSessionRef = React.useRef('')
  React.useEffect(() => {
    if (!pageActive || !sessionKey || !hasMessages) return
    if (typeof prewarmRenderCache !== 'function') return
    if (prewarmedSessionRef.current === sessionKey) return
    prewarmedSessionRef.current = sessionKey
    let handle: { cancel?: () => void } | null = null
    let secondFrame = 0
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        handle = prewarmRenderCache({ sessionKey, messages: messagesRef.current }) || null
      })
    })
    return () => {
      cancelAnimationFrame(firstFrame)
      cancelAnimationFrame(secondFrame)
      handle?.cancel?.()
      // 只清自己的标记：旧会话的 cleanup 不得抹掉新会话的记录。
      if (prewarmedSessionRef.current === sessionKey) prewarmedSessionRef.current = ''
    }
  }, [pageActive, sessionKey, hasMessages, prewarmRenderCache])

  // 切换观测的绘制三边界（design-5 P0）：
  //   第一次 commit 之后 → painted；
  //   首屏同步解析/装饰 → enhanceStart / enhanceEnd（并在此收尾 settled）。
  // 只在「当前页且首次就绪」时上报一次，隐藏缓存页不参与。
  const paintedKeyRef = React.useRef('')
  React.useLayoutEffect(() => {
    if (!pageActive || !sessionKey || paintedKeyRef.current === sessionKey) return
    paintedKeyRef.current = sessionKey
    markSwitchPainted()
    markSwitchEnhanceStart()
    // 同步装饰（markdown/mermaid 结构提交）在本次 commit 内完成：
    // 用微任务把 enhanceEnd 排在当前帧之后，避免把自身算进装饰耗时。
    let cancelled = false
    void Promise.resolve().then(() => {
      if (!cancelled) markSwitchEnhanceEnd()
    })
    return () => {
      cancelled = true
    }
  }, [pageActive, sessionKey, layoutSignature])

  return (
    <CustomScrollArea
      ref={setScrollNode}
      onClick={onClick}
      hostSx={scrollHostSx}
      scrollSx={scrollSx}
      onScrollPositionChange={pageActive ? onScrollPositionChange : undefined}
    >
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
