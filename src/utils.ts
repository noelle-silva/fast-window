import type { Plugin } from './constants'

export function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id)
}

export function normalizeCapabilityList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const it of value) {
    const s = String(it || '').trim()
    if (s) out.push(s)
  }
  out.sort()
  const uniq: string[] = []
  for (const s of out) {
    if (uniq.length === 0 || uniq[uniq.length - 1] !== s) uniq.push(s)
  }
  return uniq
}

export function normalizeBrowseLayout(value: unknown): import('./constants').PluginBrowseLayout {
  if (value === 'grid') return 'grid'
  if (value === 'icon') return 'icon'
  return 'list'
}

export function isDataImageUrl(value: string): boolean {
  return value.startsWith('data:image/')
}

export function normalizeOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) ids.push(item)
  }
  return ids
}

export function normalizeDisabledPlugins(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) ids.push(item)
  }
  return ids
}

export function applyPluginOrder(list: Plugin[], orderIds: string[]): Plugin[] {
  if (!orderIds.length) return list

  const byId = new Map(list.map(p => [p.id, p]))
  const result: Plugin[] = []
  for (const id of orderIds) {
    const hit = byId.get(id)
    if (hit) {
      result.push(hit)
      byId.delete(id)
    }
  }
  for (const p of list) {
    if (byId.has(p.id)) result.push(p)
  }
  return result
}

export function movePluginById(list: Plugin[], draggedId: string, targetId: string, dropAfter: boolean): Plugin[] {
  if (!draggedId || !targetId || draggedId === targetId) return list
  const fromIndex = list.findIndex(p => p.id === draggedId)
  const toIndex = list.findIndex(p => p.id === targetId)
  if (fromIndex < 0 || toIndex < 0) return list

  const next = list.slice()
  const [item] = next.splice(fromIndex, 1)
  let insertIndex = toIndex + (dropAfter ? 1 : 0)
  if (fromIndex < insertIndex) insertIndex -= 1
  if (insertIndex < 0) insertIndex = 0
  if (insertIndex > next.length) insertIndex = next.length
  next.splice(insertIndex, 0, item)
  return next
}
