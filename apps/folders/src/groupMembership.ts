import type { CategoryWorkspace, CollectionItem } from './types'

export function groupIdForPage(groupId: string): string {
  return groupId.trim()
}

export function itemHasGroup(item: CollectionItem, groupId: string): boolean {
  return item.groupId === groupId
}

export function itemMatchesGroup(item: CollectionItem, groupId: string): boolean {
  return itemHasGroup(item, groupIdForPage(groupId))
}

export function groupItemCount(workspace: CategoryWorkspace, groupId: string): number {
  return workspace.items.filter(item => itemHasGroup(item, groupId)).length
}

export function groupContainerCount(workspace: CategoryWorkspace, groupId: string): number {
  return workspace.containers.filter(container => container.groupId === groupId).length
}
