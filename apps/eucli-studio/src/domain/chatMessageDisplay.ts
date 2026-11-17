import { ASSISTANT_RUNNING_CONTENT, assistantRunGenerationId, isAssistantGenerating } from './assistantRunState'

export function messageVisibleText(message: any) {
  const raw = String(message?.content || '')
  if (String(message?.role || '') === 'assistant' && raw.trim() === ASSISTANT_RUNNING_CONTENT) return ''
  return raw
}

export function isStaleAssistantPlaceholder(message: any, hasActiveRun: boolean) {
  if (hasActiveRun) return false
  if (String(message?.role || '') !== 'assistant') return false
  if (String(message?.content || '').trim() !== ASSISTANT_RUNNING_CONTENT) return false
  if (Array.isArray(message?.parts) && message.parts.length) return false
  return !(message?.error && typeof message.error === 'object')
}

export function activeRunCardForAssistantMessage(cards: any[], message: any) {
  const mid = String(message?.id || '').trim()
  const generationId = assistantRunGenerationId(message)
  if (!mid && !generationId) return null
  return (Array.isArray(cards) ? cards : []).find((card: any) => String(card?.lastMessageId || '').trim() === mid || (generationId && String(card?.runId || '').trim() === generationId)) || null
}

// shouldShowActiveRunTailPending 是「尾部占位消息」的唯一判定点。
//
// 占位只在「确有活动运行卡、且列表里没有任何一条属于该运行的消息正在生成」时出现。
// 它必须完全由运行卡事实驱动：一旦运行卡收敛（终态被移除），占位立刻消失，
// 不存在任何「终态后仍靠消息自身状态维持占位」的第二条判据。
export function shouldShowActiveRunTailPending(
  latestCard: any,
  messages: any[],
  cardForMessage: (message: any) => any,
): boolean {
  if (!latestCard) return false
  const list = Array.isArray(messages) ? messages : []
  return !list.some((message: any) => !!cardForMessage(message) && isAssistantGenerating(message))
}

// resolveActiveRunTailAnchorMs 是尾部占位消息（等待首字）的计时锚点。
//
// 取「最后一条已落定消息的时间」与「本次运行卡创建时间」中的较晚者：
// 工具循环里最后一条是工具结果，新一轮等待从工具完成那一刻重新起算；
// 重新生成时最后一条是历史消息，锚点落回本次运行的开始；
// 两者都缺失时返回 0，由展示层用当下时刻兜底。
export function resolveActiveRunTailAnchorMs(messages: any[], latestCard: any): number {
  const list = Array.isArray(messages) ? messages : []
  const last = list.length ? list[list.length - 1] : null
  const lastAt = Number(last?.updatedAt || last?.createdAt || 0)
  const cardAt = Number(latestCard?.createdAt || latestCard?.updatedAt || 0)
  return Math.max(isFinite(lastAt) && lastAt > 0 ? lastAt : 0, isFinite(cardAt) && cardAt > 0 ? cardAt : 0)
}
