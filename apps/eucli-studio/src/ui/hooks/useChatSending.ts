import * as React from 'react'
import { useEvent } from './useEvent'

// 发送只做一件事：从当前显示的那个节点发起。显示位置由 App 的唯一状态给出，
// 发送不参与“看哪里”的推导，也不留任何等待态。
export function useChatSending(deps: {
  controller: any
  activeChat: any
  activeStopRunId: string
  displayedMid: string
}) {
  const { controller, activeChat, activeStopRunId, displayedMid } = deps

  const sendFromComposer = useEvent(() => {
    const mid = String(displayedMid || '').trim()
    if (mid && activeChat) {
      controller.actions.sendFromMid?.(mid)
      return
    }
    controller.actions.send()
  })
  const onSend = useEvent(() => {
    sendFromComposer()
  })
  const onStop = useEvent(() => controller.actions.stop?.(activeStopRunId))

  return { sendFromComposer, onSend, onStop }
}
