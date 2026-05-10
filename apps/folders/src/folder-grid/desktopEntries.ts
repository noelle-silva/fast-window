import { itemTargetValue } from '../categoryRegistry'
import { itemMatchesGroup } from '../groupMembership'
import type { CategoryWorkspace, CollectionGridLayout, DesktopEntryKind, DesktopGridEntry } from '../types'

export type DesktopGridLayoutPatch = { kind: DesktopEntryKind; id: string; layout: CollectionGridLayout }

export function desktopEntryKey(kind: DesktopEntryKind, id: string): string {
  return `${kind}:${id}`
}

export function parseDesktopEntryKey(key: string): { kind: DesktopEntryKind; id: string } | null {
  const index = key.indexOf(':')
  if (index <= 0) return null
  const kind = key.slice(0, index)
  const id = key.slice(index + 1)
  if ((kind !== 'item' && kind !== 'container') || !id) return null
  return { kind, id }
}

export function buildDesktopGridEntries(workspace: CategoryWorkspace, groupId: string): DesktopGridEntry[] {
  const containedItemCount = new Map<string, number>()
  workspace.items.forEach(item => {
    if (!item.containerId) return
    containedItemCount.set(item.containerId, (containedItemCount.get(item.containerId) || 0) + 1)
  })

  return [
    ...workspace.containers.filter(container => container.groupId === groupId).map(container => ({
      kind: 'container' as const,
      id: container.id,
      name: container.name,
      layout: container.layout,
      container,
      itemCount: containedItemCount.get(container.id) || 0,
    })),
    ...workspace.items.filter(item => item.groupId === groupId && !item.containerId).map(item => ({
      kind: 'item' as const,
      id: item.id,
      name: item.name,
      layout: item.layout,
      icon: item.icon,
      item,
    })),
  ].sort((left, right) => entryPageOrder(left) - entryPageOrder(right) || left.name.localeCompare(right.name, 'zh-Hans-CN'))
}

export function filterDesktopGridEntries(workspace: CategoryWorkspace, entries: DesktopGridEntry[], groupId: string, search: string): DesktopGridEntry[] {
  const q = search.trim().toLowerCase()
  return entries.filter(entry => {
    if (entry.kind === 'item') return matchesItem(entry.item!, groupId, q)
    const childItems = workspace.items.filter(item => item.containerId === entry.id)
    const matchesContainerName = !q || entry.name.toLowerCase().includes(q)
    const matchesChildren = childItems.some(item => matchesItem(item, groupId, q))
    return matchesContainerName || matchesChildren
  })
}

function entryPageOrder(entry: DesktopGridEntry): number {
  return entry.kind === 'container' ? entry.container?.pageOrder ?? 0 : entry.item?.pageOrder ?? 0
}

function matchesItem(item: NonNullable<DesktopGridEntry['item']>, groupId: string, q: string): boolean {
  if (!itemMatchesGroup(item, groupId)) return false
  return !q || item.name.toLowerCase().includes(q) || itemTargetValue(item).toLowerCase().includes(q)
}
