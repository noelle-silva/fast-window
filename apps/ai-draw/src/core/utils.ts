export function nowMs() {
  return Date.now()
}

export function id(prefix: string) {
  return `${prefix}-${nowMs()}-${Math.random().toString(16).slice(2)}`
}

export function trimSlash(input: any) {
  const s = String(input ?? '').trim()
  if (!s) return ''
  return s.endsWith('/') ? s.slice(0, -1) : s
}

export function isHttpBaseUrl(input: any) {
  const raw = String(input ?? '').trim()
  if (!raw) return false
  try {
    const u = new URL(raw)
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.host
  } catch {
    return false
  }
}

export function normalizeBatchCount(raw: any, maxBatchCount: number) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 1
  const v = Math.floor(n)
  if (v < 1) return 1
  if (v > maxBatchCount) return maxBatchCount
  return v
}

export function formatBytes(n: any) {
  const v = Number(n)
  if (!Number.isFinite(v) || v <= 0) return '0B'
  if (v < 1024) return `${Math.floor(v)}B`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)}KB`
  return `${(v / 1024 / 1024).toFixed(2)}MB`
}
