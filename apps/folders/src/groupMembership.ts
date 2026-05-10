import type { FolderItem, FoldersDoc } from './types'
import { DEFAULT_GROUP_ID } from './utils'

export function groupIdForPage(groupId: string): string {
  return groupId || DEFAULT_GROUP_ID
}

export function folderHasGroup(item: FolderItem, groupId: string): boolean {
  return item.groupId === groupId
}

export function folderMatchesGroup(item: FolderItem, groupId: string): boolean {
  return folderHasGroup(item, groupIdForPage(groupId))
}

export function groupItemCount(doc: FoldersDoc, groupId: string): number {
  return doc.items.filter(item => folderHasGroup(item, groupId)).length
}

export function groupContainerCount(doc: FoldersDoc, groupId: string): number {
  return doc.containers.filter(container => container.groupId === groupId).length
}
