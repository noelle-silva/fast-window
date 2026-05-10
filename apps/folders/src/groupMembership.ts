import type { FolderGroup, FolderItem, FoldersDoc } from './types'
import { ALL_GROUP_ID, DEFAULT_GROUP_ID } from './utils'

export function groupIdsForFilter(groupId: string): string[] {
  return [groupId === ALL_GROUP_ID ? DEFAULT_GROUP_ID : groupId]
}

export function includeGroupId(groupIds: readonly string[], groupId: string): string[] {
  return groupIds.includes(groupId) ? [...groupIds] : [...groupIds, groupId]
}

export function excludeGroupId(groupIds: readonly string[], groupId: string): string[] {
  return groupIds.filter(current => current !== groupId)
}

export function sameGroupIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  return left.every(groupId => right.includes(groupId))
}

export function folderHasGroup(item: FolderItem, groupId: string): boolean {
  return item.groupIds.includes(groupId)
}

export function folderMatchesGroup(item: FolderItem, groupId: string): boolean {
  return groupId === ALL_GROUP_ID || folderHasGroup(item, groupId)
}

export function folderGroupNames(groups: readonly FolderGroup[], groupIds: readonly string[]): string[] {
  return groupIds.map(groupId => groups.find(group => group.id === groupId)?.name || groupId)
}

export function folderGroupLabel(doc: FoldersDoc, item: FolderItem): string {
  return folderGroupNames(doc.groups, item.groupIds).join('、')
}

export function groupItemCount(doc: FoldersDoc, groupId: string): number {
  return doc.items.filter(item => folderHasGroup(item, groupId)).length
}
