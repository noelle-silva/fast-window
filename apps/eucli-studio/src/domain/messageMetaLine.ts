// 消息元信息行：AI 回复在操作栏左侧并排展示「缓存率 · 上下文 · 时间 · 耗时」。
// 缓存率与上下文缺上游真值时显示问号，占位保持稳定；时间与耗时缺数据时不占位。

import { formatTokenEstimateShort } from './messageTokenUsage'
import { formatCacheRate, normalizeCacheRate } from './sessionCacheRate'

export type MessageMetaLineInput = {
  cacheRate: unknown
  contextTokens: unknown
  timeText: string
  durationText: string
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

// formatContextTokens 把本轮输入上下文规模按 K 口径展示；非正数表示没有真值，显示问号。
export function formatContextTokens(input: unknown): string {
  const tokens = Math.floor(Number(input || 0))
  if (!Number.isFinite(tokens) || tokens <= 0) return '?'
  return formatTokenEstimateShort(tokens)
}
