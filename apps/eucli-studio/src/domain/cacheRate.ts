// 缓存率真值：只挂在消息上（每条回复记它那一刻的命中率），客户端直接读；
// 拿不到真值时只显示问号，绝不按命中/未命中量重算或用旧值顶替。
export function normalizeCacheRate(input: unknown): number | null {
  if (typeof input !== 'number' || !Number.isFinite(input)) return null
  if (input < 0 || input > 1) return null
  return input
}

export function formatCacheRate(rate: number | null | undefined): string {
  const value = normalizeCacheRate(rate)
  if (value === null) return '?'
  const percent = value * 100
  const text = percent >= 100 ? '100' : percent.toFixed(1).replace(/\.0$/, '')
  return `${text}%`
}
