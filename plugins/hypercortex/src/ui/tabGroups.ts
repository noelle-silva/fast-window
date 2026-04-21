import type { HyperCortexTabGroupV1 } from '../core'

export const TAB_GROUP_PRESET_COLORS: string[] = [
  'hsl(0, 28%, 88%)',
  'hsl(18, 28%, 88%)',
  'hsl(36, 28%, 88%)',
  'hsl(54, 28%, 88%)',
  'hsl(72, 28%, 88%)',
  'hsl(90, 28%, 88%)',
  'hsl(108, 28%, 88%)',
  'hsl(126, 28%, 88%)',
  'hsl(144, 28%, 88%)',
  'hsl(162, 28%, 88%)',
  'hsl(180, 28%, 88%)',
  'hsl(198, 28%, 88%)',
  'hsl(216, 28%, 88%)',
  'hsl(234, 28%, 88%)',
  'hsl(252, 28%, 88%)',
  'hsl(270, 28%, 88%)',
  'hsl(288, 28%, 88%)',
  'hsl(306, 28%, 88%)',
  'hsl(324, 28%, 88%)',
  'hsl(342, 28%, 88%)',
]

export function createTabGroupId(): string {
  const anyCrypto = globalThis.crypto as any
  if (anyCrypto && typeof anyCrypto.randomUUID === 'function') return anyCrypto.randomUUID()
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function pickNextTabGroupColor(groups: HyperCortexTabGroupV1[]): string {
  const used = new Set(groups.map(g => String(g.color || '').trim()).filter(Boolean))
  for (const c of TAB_GROUP_PRESET_COLORS) {
    if (!used.has(c)) return c
  }
  return TAB_GROUP_PRESET_COLORS[Math.max(0, groups.length) % TAB_GROUP_PRESET_COLORS.length] || 'hsl(210, 28%, 88%)'
}

export function pickNextTabGroupTitle(groups: HyperCortexTabGroupV1[]): string {
  const used = new Set(groups.map(g => String(g.title || '').trim()).filter(Boolean))
  for (let i = 1; i <= 999; i++) {
    const name = `分组 ${i}`
    if (!used.has(name)) return name
  }
  return '分组'
}

export function normalizeTabGroups(value: unknown): HyperCortexTabGroupV1[] {
  if (!Array.isArray(value)) return []
  const out: HyperCortexTabGroupV1[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = item as any
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    if (!id || seen.has(id)) continue
    const title = typeof raw.title === 'string' ? raw.title.trim() : ''
    const color = typeof raw.color === 'string' ? raw.color.trim() : ''
    out.push({ id, title: title || '分组', color: color || 'hsl(210, 28%, 88%)', collapsed: raw.collapsed === true })
    seen.add(id)
  }
  return out
}

export function normalizeTabGroupByNoteId(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as any)) {
    const noteId = typeof k === 'string' ? k.trim() : ''
    const groupId = typeof v === 'string' ? v.trim() : ''
    if (!noteId || !groupId) continue
    out[noteId] = groupId
  }
  return out
}

export function normalizeTabGroupByTabKey(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as any)) {
    const tabKey = typeof k === 'string' ? k.trim() : ''
    const groupId = typeof v === 'string' ? v.trim() : ''
    if (!tabKey || !groupId) continue
    out[tabKey] = groupId
  }
  return out
}
