import * as React from 'react'
import { useEvent } from './useEvent'

// 发送不参与“看哪里”的推导：发送只负责发起动作，视图意图由 App 的唯一状态决定。
// viewAnchorMid 是当前锚定节点（跟随态为空）：从锚定节点发送即从该节点分叉。
export function useChatSending(deps: {
  controller: any
  activeChat: any
  activeStopRunId: string
  viewAnchorMid: string
  branchDraft: any
  onSendStarted: (runAnchorMid: string) => void
}) {
  const {
    controller,
    activeChat,
    activeStopRunId,
    viewAnchorMid,
    branchDraft,
    onSendStarted,
  } = deps

  const sendFromComposer = useEvent(() => {
    const selectedMid = String(viewAnchorMid || '').trim()
    const branchDraftMid = String((branchDraft as any)?.forkFromMid || '').trim()
    const mid = selectedMid || branchDraftMid
    if (mid && activeChat) {
      onSendStarted(mid)
      controller.actions.sendFromMid?.(mid)
      return
    }
    onSendStarted('')
    controller.actions.send()
  })
  const onSend = useEvent(() => {
    sendFromComposer()
  })
  const onStop = useEvent(() => controller.actions.stop?.(activeStopRunId))

  return {
    sendFromComposer,
    onSend,
    onStop,
  }
}
