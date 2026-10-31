import * as React from 'react'
import {
  createSessionSwitchState,
  reduceSessionSwitch,
  sessionSwitchFailed,
  sessionSwitchNeedsSkeleton,
  sessionSwitchPending,
  type SessionSwitchState,
} from '../../domain/sessionSwitch'
import { resolveLoadedChatId, resolveSelectedChatId } from '../../domain/sessionSwitchTarget'
import {
  beginSwitchTrace,
  currentSwitchTrace,
  endSwitchTrace,
  markSwitchBoundary,
} from '../../domain/switchTrace'

function chatIdOf(chat: any) {
  return String(chat?.id || '').trim()
}

// useSessionSwitch 把四条事实严格分开：
//
//   requestedId   刚发起、尚未兑现的切换请求（本 hook 持有）
//   preferredId   控制器偏好（索引里的 activeChatId，由调用方传入）
//   loadedChatId  已加载正文所属会话；「正文是否就绪」的唯一事实源
//   failedKey     当前目标是否已加载失败（终态，必须收敛到可重试的可见状态）
//
// 关键：就绪表达的是「正文已存在」，不是「目标 id 与正文 id 相等」。
// 两者是不同维度，冷启动时必然不同步（偏好已给出目标、正文还在加载），
// 把相等当就绪条件会让就绪判定永远不成立 → 页面永不挂载 → PAINTED 永不发出。
//
// 目标解析统一走 domain/sessionSwitchTarget（requested > loaded > preferred）。
// requestedId 在正文追上目标后自动交还权威，避免它长期压住控制器偏好。
//
// 失败语义：正文加载失败必须走 notifyLoadFailed，让 reducer 进入 FAILED 终态，
// UI 才能收敛到「错误占位 + 重试入口」，而不是永远停在「正在打开…」。
//
// 注意：不要再用 React.startTransition 包外部 store 写入。
// useSyncExternalStore 的快照更新不会被 transition 降级（React 18 必须同步渲染以避免
// tearing），包一层只会增加开销，换不来任何延迟。
export function useSessionSwitch(controller: any, activeChat: any, preferredChatId: unknown) {
  const loadedChatId = resolveLoadedChatId(activeChat)
  const [requestedId, setRequestedId] = React.useState('')

  // 请求已兑现（正文就是这个会话）：交还权威，让目标回到控制器事实。
  React.useLayoutEffect(() => {
    if (requestedId && loadedChatId === requestedId) setRequestedId('')
  }, [requestedId, loadedChatId])

  const selectedId = resolveSelectedChatId({ requestedChatId: requestedId, loadedChatId, preferredChatId })

  const [state, setState] = React.useState<SessionSwitchState>(createSessionSwitchState)

  // SELECT 由「选中目标变化」驱动，不由数据就绪驱动。
  React.useLayoutEffect(() => {
    setState((prev) => reduceSessionSwitch(prev, { type: 'SELECT', key: selectedId }))
    if (!selectedId) return
    // 切换起点：观测是纯旁路，未挂 sink 时为零成本空操作。
    beginSwitchTrace(selectedId)
    markSwitchBoundary('frontend.select')
  }, [selectedId])

  // 「正文就绪」= 已加载正文，且它就是当前目标。
  //
  // 这里的相等是安全的，因为 selectedId 的回落顺序是 loaded > preferred：
  // 只要正文存在且没有更新的切换请求，selectedId 就等于 loadedChatId。
  // 换句话说「相等」表达的是「正文属于目标」，而不是旧实现里
  // 「目标字符串恰好等于正文 id」那个在冷启动必然不成立的伪条件。
  //
  // 依赖里必须带 loadedChatId：同一个目标的重试成功（正文从无到有、或从旧到新）
  // 不会改变 bodyReady 的布尔值，只改 id；不带它就会漏掉「失败后恢复」。
  const bodyReady = !!loadedChatId && loadedChatId === selectedId
  React.useLayoutEffect(() => {
    if (!bodyReady) return
    setState((prev) => reduceSessionSwitch(prev, { type: 'BODY_READY', key: selectedId, seq: prev.seq }))
    if (currentSwitchTrace()?.key === selectedId) markSwitchBoundary('frontend.bodyReady')
  }, [bodyReady, selectedId, loadedChatId])

  // 页面栈只上报「画出来了」；seq 在 reducer 内部核对，迟到通知自动丢弃。
  const notifyPainted = React.useCallback((key: string) => {
    setState((prev) => reduceSessionSwitch(prev, { type: 'PAINTED', key, seq: prev.seq }))
    if (currentSwitchTrace()?.key === key) {
      markSwitchBoundary('frontend.painted')
      endSwitchTrace()
    }
  }, [])

  // 加载失败的唯一入口：把「永远等不到正文」收敛成可重试的终态。
  // reason 必须来自真实错误（网络 / 数据损坏 / 能力不支持 / 会话不存在），不得编造。
  const notifyLoadFailed = React.useCallback((reason: unknown) => {
    const message = String((reason as any)?.message || reason || '').trim() || '会话加载失败'
    setState((prev) => reduceSessionSwitch(prev, {
      type: 'FAILED',
      key: prev.selectedKey,
      seq: prev.seq,
      reason: message,
    }))
  }, [])

  const requestSwitch = React.useCallback(
    (chatId: any, options?: { force?: boolean }) => {
      const nextChatId = String(chatId || '').trim()
      if (!nextChatId) return
      if (!options?.force && nextChatId === selectedId) return
      setRequestedId(nextChatId)
      controller?.actions?.setActiveChat?.(nextChatId)
    },
    [controller, selectedId],
  )

  // 重试入口：失败之后重新发起同一目标的加载。
  // 它复用控制器既有动作（不新造加载通道），并清掉失败态以便重新进入切换。
  // 关键：序号必须继续前进（RETRY），不能用归零式 RESET——
  // 否则上一轮迟到的事件会与新一轮撞号，被误认为当前轮。
  const retryLoad = React.useCallback(() => {
    const target = String(state.selectedKey || selectedId || '').trim()
    if (!target) return
    setState((prev) => reduceSessionSwitch(prev, { type: 'RETRY', key: target }))
    setRequestedId(target)
    controller?.actions?.setActiveChat?.(target)
  }, [controller, state.selectedKey, selectedId])

  const pending = sessionSwitchPending(state)
  const failed = sessionSwitchFailed(state)
  // 页面栈拿到的始终是「已加载正文」：切换期间旧正文继续垫底，
  // 新正文到达后 renderChatId 变化，页面栈按新 key 重挂并发出 PAINTED。
  // 能否「看得见」始终由 visibleKey 单独决定，与本处的数据事实无关。
  const renderChat = activeChat && typeof activeChat === 'object' ? activeChat : null

  return {
    // activeChatId 沿用「选中目标」语义，保持既有调用方行为不变。
    activeChatId: selectedId,
    loadedChatId,
    selectedChatId: selectedId,
    seq: state.seq,
    visibleKey: state.visibleKey,
    renderChat,
    renderChatId: chatIdOf(renderChat),
    switching: pending,
    needsSkeleton: sessionSwitchNeedsSkeleton(state),
    failed,
    failedReason: failed ? state.failedReason : '',
    notifyPainted,
    notifyLoadFailed,
    requestSwitch,
    retryLoad,
  }
}
