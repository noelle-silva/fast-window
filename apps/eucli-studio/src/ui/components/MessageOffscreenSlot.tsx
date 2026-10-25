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

  React.useLayoutEffect(() => {
    controller.update(mid, { pinned, contentKey, message })
  })

  return (
    <div ref={setRef} data-fw-message-slot={mid} style={{ minWidth: 0 }}>
      {children}
    </div>
  )
}
