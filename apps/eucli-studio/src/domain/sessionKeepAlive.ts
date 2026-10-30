// 会话页面保活上限：虚拟化与屏外跳过把单页成本压下来后，可以多留几页。
export const SESSION_KEEP_ALIVE_LIMIT = 8
export const SESSION_KEEP_ALIVE_MIN_LIMIT = 1
export const SESSION_KEEP_ALIVE_MAX_LIMIT = 16

function normalizeKey(value: unknown) {
  return String(value || '').trim()
}

// 设置项归一：缺省/非法值回落默认上限，越界夹到允许区间。
export function normalizeSessionKeepAliveLimit(value: unknown) {
  const raw = Number(value)
  if (!isFinite(raw) || raw <= 0) return SESSION_KEEP_ALIVE_LIMIT
  return Math.min(SESSION_KEEP_ALIVE_MAX_LIMIT, Math.max(SESSION_KEEP_ALIVE_MIN_LIMIT, Math.floor(raw)))
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
//
// 两类页面必须保留，否则切换链路会断：
//   - key（新选中页）：丢掉它 → 新页永不进 pages → PAINTED 永不发出 → 永久卡在切换中；
//   - pinnedKey（当前可见页）：丢掉它 → 切换期间没有垫底页 → 白屏。
// 当上限小于「必须保留项」数量（例如 limit=1 且正在切换）时，允许临时超出上限：
// 这是有界的（最多 +1），下一次 touch（key 与 pinned 追平）即自动收敛回上限。
export function touchSessionKeepAliveOrder(
  order: readonly string[],
  sessionKey: unknown,
  limit = SESSION_KEEP_ALIVE_LIMIT,
  pinnedKey?: unknown,
): string[] {
  const max = normalizeSessionKeepAliveLimit(limit)
  const keys = normalizeOrder(order)
  const key = normalizeKey(sessionKey)
  const pinned = normalizeKey(pinnedKey)

  const next = key ? [key, ...keys.filter((item) => item !== key)] : keys.slice()
  if (pinned && !next.includes(pinned)) next.push(pinned)

  if (next.length <= max) return next

  const required = new Set<string>()
  if (key) required.add(key)
  if (pinned) required.add(pinned)

  const kept = next.slice(0, max)
  // 被裁掉的必须保留项，优先顶掉保留区里最后一个「非必须」项；
  // 若保留区已全被必须项占满（limit 小于必须项数量），才允许有界超出（最多 +1）。
  for (const item of next.slice(max)) {
    if (!required.has(item) || kept.includes(item)) continue
    let victim = -1
    for (let i = kept.length - 1; i >= 0; i--) {
      if (!required.has(kept[i])) {
        victim = i
        break
      }
    }
    if (victim >= 0) kept[victim] = item
    else kept.push(item)
  }
  return kept
}

export function sameSessionKeepAliveOrder(a: readonly string[], b: readonly string[]) {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}
