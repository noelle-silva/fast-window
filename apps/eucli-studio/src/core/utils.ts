export function now() {
  return Date.now()
}

export function uid(prefix: string) {
  return `${prefix}_${now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

export function esc(s: unknown) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c])
}

export function trimSlash(s: unknown) {
  return String(s || '').replace(/\/+$/g, '')
}

export function isHttpBaseUrl(s: unknown) {
  const t = String(s || '').trim().toLowerCase()
  return t.startsWith('http://') || t.startsWith('https://')
}

export function clampTemp(v: unknown) {
  const n = Number(v)
  if (!isFinite(n)) return 0.7
  return Math.max(0, Math.min(2, n))
}

export function normImagePaths(v: unknown, maxCount = 8) {
  const list = Array.isArray(v) ? v : []
  const out: string[] = []
  for (const x of list) {
    const s = typeof x === 'string' ? x.trim() : ''
    if (!s) continue
    if (s.length > 4096) continue
    out.push(s)
    if (out.length >= maxCount) break
  }
  return out
}

export function clamp(n: unknown, a: number, b: number) {
  const x = Number(n)
  if (!isFinite(x)) return a
  return Math.max(a, Math.min(b, x))
}

