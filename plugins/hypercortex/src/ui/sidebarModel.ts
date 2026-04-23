import type { HyperCortexSidebarItemV1, HyperCortexTabGroupV1, HyperCortexWorkspaceV1 } from '../core'

export type SidebarTabItem = { type: 'tab'; tabKey: string }
export type SidebarGroupItem = {
  type: 'group'
  id: string
  title: string
  color: string
  collapsed?: boolean
  tabKeys: string[]
}
export type SidebarItem = SidebarTabItem | SidebarGroupItem

export function normalizeSidebarItems(value: unknown): SidebarItem[] {
  if (!Array.isArray(value)) return []
  const out: SidebarItem[] = []
  const seenTabs = new Set<string>()
  const seenGroups = new Set<string>()

  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = item as any
    const type = String(raw.type || '').trim()

    if (type === 'tab') {
      const tabKey = String(raw.tabKey || '').trim()
      if (!tabKey || seenTabs.has(tabKey)) continue
      seenTabs.add(tabKey)
      out.push({ type: 'tab', tabKey })
      continue
    }

    if (type === 'group') {
      const id = String(raw.id || '').trim()
      if (!id || seenGroups.has(id)) continue
      const title = String(raw.title || '').trim() || '分组'
      const color = String(raw.color || '').trim() || 'hsl(210, 28%, 88%)'
      const tabKeysRaw = Array.isArray(raw.tabKeys) ? raw.tabKeys : []
      const tabKeys: string[] = []
      for (const entry of tabKeysRaw) {
        const tabKey = typeof entry === 'string' ? entry.trim() : ''
        if (!tabKey || seenTabs.has(tabKey)) continue
        seenTabs.add(tabKey)
        tabKeys.push(tabKey)
      }
      seenGroups.add(id)
      out.push({ type: 'group', id, title, color, collapsed: raw.collapsed === true, tabKeys })
    }
  }

  return out
}

export function deriveSidebarFields(sidebarItems: SidebarItem[]): Pick<HyperCortexWorkspaceV1, 'openTabKeys' | 'tabGroups' | 'tabGroupByTabKey'> {
  const openTabKeys: string[] = []
  const tabGroups: HyperCortexTabGroupV1[] = []
  const tabGroupByTabKey: Record<string, string> = {}

  for (const item of sidebarItems) {
    if (item.type === 'tab') {
      openTabKeys.push(item.tabKey)
      continue
    }

    tabGroups.push({ id: item.id, title: item.title, color: item.color, collapsed: item.collapsed === true })
    for (const tabKey of item.tabKeys) {
      openTabKeys.push(tabKey)
      tabGroupByTabKey[tabKey] = item.id
    }
  }

  return { openTabKeys, tabGroups, tabGroupByTabKey }
}

export function buildSidebarItemsFromLegacy(params: {
  openTabKeys: string[]
  tabGroups: HyperCortexTabGroupV1[]
  tabGroupByTabKey: Record<string, string>
}): SidebarItem[] {
  const openTabKeys = Array.isArray(params.openTabKeys) ? params.openTabKeys : []
  const groupById: Record<string, HyperCortexTabGroupV1> = {}
  for (const group of params.tabGroups || []) {
    const id = String(group?.id || '').trim()
    if (!id || groupById[id]) continue
    groupById[id] = group
  }

  const groupedTabs: Record<string, string[]> = {}
  const ungrouped: string[] = []
  for (const rawKey of openTabKeys) {
    const tabKey = String(rawKey || '').trim()
    if (!tabKey) continue
    const gid = String(params.tabGroupByTabKey?.[tabKey] || '').trim()
    if (gid && groupById[gid]) {
      ;(groupedTabs[gid] || (groupedTabs[gid] = [])).push(tabKey)
      continue
    }
    ungrouped.push(tabKey)
  }

  const items: SidebarItem[] = []
  for (const tabKey of ungrouped) items.push({ type: 'tab', tabKey })
  for (const group of params.tabGroups || []) {
    const id = String(group?.id || '').trim()
    if (!id) continue
    items.push({
      type: 'group',
      id,
      title: String(group.title || '').trim() || '分组',
      color: String(group.color || '').trim() || 'hsl(210, 28%, 88%)',
      collapsed: group.collapsed === true,
      tabKeys: groupedTabs[id] || [],
    })
  }
  return items
}

