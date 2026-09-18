export function messageTokenEstimate(message: any) {
  const value = Math.max(0, Math.floor(Number(message?.tokenEstimate || 0)))
  return Number.isFinite(value) ? value : 0
}

export function sumMessageTokenEstimate(messages: any[]) {
  const list = Array.isArray(messages) ? messages : []
  let total = 0
  for (const message of list) total += messageTokenEstimate(message)
  return total
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
