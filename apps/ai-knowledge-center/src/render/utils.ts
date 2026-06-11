export function now() {
  return Date.now()
}

export function uid(prefix: string) {
  return `${prefix}_${now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

export function esc(s: unknown) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c])
}