export function ensureSidebarItems(workspace: Pick<HyperCortexWorkspaceV1, 'sidebarItems' | 'openTabKeys' | 'tabGroups' | 'tabGroupByTabKey'>): SidebarItem[] {
  const fromSidebar = normalizeSidebarItems((workspace as any).sidebarItems)
  if (fromSidebar.length) return fromSidebar
  return buildSidebarItemsFromLegacy({
    openTabKeys: Array.isArray(workspace.openTabKeys) ? workspace.openTabKeys : [],
    tabGroups: Array.isArray(workspace.tabGroups) ? workspace.tabGroups : [],
    tabGroupByTabKey: workspace.tabGroupByTabKey || {},
  })
}

export function applySidebarItemsToWorkspace(workspace: HyperCortexWorkspaceV1, sidebarItems: SidebarItem[]): HyperCortexWorkspaceV1 {
  const normalizedSidebarItems = normalizeSidebarItems(sidebarItems as HyperCortexSidebarItemV1[])
  const derived = deriveSidebarFields(normalizedSidebarItems)
  return {
    ...workspace,
    sidebarItems: normalizedSidebarItems,
    openTabKeys: derived.openTabKeys,
    tabGroups: derived.tabGroups,
    tabGroupByTabKey: derived.tabGroupByTabKey,
  }
}

function cloneItems(sidebarItems: SidebarItem[]): SidebarItem[] {
  return sidebarItems.map(item => (item.type === 'tab' ? { ...item } : { ...item, tabKeys: item.tabKeys.slice() }))
}

function removeTabFromGroups(sidebarItems: SidebarItem[], tabKey: string): void {
  for (const item of sidebarItems) {
    if (item.type !== 'group') continue
    const idx = item.tabKeys.indexOf(tabKey)
    if (idx < 0) continue
    item.tabKeys.splice(idx, 1)
    return
  }
}

export function insertTabAsUngrouped(sidebarItems: SidebarItem[], tabKey: string, index: number): SidebarItem[] {
  const next = cloneItems(sidebarItems)
  const normalizedTabKey = String(tabKey || '').trim()
  if (!normalizedTabKey) return next

  removeTabFromGroups(next, normalizedTabKey)
  const existingIdx = next.findIndex(item => item.type === 'tab' && item.tabKey === normalizedTabKey)
  if (existingIdx >= 0) next.splice(existingIdx, 1)

  const insertIndex = Math.max(0, Math.min(index, next.length))
  next.splice(insertIndex, 0, { type: 'tab', tabKey: normalizedTabKey })
  return next
}

export function moveTabBetweenGroups(params: {
  sidebarItems: SidebarItem[]
  tabKey: string
  targetGroupId: string
  targetTabKey?: string
  pos?: 'before' | 'after'
}): SidebarItem[] {
  const next = cloneItems(params.sidebarItems)
  const tabKey = String(params.tabKey || '').trim()
  const targetGroupId = String(params.targetGroupId || '').trim()
  if (!tabKey || !targetGroupId) return next

  removeTabFromGroups(next, tabKey)
  const ungroupedIdx = next.findIndex(item => item.type === 'tab' && item.tabKey === tabKey)
  if (ungroupedIdx >= 0) next.splice(ungroupedIdx, 1)

  const group = next.find(item => item.type === 'group' && item.id === targetGroupId)
  if (!group || group.type !== 'group') return next

  const targetTabKey = String(params.targetTabKey || '').trim()
  if (targetTabKey) {
    const idx = group.tabKeys.indexOf(targetTabKey)
    if (idx >= 0) {
      const insertIdx = params.pos === 'after' ? idx + 1 : idx
      group.tabKeys.splice(insertIdx, 0, tabKey)
      return next
    }
  }

  group.tabKeys.push(tabKey)
  return next
}

export function moveGroupBlock(sidebarItems: SidebarItem[], movingGroupId: string, targetGroupId: string, pos: 'before' | 'after'): SidebarItem[] {
  const next = cloneItems(sidebarItems)
  const mid = String(movingGroupId || '').trim()
  const tid = String(targetGroupId || '').trim()
  if (!mid || !tid || mid === tid) return next

  const movingIdx = next.findIndex(item => item.type === 'group' && item.id === mid)
  const targetIdx = next.findIndex(item => item.type === 'group' && item.id === tid)
  if (movingIdx < 0 || targetIdx < 0) return next

  const [moving] = next.splice(movingIdx, 1)
  const anchorIdx = next.findIndex(item => item.type === 'group' && item.id === tid)
  if (!moving || anchorIdx < 0) return sidebarItems
  next.splice(pos === 'after' ? anchorIdx + 1 : anchorIdx, 0, moving)
  return next
}

