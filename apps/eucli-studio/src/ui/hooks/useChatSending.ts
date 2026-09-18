import * as React from 'react'
import { clampNum } from '../utils/numbers'
import { useEvent } from './useEvent'

export type SendPathAnchor = {
  chatId: string
  branchId: string
  parentMid: string
  runId: string
  inputMessageId: string
  lastMessageId: string
  existingMessageIds: string[]
  nonce: number
}

export function emptySendPathAnchor(): SendPathAnchor {
  return { chatId: '', branchId: '', parentMid: '', runId: '', inputMessageId: '', lastMessageId: '', existingMessageIds: [], nonce: 0 }
}

export function useChatSending(deps: {
  controller: any
  activeChat: any
  activeBranchIdUi: string
  chatAllMessagesRaw: any[]
  activeStopRunId: string
  setSendPathAnchor: React.Dispatch<React.SetStateAction<SendPathAnchor>>
  sendPathAnchorNonceRef: React.MutableRefObject<number>
  clearSendPathAnchor: () => void
  setTreeSelectedMid: React.Dispatch<React.SetStateAction<string>>
  treeSelectedMid: string
  branchDraft: any
  draftFiles: any[]
  draftFilesPending: boolean
  attachSendLimitChars: number
  stickToBottomRef: React.MutableRefObject<boolean>
}) {
  const {
    controller,
    activeChat,
    activeBranchIdUi,
    chatAllMessagesRaw,
    activeStopRunId,
    setSendPathAnchor,
    sendPathAnchorNonceRef,
    clearSendPathAnchor,
    setTreeSelectedMid,
    treeSelectedMid,
    branchDraft,
    draftFiles,
    draftFilesPending,
    attachSendLimitChars,
    stickToBottomRef,
  } = deps

  const [sendWarn, setSendWarn] = React.useState<{ open: boolean; items: any[] }>({ open: false, items: [] })
  const closeSendWarn = useEvent(() => setSendWarn({ open: false, items: [] }))
  const beginRunPathFollow = useEvent((parentMid0: string) => {
    const parentMid = String(parentMid0 || '').trim()
    if (!parentMid || !activeChat) return null
    const chatId = String(activeChat?.id || '')
    const nonce = ++sendPathAnchorNonceRef.current
    const existingMessageIds = Array.isArray(chatAllMessagesRaw)
      ? chatAllMessagesRaw.map((message: any) => String(message?.id || '').trim()).filter(Boolean)
      : []
    stickToBottomRef.current = true
    setSendPathAnchor({ ...emptySendPathAnchor(), chatId, branchId: activeBranchIdUi, parentMid, existingMessageIds, nonce })
    setTreeSelectedMid('')

    const onRunState = (run: any) => {
      const runId = String(run?.id || '').trim()
      setSendPathAnchor((current) => {
        if (String(current?.chatId || '') !== chatId) return current
        if (String(current?.parentMid || '') !== parentMid) return current
        if (Number(current?.nonce || 0) !== nonce) return current
        return {
          ...current,
          runId,
          inputMessageId: String(run?.inputMessageId || current.inputMessageId || '').trim(),
          lastMessageId: String(run?.lastMessageId || current.lastMessageId || run?.inputMessageId || current.inputMessageId || '').trim(),
        }
      })
    }

    const clear = () => {
      setSendPathAnchor((current) => {
        if (String(current?.chatId || '') !== chatId) return current
        if (String(current?.parentMid || '') !== parentMid) return current
        if (Number(current?.nonce || 0) !== nonce) return current
        return emptySendPathAnchor()
      })
    }

    return { onRunState, clear }
  })

  const sendFromComposer = useEvent(() => {
    const selectedMid = String(treeSelectedMid || '').trim()
    const branchDraftMid = String((branchDraft as any)?.forkFromMid || '').trim()
    const mid = selectedMid || branchDraftMid
    if (mid && activeChat) {
      const follow = beginRunPathFollow(mid)
      if (!follow) return
      Promise.resolve()
        .then(() => controller.actions.sendFromMid?.(mid, { onRunState: follow.onRunState }))
        .finally(() => follow.clear())
      return
    }
    clearSendPathAnchor()
    setTreeSelectedMid('')
    controller.actions.send()
  })
  const confirmSendWarn = useEvent(() => {
    setSendWarn({ open: false, items: [] })
    sendFromComposer()
  })

  const onSend = useEvent(() => {
    if (draftFilesPending) return controller?.capabilities?.ui?.showToast?.('文件解析中，请稍候…')
    const warns = draftFiles
      .map((f: any) => {
        if (!f || f.pending) return null
        const err = String(f?.error || '').trim()
        if (err) return null
        const rawLen = String(f?.text || '').trim().length
        if (!rawLen) return null
        const pct = clampNum(Math.round(Number(f?.sendPct ?? 100)), 0, 100)
        const sendLen = Math.max(0, Math.ceil((rawLen * pct) / 100))
        if (sendLen <= attachSendLimitChars) return null
        return { id: String(f?.id || ''), name: String(f?.name || '文件'), pct, rawLen, sendLen }
      })
      .filter(Boolean)
    if (warns.length) return setSendWarn({ open: true, items: warns })
    sendFromComposer()
  })
  const onStop = useEvent(() => controller.actions.stop?.(activeStopRunId))

  return {
    sendWarn,
    closeSendWarn,
    beginRunPathFollow,
    sendFromComposer,
    confirmSendWarn,
    onSend,
    onStop,
  }
}
