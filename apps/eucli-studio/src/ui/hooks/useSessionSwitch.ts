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

// useSessionSwitch 把三条事实严格分开：
//
//   selectedId    选中目标（控制器权威偏好：正文已加载时就是 activeChat.id，
//                 正文未加载时回落到索引偏好 activeChatId）
//   loadedChatId  已加载正文所属会话（activeChat.id；正文未加载时为空串）
//   bodyReady     正文是否已就绪 = loadedChatId 非空
//
// 关键：bodyReady 表达的是「正文已就绪」，不是「selectedId 与 loadedChatId 相等」。
// 两者是不同维度，冷启动时必然不同步：
//   索引偏好已经给出 selectedId，而正文还在加载中（loadedChatId 为空串）。
// 若把「两者相等」当就绪条件，冷启动的就绪判定永远不成立：
// renderChat 恒为 null → 页面永不挂载 → PAINTED 永不发出 → 首屏永久卡死。
//
// 语义边界：
//   - 冷启动：正文到达即 bodyReady，页面立刻可挂载并进入 PAINTED；
//   - 切换中：正文尚未切换（activeChat 为 null 或仍是旧会话），
//     页面栈靠 visibleKey 让旧页继续可见，新正文到达后按新 key 重挂并 PAINTED。
//
// 注意：不要再用 React.startTransition 包外部 store 写入。
// useSyncExternalStore 的快照更新不会被 transition 降级（React 18 必须同步渲染以避免
// tearing），包一层只会增加开销，换不来任何延迟。
export function useSessionSwitch(controller: any, activeChat: any, selectedChatId: unknown) {
  const loadedChatId = chatIdOf(activeChat)
  const selectedId = String(selectedChatId || loadedChatId || '').trim()

  const [state, setState] = React.useState<SessionSwitchState>(createSessionSwitchState)

  // SELECT 由「选中目标变化」驱动，不由数据就绪驱动。
  React.useLayoutEffect(() => {
    setState((prev) => reduceSessionSwitch(prev, { type: 'SELECT', key: selectedId }))
    if (!selectedId) return
    // 切换起点：观测是纯旁路，未挂 sink 时为零成本空操作。
    beginSwitchTrace(selectedId)
    markSwitchBoundary('frontend.select')
  }, [selectedId])

  // 正文就绪只记录事实，不推进可见页。
  const bodyReady = !!loadedChatId
  React.useLayoutEffect(() => {
    if (!bodyReady) return
    setState((prev) => reduceSessionSwitch(prev, { type: 'BODY_READY', key: selectedId, seq: prev.seq }))
    if (currentSwitchTrace()?.key === selectedId) markSwitchBoundary('frontend.bodyReady')
  }, [bodyReady, selectedId])

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
  // 已加载正文即可交给页面栈挂载；能否「看得见」始终由 visibleKey 单独决定。
  const renderChat = bodyReady ? activeChat : null

  return {
    // activeChatId 沿用「选中目标」语义，保持既有调用方行为不变。
    activeChatId: selectedId,
    loadedChatId,
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
