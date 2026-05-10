import { folderMatchesGroup } from '../groupMembership'
import type { DesktopGridEntry, DesktopEntryKind, FolderGridLayout, FoldersDoc } from '../types'

export type DesktopGridLayoutPatch = { kind: DesktopEntryKind; id: string; layout: FolderGridLayout }

export function desktopEntryKey(kind: DesktopEntryKind, id: string): string {
  return `${kind}:${id}`
}

export function parseDesktopEntryKey(key: string): { kind: DesktopEntryKind; id: string } | null {
  const index = key.indexOf(':')
  if (index <= 0) return null
  const kind = key.slice(0, index)
  const id = key.slice(index + 1)
  if ((kind !== 'folder' && kind !== 'container') || !id) return null
  return { kind, id }
}

export function buildDesktopGridEntries(doc: FoldersDoc, groupId: string): DesktopGridEntry[] {
  const containedItemCount = new Map<string, number>()
  doc.items.forEach(item => {
    if (!item.containerId) return
    containedItemCount.set(item.containerId, (containedItemCount.get(item.containerId) || 0) + 1)
  })

  return [
    ...doc.containers.filter(container => container.groupId === groupId).map(container => ({
      kind: 'container' as const,
      id: container.id,
      name: container.name,
      layout: container.layout,
      container,
      itemCount: containedItemCount.get(container.id) || 0,
    })),
    ...doc.items.filter(item => item.groupId === groupId && !item.containerId).map(item => ({
      kind: 'folder' as const,
      id: item.id,
      name: item.name,
      layout: item.layout,
      icon: item.icon,
      item,
    })),
  ].sort((left, right) => entryPageOrder(left) - entryPageOrder(right) || left.name.localeCompare(right.name, 'zh-Hans-CN'))
}

export function filterDesktopGridEntries(doc: FoldersDoc, entries: DesktopGridEntry[], groupId: string, search: string): DesktopGridEntry[] {
  const q = search.trim().toLowerCase()
  return entries.filter(entry => {
    if (entry.kind === 'folder') return matchesFolder(entry.item!, groupId, q)
    const childItems = doc.items.filter(item => item.containerId === entry.id)
    const matchesContainerName = !q || entry.name.toLowerCase().includes(q)
    const matchesChildren = childItems.some(item => matchesFolder(item, groupId, q))
    return matchesContainerName || matchesChildren
  })
}

function entryPageOrder(entry: DesktopGridEntry): number {
  return entry.kind === 'container' ? entry.container?.pageOrder ?? 0 : entry.item?.pageOrder ?? 0
}

function matchesFolder(item: NonNullable<DesktopGridEntry['item']>, groupId: string, q: string): boolean {
  if (!folderMatchesGroup(item, groupId)) return false
  return !q || item.name.toLowerCase().includes(q) || item.path.toLowerCase().includes(q)
}
