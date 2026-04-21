import type { HyperCortexMetadataV1, HyperCortexTabGroupV1, HyperCortexWorkspaceV1 } from '../core'
import { normalizeTabGroupByTabKey } from './tabGroups'

function normalizeTitle(current: string, patch: unknown): string {
  if (typeof patch !== 'string') return current
  const next = patch.trim()
  return next || current
}

export function normalizeOpenTabKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    const key = typeof item === 'string' ? item.trim() : ''
    if (!key) continue
    if (out.includes(key)) continue
    out.push(key)
  }
  return out
}

export type ActiveWorkspacePatch = Partial<Pick<HyperCortexWorkspaceV1, 'title' | 'openTabKeys' | 'activeTabKey' | 'tabGroups' | 'tabGroupByTabKey'>>

export function applyActiveWorkspacePatch(current: HyperCortexWorkspaceV1, patch: ActiveWorkspacePatch): HyperCortexWorkspaceV1 {
  const nextTitle = normalizeTitle(current.title, patch.title)
  const openTabKeys = 'openTabKeys' in patch ? normalizeOpenTabKeys(patch.openTabKeys) : current.openTabKeys
  const tabGroups = 'tabGroups' in patch && Array.isArray(patch.tabGroups) ? (patch.tabGroups as HyperCortexTabGroupV1[]) : current.tabGroups
  const tabGroupByTabKey = 'tabGroupByTabKey' in patch ? normalizeTabGroupByTabKey(patch.tabGroupByTabKey) : current.tabGroupByTabKey
  const activeTabKey = 'activeTabKey' in patch && typeof patch.activeTabKey === 'string' ? patch.activeTabKey.trim() : current.activeTabKey

  if (
    nextTitle === current.title &&
    openTabKeys === current.openTabKeys &&
    tabGroups === current.tabGroups &&
    tabGroupByTabKey === current.tabGroupByTabKey &&
    activeTabKey === current.activeTabKey
  ) {
    return current
  }

  return { ...current, ...patch, title: nextTitle, openTabKeys, tabGroups, tabGroupByTabKey, activeTabKey }
}

export function buildWorkspacesMetadataSnapshot(workspaces: HyperCortexWorkspaceV1[], activeWorkspaceId: string): Partial<HyperCortexMetadataV1> {
  const wid = String(activeWorkspaceId || '').trim()
  const activeWs = workspaces.find(w => w.id === wid) || workspaces[0]
  if (!activeWs) return { workspaces, activeWorkspaceId: wid }
  return {
    workspaces,
    activeWorkspaceId: wid || activeWs.id,
    openTabKeys: activeWs.openTabKeys,
    activeTabKey: activeWs.activeTabKey,
    tabGroups: activeWs.tabGroups,
    tabGroupByTabKey: activeWs.tabGroupByTabKey,
  }
}
