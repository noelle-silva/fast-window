import type { HyperCortexMetadataV1, HyperCortexSidebarItemV1, HyperCortexTabGroupV1, HyperCortexWorkspaceV1 } from '../core'
import { normalizeTabGroupByTabKey } from './tabGroups'
import { deriveSidebarFields, normalizeSidebarItems } from './sidebarModel'

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

export type ActiveWorkspacePatch = Partial<Pick<HyperCortexWorkspaceV1, 'title' | 'sidebarItems' | 'openTabKeys' | 'activeTabKey' | 'tabGroups' | 'tabGroupByTabKey'>>

export function applyActiveWorkspacePatch(current: HyperCortexWorkspaceV1, patch: ActiveWorkspacePatch): HyperCortexWorkspaceV1 {
  const nextTitle = normalizeTitle(current.title, patch.title)
  const sidebarItems = 'sidebarItems' in patch ? normalizeSidebarItems(patch.sidebarItems as HyperCortexSidebarItemV1[]) : current.sidebarItems
  const derivedFromSidebar = deriveSidebarFields(sidebarItems)
  const openTabKeys = 'openTabKeys' in patch ? normalizeOpenTabKeys(patch.openTabKeys) : derivedFromSidebar.openTabKeys
  const tabGroups = 'tabGroups' in patch && Array.isArray(patch.tabGroups) ? (patch.tabGroups as HyperCortexTabGroupV1[]) : derivedFromSidebar.tabGroups
  const tabGroupByTabKey = 'tabGroupByTabKey' in patch ? normalizeTabGroupByTabKey(patch.tabGroupByTabKey) : derivedFromSidebar.tabGroupByTabKey
  const activeTabKey = 'activeTabKey' in patch && typeof patch.activeTabKey === 'string' ? patch.activeTabKey.trim() : current.activeTabKey

  if (
    nextTitle === current.title &&
    sidebarItems === current.sidebarItems &&
    openTabKeys === current.openTabKeys &&
    tabGroups === current.tabGroups &&
    tabGroupByTabKey === current.tabGroupByTabKey &&
    activeTabKey === current.activeTabKey
  ) {
    return current
  }

  return { ...current, ...patch, title: nextTitle, sidebarItems, openTabKeys, tabGroups, tabGroupByTabKey, activeTabKey }
}

export function buildWorkspacesMetadataSnapshot(workspaces: HyperCortexWorkspaceV1[], activeWorkspaceId: string): Partial<HyperCortexMetadataV1> {
  const wid = String(activeWorkspaceId || '').trim()
  const activeWs = workspaces.find(w => w.id === wid) || workspaces[0]
  if (!activeWs) return { workspaces, activeWorkspaceId: wid }
  return {
    workspaces,
    activeWorkspaceId: wid || activeWs.id,
    sidebarItems: activeWs.sidebarItems,
    openTabKeys: activeWs.openTabKeys,
    activeTabKey: activeWs.activeTabKey,
    tabGroups: activeWs.tabGroups,
    tabGroupByTabKey: activeWs.tabGroupByTabKey,
  }
}
