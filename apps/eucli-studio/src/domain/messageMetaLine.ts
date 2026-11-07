// 消息元信息行：操作栏左侧并排展示上下文与时间。
// 用户消息是「上下文 · 时间」——发出去那一刻模型读到的规模；
// AI 回复是「缓存率 · 上下文 · 时间 · 耗时」——回复之后上下文到达的规模。
// 上下文缺上游真值时显示问号，占位保持稳定；时间与耗时缺数据时不占位。

import { formatTokenEstimateShort } from './messageTokenUsage'
import { formatCacheRate, normalizeCacheRate } from './sessionCacheRate'

export type MessageMetaLineInput = {
  cacheRate: unknown
  contextTokens: unknown
  timeText: string
  durationText: string
}

export type UserMessageMetaLineInput = {
  contextTokens: unknown
  timeText: string
}

export function buildUserMetaLine(input: UserMessageMetaLineInput): string {
  return [formatContextTokens(input.contextTokens), input.timeText].filter(Boolean).join(' · ')
}

export function buildAssistantMetaLine(input: MessageMetaLineInput): string {
  return [
    formatCacheRate(normalizeCacheRate(input.cacheRate)),
    formatContextTokens(input.contextTokens),
    input.timeText,
    input.durationText,
  ]
    .filter(Boolean)
    .join(' · ')
}

// formatContextTokens 把上下文规模按 K 口径展示；非正数表示没有真值，显示问号。
export function formatContextTokens(input: unknown): string {
  const tokens = Math.floor(Number(input || 0))
  if (!Number.isFinite(tokens) || tokens <= 0) return '?'
  return formatTokenEstimateShort(tokens)
}
