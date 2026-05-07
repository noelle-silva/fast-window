import type { ClipboardHistoryItem, ClipboardHistorySettings } from '../shared/types'

export function nowMs(): number {
  return Date.now()
}

export function formatTime(ts: number): string {
  try {
    const d = new Date(ts)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return ''
  }
}

function hash32Sampled(raw: unknown): string {
  const str = String(raw || '')
  const sample = str.length > 4096 ? str.slice(0, 2048) + str.slice(-2048) : str
  let h = 5381
  for (let i = 0; i < sample.length; i++) {
    h = ((h << 5) + h) ^ sample.charCodeAt(i)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function historyKey(item: Pick<ClipboardHistoryItem, 'type' | 'content'>): string {
  const type = item?.type ? String(item.type) : 'text'
  const content = item?.content ? String(item.content) : ''
  return `hist:${type}:${hash32Sampled(content)}`
}

export function shouldShowFoldButton(content: unknown, settings: ClipboardHistorySettings): boolean {
  const text = String(content || '')
  const lines = text.split(/\r?\n/).length
  const collapseLines = Math.max(1, Number(settings.collapseLines) || 6)
  return lines > collapseLines || text.length > collapseLines * 90
}

export function isDeleteArmed(deleteArmedId: string, deleteArmedAt: number, id: string): boolean {
  return deleteArmedId === id && !!deleteArmedAt && nowMs() - deleteArmedAt < 2500
}

export function formatError(error: unknown, fallback: string): string {
  return String((error as any)?.message || error || fallback)
}
