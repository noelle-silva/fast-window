import * as React from 'react'
import type { MessageOffscreenHandle } from '../hooks/useMessageOffscreen'
import type { MessageOffscreenSlotMeta } from './messageOffscreenController'

// 消息外层占位槽：视觉样式由控制器直接管理，React 只负责挂载与元数据同步。
export function MessageOffscreenSlot(props: {
  controller: MessageOffscreenHandle
  mid: string
  pinned: boolean
  contentKey: string
  message: any
  children: React.ReactNode
}) {
  const { controller, mid, pinned, contentKey, message, children } = props
  const elementRef = React.useRef<HTMLDivElement | null>(null)
  const metaRef = React.useRef<MessageOffscreenSlotMeta>({ pinned, contentKey, message })
  metaRef.current = { pinned, contentKey, message }

  const setRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      const previous = elementRef.current
      elementRef.current = el
      if (previous && previous !== el) controller.detach(mid, previous)
      if (el) controller.attach(mid, el, metaRef.current)
    },
    [controller, mid],
  )

  // 依赖只表达「槽位事实真的变了」：槽位身份 / 钉住状态 / 内容键。
  // 纯父级重渲染不再进控制器，也就不会重复触发几何读取。
  // metaRef.current 在 render 期已同步为最新值，effect 里读它即可。
  React.useLayoutEffect(() => {
    controller.update(mid, metaRef.current)
  }, [controller, mid, pinned, contentKey])

  return (
    <div ref={setRef} data-fw-message-slot={mid} style={{ minWidth: 0 }}>
      {children}
    </div>
  )
}