export function moveGroupToIndex(sidebarItems: SidebarItem[], groupId: string, index: number): SidebarItem[] {
  const next = cloneItems(sidebarItems)
  const gid = String(groupId || '').trim()
  if (!gid) return next
  const movingIdx = next.findIndex(item => item.type === 'group' && item.id === gid)
  if (movingIdx < 0) return next
  const [moving] = next.splice(movingIdx, 1)
  if (!moving) return sidebarItems
  const insertIndex = Math.max(0, Math.min(index, next.length))
  next.splice(insertIndex, 0, moving)
  return next
}

export function moveTabToGroupIndex(sidebarItems: SidebarItem[], tabKey: string, groupId: string, index: number): SidebarItem[] {
  const next = cloneItems(sidebarItems)
  const normalizedTabKey = String(tabKey || '').trim()
  const gid = String(groupId || '').trim()
  if (!normalizedTabKey || !gid) return next

  removeTabFromGroups(next, normalizedTabKey)
  const topLevelIdx = next.findIndex(item => item.type === 'tab' && item.tabKey === normalizedTabKey)
  if (topLevelIdx >= 0) next.splice(topLevelIdx, 1)

  const group = next.find(item => item.type === 'group' && item.id === gid)
  if (!group || group.type !== 'group') return next
  const insertIndex = Math.max(0, Math.min(index, group.tabKeys.length))
  group.tabKeys.splice(insertIndex, 0, normalizedTabKey)
  return next
}

export function createGroupInSidebar(sidebarItems: SidebarItem[], group: HyperCortexTabGroupV1): SidebarItem[] {
  const next = cloneItems(sidebarItems)
  const id = String(group.id || '').trim()
  if (!id) return next
  next.push({
    type: 'group',
    id,
    title: String(group.title || '').trim() || '分组',
    color: String(group.color || '').trim() || 'hsl(210, 28%, 88%)',
    collapsed: group.collapsed === true,
    tabKeys: [],
  })
  return next
}

export function updateSidebarGroup(sidebarItems: SidebarItem[], groupId: string, patch: Partial<Pick<SidebarGroupItem, 'title' | 'color' | 'collapsed'>>): SidebarItem[] {
  return cloneItems(sidebarItems).map(item => {
    if (item.type !== 'group' || item.id !== String(groupId || '').trim()) return item
    return {
      ...item,
      title: typeof patch.title === 'string' ? patch.title : item.title,
      color: typeof patch.color === 'string' ? patch.color : item.color,
      collapsed: typeof patch.collapsed === 'boolean' ? patch.collapsed : item.collapsed,
    }
  })
}

export function deleteGroupFromSidebar(sidebarItems: SidebarItem[], groupId: string): SidebarItem[] {
  const gid = String(groupId || '').trim()
  if (!gid) return cloneItems(sidebarItems)
  const next = cloneItems(sidebarItems)
  const idx = next.findIndex(item => item.type === 'group' && item.id === gid)
  if (idx < 0) return next
  const [group] = next.splice(idx, 1)
  if (group && group.type === 'group') {
    let insertIdx = idx
    for (const tabKey of group.tabKeys) {
      next.splice(insertIdx, 0, { type: 'tab', tabKey })
      insertIdx += 1
    }
  }
  return next
}

export function closeTabsInSidebar(sidebarItems: SidebarItem[], closingKeys: string[]): SidebarItem[] {
  const closing = new Set((Array.isArray(closingKeys) ? closingKeys : []).map(v => String(v || '').trim()).filter(Boolean))
  if (!closing.size) return cloneItems(sidebarItems)
  return cloneItems(sidebarItems)
    .flatMap(item => {
      if (item.type === 'tab') return closing.has(item.tabKey) ? [] : [item]
      return [{ ...item, tabKeys: item.tabKeys.filter(tabKey => !closing.has(tabKey)) }]
    })
}

export function renameTabKeyInSidebar(sidebarItems: SidebarItem[], oldTabKey: string, newTabKey: string): SidebarItem[] {
  const oldKey = String(oldTabKey || '').trim()
  const nextKey = String(newTabKey || '').trim()
  if (!oldKey || !nextKey || oldKey === nextKey) return cloneItems(sidebarItems)
  return cloneItems(sidebarItems).map(item => {
    if (item.type === 'tab') return item.tabKey === oldKey ? { ...item, tabKey: nextKey } : item
    return { ...item, tabKeys: item.tabKeys.map(tabKey => (tabKey === oldKey ? nextKey : tabKey)) }
  })
}
