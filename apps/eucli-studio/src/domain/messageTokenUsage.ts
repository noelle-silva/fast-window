// 会话级用量真值：客户端显示的数字只来自会话上的这个字段，直接显示最新真值，
// 不再对各消息求和或加工；拿不到真值时只显示问号，绝不用推算值顶替。
export type TokenUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

function tokenCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const floored = Math.max(0, Math.floor(value))
  return floored
}

// normalizeTokenUsage 归一上游带回的用量真值：只认数值项，缺失项留空，全空即未知。
export function normalizeTokenUsage(input: any): TokenUsage | null {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : null
  if (!raw) return null
  const out: TokenUsage = {}
  const inputTokens = tokenCount(raw.inputTokens)
  const outputTokens = tokenCount(raw.outputTokens)
  const totalTokens = tokenCount(raw.totalTokens)
  if (inputTokens !== undefined) out.inputTokens = inputTokens
  if (outputTokens !== undefined) out.outputTokens = outputTokens
  if (totalTokens !== undefined) out.totalTokens = totalTokens
  if (out.inputTokens === undefined && out.outputTokens === undefined && out.totalTokens === undefined) return null
  return out
}

// tokenUsageTotal 取展示用的总量：上游给了总量就用总量，否则用输入与输出之和；全空即未知。
export function tokenUsageTotal(usage: TokenUsage | null | undefined): number | null {
  if (!usage) return null
  if (typeof usage.totalTokens === 'number') return usage.totalTokens
  if (typeof usage.inputTokens === 'number' || typeof usage.outputTokens === 'number') {
    return (usage.inputTokens || 0) + (usage.outputTokens || 0)
  }
  return null
}

export function formatTokenUsage(usage: TokenUsage | null | undefined) {
  const total = tokenUsageTotal(usage)
  if (total === null) return '?'
  return formatTokenEstimate(total)
}

export function formatTokenUsageShort(usage: TokenUsage | null | undefined) {
  const total = tokenUsageTotal(usage)
  if (total === null) return '?'
  return formatTokenEstimateShort(total)
}

export function formatTokenEstimate(tokens: number) {
  const value = Math.max(0, Math.floor(Number(tokens || 0)))
  if (!Number.isFinite(value) || value <= 0) return '0 tokens'
  if (value < 1000) return `${value} tokens`
  const scaled = value / 1000
  const text = scaled >= 10 ? Math.round(scaled).toString() : scaled.toFixed(1).replace(/\.0$/, '')
  return `${text}k tokens`
}

export function formatTokenEstimateShort(tokens: number) {
  const value = Math.max(0, Math.floor(Number(tokens || 0)))
  if (!Number.isFinite(value) || value <= 0) return '0k'

  const scaled = value / 1000
  const text = scaled >= 10 ? Math.round(scaled).toString() : scaled.toFixed(1).replace(/\.0$/, '')
  return `${text}k`
}
