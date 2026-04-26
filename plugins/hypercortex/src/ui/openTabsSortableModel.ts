import type { SidebarItem } from './sidebarModel'
import { moveTabInGroupRelative, moveTabToGroupIndex, moveTopLevelItemRelative } from './sidebarModel'

export type OpenTabsSortableId = { kind: 'tab'; tabKey: string } | { kind: 'group'; groupId: string }
export type OpenTabsSortableTabLocation = { kind: 'top'; itemIndex: number } | { kind: 'group'; groupId: string; tabIndex: number }
export type OpenTabsSortableVisualRow = {
  id: string
  parsed: OpenTabsSortableId
  location: OpenTabsSortableTabLocation | { kind: 'group'; groupId: string; itemIndex: number }
}
export type OpenTabsSortableMoveIntent =
  | { kind: 'none' }
  | { kind: 'top-relative'; movingKey: string; targetKey: string; pos: 'before' | 'after' }
  | { kind: 'tab-to-group-start'; tabKey: string; groupId: string }
  | { kind: 'tab-in-group-relative'; groupId: string; tabKey: string; targetTabKey: string; pos: 'before' | 'after' }

export function sortableTabId(tabKey: string): string {
  return `tab:${tabKey}`
}

export function sortableGroupId(groupId: string): string {
  return `group:${groupId}`
}

export function parseSortableId(value: string): OpenTabsSortableId | null {
  const raw = String(value || '').trim()
  if (raw.startsWith('tab:')) {
    const tabKey = raw.slice(4).trim()
    return tabKey ? { kind: 'tab', tabKey } : null
  }
  if (raw.startsWith('group:')) {
    const groupId = raw.slice(6).trim()
    return groupId ? { kind: 'group', groupId } : null
  }
  return null
}

export function findSortableTabLocation(sidebarItems: SidebarItem[], tabKey: string): OpenTabsSortableTabLocation | null {
  const key = String(tabKey || '').trim()
  if (!key) return null
  for (let itemIndex = 0; itemIndex < sidebarItems.length; itemIndex += 1) {
    const item = sidebarItems[itemIndex]
    if (item.type === 'tab' && item.tabKey === key) return { kind: 'top', itemIndex }
    if (item.type !== 'group') continue
    const tabIndex = item.tabKeys.indexOf(key)
    if (tabIndex >= 0) return { kind: 'group', groupId: item.id, tabIndex }
  }
  return null
}

export function getSortableVisualRows(sidebarItems: SidebarItem[]): OpenTabsSortableVisualRow[] {
  const rows: OpenTabsSortableVisualRow[] = []
  for (let itemIndex = 0; itemIndex < sidebarItems.length; itemIndex += 1) {
    const item = sidebarItems[itemIndex]
    if (item.type === 'tab') {
      rows.push({ id: sortableTabId(item.tabKey), parsed: { kind: 'tab', tabKey: item.tabKey }, location: { kind: 'top', itemIndex } })
      continue
    }
    rows.push({ id: sortableGroupId(item.id), parsed: { kind: 'group', groupId: item.id }, location: { kind: 'group', groupId: item.id, itemIndex } })
    if (item.collapsed === true) continue
    item.tabKeys.forEach((tabKey, tabIndex) => {
      rows.push({ id: sortableTabId(tabKey), parsed: { kind: 'tab', tabKey }, location: { kind: 'group', groupId: item.id, tabIndex } })
    })
  }
  return rows
}

export function buildSortableMoveIntent(sidebarItems: SidebarItem[], activeRawId: string, overRawId: string): OpenTabsSortableMoveIntent {
  const active = parseSortableId(activeRawId)
  const over = parseSortableId(overRawId)
  if (!active || !over) return { kind: 'none' }
  if (activeRawId === overRawId) return { kind: 'none' }

  const rows = getSortableVisualRows(sidebarItems)
  const activeIndex = rows.findIndex(row => row.id === activeRawId)
  const overRow = rows.find(row => row.id === overRawId)
  if (activeIndex < 0 || !overRow) return { kind: 'none' }
  const overIndex = rows.indexOf(overRow)
  const pos: 'before' | 'after' = activeIndex < overIndex ? 'after' : 'before'

  if (active.kind === 'group') {
    const overKey = overRow.location.kind === 'group' && 'itemIndex' in overRow.location ? overRow.location.groupId : over.kind === 'group' ? over.groupId : over.tabKey
    return { kind: 'top-relative', movingKey: active.groupId, targetKey: overKey, pos }
  }

  const from = findSortableTabLocation(sidebarItems, active.tabKey)
  if (!from) return { kind: 'none' }

  if (over.kind === 'group') {
    const group = sidebarItems.find(item => item.type === 'group' && item.id === over.groupId)
    if (!group || group.type !== 'group') return { kind: 'none' }
    if (group.collapsed !== true && group.tabKeys.length > 0) return { kind: 'none' }
    return { kind: 'tab-to-group-start', tabKey: active.tabKey, groupId: over.groupId }
  }

  const to = overRow.location.kind === 'group' && !('itemIndex' in overRow.location) ? overRow.location : findSortableTabLocation(sidebarItems, over.tabKey)
  if (!to) return { kind: 'none' }
  const sameTop = from.kind === 'top' && to.kind === 'top'
  const sameGroup = from.kind === 'group' && to.kind === 'group' && from.groupId === to.groupId

  if (sameTop) return { kind: 'top-relative', movingKey: active.tabKey, targetKey: over.tabKey, pos }
  if (sameGroup) return { kind: 'tab-in-group-relative', groupId: to.groupId, tabKey: active.tabKey, targetTabKey: over.tabKey, pos }
  if (to.kind === 'top') return { kind: 'top-relative', movingKey: active.tabKey, targetKey: over.tabKey, pos }
  return { kind: 'tab-in-group-relative', groupId: to.groupId, tabKey: active.tabKey, targetTabKey: over.tabKey, pos }
}

export function applySortableMoveIntent(sidebarItems: SidebarItem[], intent: OpenTabsSortableMoveIntent): SidebarItem[] {
  switch (intent.kind) {
    case 'top-relative':
      return moveTopLevelItemRelative(sidebarItems, intent.movingKey, intent.targetKey, intent.pos)
    case 'tab-to-group-start':
      return moveTabToGroupIndex(sidebarItems, intent.tabKey, intent.groupId, 0)
    case 'tab-in-group-relative':
      return moveTabInGroupRelative(sidebarItems, intent.groupId, intent.tabKey, intent.targetTabKey, intent.pos)
    case 'none':
    default:
      return sidebarItems
  }
}
