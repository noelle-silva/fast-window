// 会话切换目标的唯一解析点。
//
// 「当前应该显示哪个会话」由三个事实合成，优先级严格如下：
//
//   requested  用户/控制器刚发起、尚未兑现的切换请求（最新意图）
//   loaded     已加载正文所属会话（数据权威，正文在内存里就是它）
//   preferred  控制器持久化的偏好（索引里的 activeChatId）
//
// 为什么 requested 最高：用户点了 B，即使正文还是 A，目标也必须立刻是 B，
// 否则切换请求永远不会被兑现（旧实现就会「点了没反应」）。
// 为什么 loaded 高于 preferred：偏好只是一个意图，正文是已经成立的事实；
// 让偏好覆盖正文会出现「目标指向 B、正文却是 A」的假切换态。
//
// 这个解析逻辑过去同时存在于 App.tsx 与 useSessionSwitch 里，
// 现在收敛到本模块，任何调用方都不得再自己拼一遍。

import { pickFactCandidate } from './factPrecedence'

export type SessionSwitchTargetInput = {
  // 刚发起、尚未兑现的切换请求；空串表示没有进行中的请求。
  requestedChatId?: unknown
  // 已加载正文的会话 id（activeChat?.id），未加载时为空串。
  loadedChatId?: unknown
  // 控制器偏好（索引里的 activeChatId），可能为空。
  preferredChatId?: unknown
}

function normalizeId(value: unknown) {
  return String(value || '').trim()
}

// resolveSelectedChatId 返回「当前选中目标」。
//
// 来源映射：requested = 用户意图，loaded = 服务端已成立事实，
// preferred = 本地持久化投影。顺序由事实源优先级统一声明，不再手写 if。
export function resolveSelectedChatId(input: SessionSwitchTargetInput): string {
  const chosen = pickFactCandidate(
    [
      { source: 'user-intent' as const, value: normalizeId(input.requestedChatId) },
      { source: 'server-fact' as const, value: normalizeId(input.loadedChatId) },
      { source: 'local-projection' as const, value: normalizeId(input.preferredChatId) },
    ],
    (id) => !!id,
  )
  return chosen?.value || ''
}

// resolveLoadedChatId 返回「已加载正文所属会话」；未加载时为空串。
// 它是「正文是否就绪」的唯一事实源。
export function resolveLoadedChatId(activeChat: unknown): string {
  return normalizeId((activeChat as any)?.id)
}
