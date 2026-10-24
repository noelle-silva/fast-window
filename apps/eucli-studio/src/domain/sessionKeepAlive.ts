export const SESSION_KEEP_ALIVE_LIMIT = 5

function normalizeKey(value: unknown) {
  return String(value || '').trim()
}

function normalizeLimit(value: unknown) {
  return Math.max(1, Math.floor(Number(value) || SESSION_KEEP_ALIVE_LIMIT))
}

function normalizeOrder(order: readonly string[]) {
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(order) ? order : []) {
    const key = normalizeKey(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

// 会话页面常驻顺序：最近打开的在前，超出上限时淘汰尾部（最久没用）。
export function touchSessionKeepAliveOrder(
  order: readonly string[],
  sessionKey: unknown,
  limit = SESSION_KEEP_ALIVE_LIMIT,
): string[] {
  const max = normalizeLimit(limit)
  const keys = normalizeOrder(order)
  const key = normalizeKey(sessionKey)
  if (!key) return keys.slice(0, max)
  return [key, ...keys.filter((item) => item !== key)].slice(0, max)
}

export function sameSessionKeepAliveOrder(a: readonly string[], b: readonly string[]) {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}
