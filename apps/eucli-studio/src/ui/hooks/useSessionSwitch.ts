import * as React from 'react'
import {
  createSessionSwitchState,
  reduceSessionSwitch,
  sessionSwitchNeedsSkeleton,
  sessionSwitchPending,
  type SessionSwitchState,
} from '../../domain/sessionSwitch'
import {
  beginSwitchTrace,
  currentSwitchTrace,
  endSwitchTrace,
  markSwitchBoundary,
} from '../../domain/switchTrace'

function chatIdOf(chat: any) {
  return String(chat?.id || '').trim()
}

// useSessionSwitch 把「选中谁」与「谁已经画出来」拆成两条独立事实：
//   - data：控制器权威，activeChat 就绪即 BODY_READY（纯咨询，永不门控渲染）；
//   - paint：只有新页提交后真正画出的那一帧才 PAINTED，可见页永远由它推进。
//
// 注意：不要再用 React.startTransition 包外部 store 写入。
// useSyncExternalStore 的快照更新不会被 transition 降级（React 18 必须同步渲染以避免
// tearing），包一层只会增加开销，换不来任何延迟。
export function useSessionSwitch(controller: any, activeChat: any, selectedChatId: unknown) {
  const activeChatId = chatIdOf(activeChat)
  const selectedId = String(selectedChatId || activeChatId || '').trim()

  const [state, setState] = React.useState<SessionSwitchState>(createSessionSwitchState)

  // SELECT 由「选中项变化」驱动，不由数据就绪驱动。
  React.useLayoutEffect(() => {
    setState((prev) => reduceSessionSwitch(prev, { type: 'SELECT', key: selectedId }))
    if (!selectedId) return
    // 切换起点：观测是纯旁路，未挂 sink 时为零成本空操作。
    beginSwitchTrace(selectedId)
    markSwitchBoundary('frontend.select')
  }, [selectedId])

  // 数据就绪只记录事实，不推进可见页。
  const dataReady = !!selectedId && activeChatId === selectedId
  React.useLayoutEffect(() => {
    if (!dataReady) return
    setState((prev) => reduceSessionSwitch(prev, { type: 'BODY_READY', key: selectedId, seq: prev.seq }))
    if (currentSwitchTrace()?.key === selectedId) markSwitchBoundary('frontend.bodyReady')
  }, [dataReady, selectedId])

  // 页面栈只上报「画出来了」；seq 在 reducer 内部核对，迟到通知自动丢弃。
  const notifyPainted = React.useCallback((key: string) => {
    setState((prev) => reduceSessionSwitch(prev, { type: 'PAINTED', key, seq: prev.seq }))
    if (currentSwitchTrace()?.key === key) {
      markSwitchBoundary('frontend.painted')
      endSwitchTrace()
    }
  }, [])

  const requestSwitch = React.useCallback(
    (chatId: any, options?: { force?: boolean }) => {
      const nextChatId = String(chatId || '').trim()
      if (!nextChatId) return
      if (!options?.force && nextChatId === selectedId) return
      controller?.actions?.setActiveChat?.(nextChatId)
    },
    [controller, selectedId],
  )

  const pending = sessionSwitchPending(state)
  // 数据就绪即可交给页面栈挂载；能否「看得见」由 visibleKey 单独决定。
  const renderChat = dataReady ? activeChat : null

  return {
    activeChatId: selectedId,
    loadedChatId: activeChatId,
    selectedChatId: selectedId,
    seq: state.seq,
    visibleKey: state.visibleKey,
    bodyReadyKey: state.bodyReadyKey,
    renderChat,
    renderChatId: chatIdOf(renderChat),
    switching: pending,
    needsSkeleton: sessionSwitchNeedsSkeleton(state),
    notifyPainted,
    requestSwitch,
  }
}
