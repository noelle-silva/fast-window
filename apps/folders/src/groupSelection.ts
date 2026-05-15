import type { CategoryWorkspace, CollectionViewCategoryId } from './types'

export type GroupSelectionByCategory = Partial<Record<CollectionViewCategoryId, string>>

export function resolveGroupSelection(workspace: CategoryWorkspace, preferredGroupId: string): string {
  const preferred = preferredGroupId.trim()
  if (preferred && workspace.groups.some(group => group.id === preferred)) return preferred
  return workspace.groups[0]?.id || ''
}

export function rememberGroupSelection(selections: GroupSelectionByCategory, categoryId: CollectionViewCategoryId, groupId: string): GroupSelectionByCategory {
  return { ...selections, [categoryId]: groupId.trim() }
}
