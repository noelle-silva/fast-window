import type { HyperCortexTabGroupV1, HyperCortexWorkspaceV1 } from '../core'
import { normalizeTabGroupByNoteId, normalizeTabGroups } from './tabGroups'

function normalizeOpenNoteIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    const id = typeof item === 'string' ? item.trim() : ''
    if (!id) continue
    if (out.includes(id)) continue
    out.push(id)
  }
  return out
}

export function createWorkspaceId(): string {
  const anyCrypto = globalThis.crypto as any
  if (anyCrypto && typeof anyCrypto.randomUUID === 'function') return anyCrypto.randomUUID()
  return `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function pickNextWorkspaceTitle(workspaces: { title: string }[]): string {
  const used = new Set(workspaces.map(w => String(w.title || '').trim()).filter(Boolean))
  for (let i = 1; i <= 999; i++) {
    const name = `工作区 ${i}`
    if (!used.has(name)) return name
  }
  return '工作区'
}

export function normalizeWorkspaces(
  value: unknown,
  fallback?: { openNoteIds?: unknown; tabGroups?: unknown; tabGroupByNoteId?: unknown },
): HyperCortexWorkspaceV1[] {
  if (Array.isArray(value)) {
    const out: HyperCortexWorkspaceV1[] = []
    const seen = new Set<string>()
    for (const item of value) {
      if (!item || typeof item !== 'object') continue
      const raw = item as any
      const id = typeof raw.id === 'string' ? raw.id.trim() : ''
      if (!id || seen.has(id)) continue
      const title = typeof raw.title === 'string' ? raw.title.trim() : ''
      const openNoteIds = normalizeOpenNoteIds(raw.openNoteIds)
      const tabGroups = normalizeTabGroups(raw.tabGroups)
      const tabGroupByNoteId = normalizeTabGroupByNoteId(raw.tabGroupByNoteId)
      out.push({
        id,
        title: title || '工作区',
        openNoteIds,
        tabGroups,
        tabGroupByNoteId,
      })
      seen.add(id)
    }
    if (out.length) return out
  }

  const id = createWorkspaceId()
  const openNoteIds = normalizeOpenNoteIds(fallback?.openNoteIds)
  const tabGroups = normalizeTabGroups(fallback?.tabGroups)
  const tabGroupByNoteId = normalizeTabGroupByNoteId(fallback?.tabGroupByNoteId)
  return [
    {
      id,
      title: '默认工作区',
      openNoteIds,
      tabGroups,
      tabGroupByNoteId,
    },
  ]
}

export function normalizeActiveWorkspaceId(value: unknown, workspaces: HyperCortexWorkspaceV1[]): string {
  const id = typeof value === 'string' ? value.trim() : ''
  if (id && workspaces.some(w => w.id === id)) return id
  return workspaces[0]?.id || ''
}

export function updateWorkspaceById(
  workspaces: HyperCortexWorkspaceV1[],
  workspaceId: string,
  updater: (ws: HyperCortexWorkspaceV1) => HyperCortexWorkspaceV1,
): HyperCortexWorkspaceV1[] {
  const wid = String(workspaceId || '').trim()
  if (!wid) return workspaces
  const idx = workspaces.findIndex(w => w.id === wid)
  if (idx < 0) return workspaces
  const nextWs = updater(workspaces[idx])
  if (nextWs === workspaces[idx]) return workspaces
  const next = workspaces.slice()
  next[idx] = nextWs
  return next
}

export function ensureWorkspaceShape(ws: HyperCortexWorkspaceV1): HyperCortexWorkspaceV1 {
  const id = String(ws.id || '').trim() || createWorkspaceId()
  const title = String(ws.title || '').trim() || '工作区'
  const openNoteIds = normalizeOpenNoteIds(ws.openNoteIds)
  const tabGroups: HyperCortexTabGroupV1[] = normalizeTabGroups(ws.tabGroups)
  const tabGroupByNoteId = normalizeTabGroupByNoteId(ws.tabGroupByNoteId)
  return { id, title, openNoteIds, tabGroups, tabGroupByNoteId }
}

