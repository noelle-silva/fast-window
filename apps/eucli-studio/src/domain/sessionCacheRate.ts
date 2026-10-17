// 会话级缓存率真值：客户端只读会话上的这个字段，直接显示最新真值；
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
