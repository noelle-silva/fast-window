import { DEFAULT_SETTINGS } from './constants'
import type {
  ClipboardHistoryItem,
  ClipboardHistorySettings,
  ClipboardMonitorSnapshot,
  DeletedHistoryMap,
  InternalCopyMarker,
} from './types'

export function nowId(now = new Date()): string {
  const pad = (n: number, w: number) => String(n).padStart(w, '0')
  return (
    pad(now.getFullYear(), 4) +
    pad(now.getMonth() + 1, 2) +
    pad(now.getDate(), 2) +
    '-' +
    pad(now.getHours(), 2) +
    pad(now.getMinutes(), 2) +
    pad(now.getSeconds(), 2)
  )
}

export function historyUniqKey(item: Pick<ClipboardHistoryItem, 'type' | 'content'>): string {
  return `${item.type}\n${item.content}`
}

export function normalizeDeletedMap(raw: unknown, nowMs = Date.now()): DeletedHistoryMap {
  const map = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const out: DeletedHistoryMap = {}
  const maxAgeMs = 30 * 24 * 60 * 60 * 1000
  const cutoff = nowMs - maxAgeMs
  for (const k of Object.keys(map)) {
    const v = Number(map[k])
    if (!Number.isFinite(v) || v <= 0) continue
    if (v < cutoff) continue
    out[String(k)] = Math.floor(v)
  }
  const items = Object.entries(out).sort((a, b) => Number(b[1]) - Number(a[1]))
  if (items.length <= 800) return out
  const pruned: DeletedHistoryMap = {}
  for (const [k, v] of items.slice(0, 800)) pruned[k] = v
  return pruned
}

export function isDeleted(item: ClipboardHistoryItem, deleted: DeletedHistoryMap, nowMs = Date.now()): boolean {
  const normalizedDeleted = normalizeDeletedMap(deleted, nowMs)
  const deletedAt = Number(normalizedDeleted[historyUniqKey(item)] || 0)
  if (!deletedAt) return false
  const t = Number(item && item.time ? item.time : 0)
  return Number.isFinite(t) && t > 0 ? t <= deletedAt : true
}

export function normalizeSettings(raw: unknown): ClipboardHistorySettings {
  const merged = raw && typeof raw === 'object' ? { ...DEFAULT_SETTINGS, ...(raw as Record<string, unknown>) } : { ...DEFAULT_SETTINGS }
  const pollRaw = Number(merged.pollInterval)
  const maxRaw = Number(merged.maxHistory)
  const collapseRaw = Number(merged.collapseLines)
  return {
    autoMonitor: merged.autoMonitor !== false,
    pollInterval: Math.min(15000, Math.max(200, Number.isFinite(pollRaw) ? Math.floor(pollRaw) : DEFAULT_SETTINGS.pollInterval)),
    maxHistory: Math.min(1000, Math.max(10, Number.isFinite(maxRaw) ? Math.floor(maxRaw) : DEFAULT_SETTINGS.maxHistory)),
    collapseLines: Math.min(50, Math.max(1, Number.isFinite(collapseRaw) ? Math.floor(collapseRaw) : DEFAULT_SETTINGS.collapseLines)),
  }
}

export function normalizeHistoryItem(raw: unknown, nowMs = Date.now()): ClipboardHistoryItem | null {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  const type = obj && obj.type === 'image' ? 'image' : 'text'
  const content = String(obj && obj.content ? obj.content : '').trim()
  if (!content) return null
  const timeRaw = Number(obj && obj.time)
  const path = type === 'image' && obj && typeof obj.path === 'string' ? String(obj.path).trim() : ''
  const out: ClipboardHistoryItem = {
    type,
    content,
    time: Number.isFinite(timeRaw) && timeRaw > 0 ? Math.floor(timeRaw) : nowMs,
  }
  if (type === 'image' && path) out.path = path
  return out
}

export function normalizeHistoryItems(raw: unknown, limit: number, nowMs = Date.now()): ClipboardHistoryItem[] {
  const list = Array.isArray(raw) ? raw : []
  const out: ClipboardHistoryItem[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const normalized = normalizeHistoryItem(item, nowMs)
    if (!normalized) continue
    const key = historyUniqKey(normalized)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(normalized)
    if (out.length >= limit) break
  }
  return out
}

export function mergeHistoryItems(primary: unknown, secondary: unknown, limit: number, nowMs = Date.now()): ClipboardHistoryItem[] {
  const map = new Map<string, ClipboardHistoryItem>()
  const merged = [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])]
  for (const item of merged) {
    const normalized = normalizeHistoryItem(item, nowMs)
    if (!normalized) continue
    const key = historyUniqKey(normalized)
    const prev = map.get(key)
    if (!prev || normalized.time > prev.time) map.set(key, normalized)
  }
  return Array.from(map.values()).sort((a, b) => b.time - a.time).slice(0, limit)
}

export function isSameHistory(a: unknown, b: unknown): boolean {
  const listA = Array.isArray(a) ? a : []
  const listB = Array.isArray(b) ? b : []
  if (listA.length !== listB.length) return false
  for (let i = 0; i < listA.length; i++) {
    const left = listA[i]
    const right = listB[i]
    if (!left || !right) return false
    if (left.type !== right.type || left.content !== right.content || left.time !== right.time) return false
    if (left.type === 'image' && String(left.path || '') !== String(right.path || '')) return false
  }
  return true
}

export function normalizeHostSnapshotItems(result: ClipboardMonitorSnapshot | unknown, limit: number): ClipboardHistoryItem[] {
  const snapshot = result && typeof result === 'object' ? (result as ClipboardMonitorSnapshot) : {}
  const latest = normalizeHistoryItem(snapshot.latest)
  const items = normalizeHistoryItems(snapshot.items, limit)
  return latest ? mergeHistoryItems([latest], items, limit) : items
}

export function internalCopyWindowMs(pollInterval: number): number {
  return Math.max(1500, pollInterval * 2)
}

export function createInternalCopyMarker(type: 'text' | 'image', content: string, nowMs = Date.now()): InternalCopyMarker {
  return { type, content, at: nowMs }
}

export function createEmptyInternalCopyMarker(): InternalCopyMarker {
  return { type: '', content: '', at: 0 }
}

export function isWithinInternalCopyWindow(marker: InternalCopyMarker, pollInterval: number, nowMs = Date.now()): boolean {
  return Boolean(marker.at && nowMs - marker.at < internalCopyWindowMs(pollInterval))
}
