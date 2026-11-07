// 消息上的 token 计数展示口径：只做数字到人类可读文本的转换，不涉及任何取数。
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
