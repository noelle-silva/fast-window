import * as React from 'react'
import {
  MessageOffscreenController,
  type MessageOffscreenSlotMeta,
} from '../components/messageOffscreenController'

export type MessageOffscreenHandle = {
  attach: (mid: string, el: HTMLElement, meta: MessageOffscreenSlotMeta) => void
  update: (mid: string, meta: MessageOffscreenSlotMeta) => void
  detach: (mid: string, el: HTMLElement) => void
  revealAround: (mid: string) => void
}

export function useMessageOffscreen(options: {
  enabled: boolean
  layoutSignature: string
  revealMessageRef?: React.MutableRefObject<((mid: string) => void) | null>
}): {
  handle: MessageOffscreenHandle
  attachScrollElement: (el: HTMLDivElement | null) => void
} {
  const { enabled, layoutSignature, revealMessageRef } = options
  const controllerRef = React.useRef<MessageOffscreenController | null>(null)
  if (!controllerRef.current) controllerRef.current = new MessageOffscreenController(layoutSignature)
  const controller = controllerRef.current

  const handle = React.useMemo<MessageOffscreenHandle>(
    () => ({
      attach: (mid, el, meta) => controller.attach(mid, el, meta),
      update: (mid, meta) => controller.update(mid, meta),
      detach: (mid, el) => controller.detach(mid, el),
      revealAround: (mid) => {
        controller.revealAround(mid)
      },
    }),
    [controller],
  )

  const revealMessage = React.useCallback(
    (mid: string) => {
      controller.revealAround(mid)
    },
    [controller],
  )

  const attachScrollElement = React.useCallback(
    (el: HTMLDivElement | null) => {
      controller.setScrollElement(el)
    },
    [controller],
  )

  React.useLayoutEffect(() => {
    controller.setLayoutSignature(layoutSignature)
  }, [controller, layoutSignature])

  React.useLayoutEffect(() => {
    controller.setEnabled(enabled)
  }, [controller, enabled])

  // 只有激活页可以占据共享跳转入口；切回时重新注册，避免引用停留在旧页面。
  React.useLayoutEffect(() => {
    if (!revealMessageRef || !enabled) return
    revealMessageRef.current = revealMessage
    return () => {
      if (revealMessageRef.current === revealMessage) revealMessageRef.current = null
    }
  }, [enabled, revealMessageRef, revealMessage])

  // 卸载（含 StrictMode 的模拟卸载）只停观察，不销毁条目；重新启用会整批重新判定。
  React.useLayoutEffect(() => () => controller.dispose(), [controller])

  return { handle, attachScrollElement }
}
