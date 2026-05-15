import type { CategoryWorkspace, CollectionCategoryId } from './types'

export type GroupSelectionByCategory = Partial<Record<CollectionCategoryId, string>>

export function resolveGroupSelection(workspace: CategoryWorkspace, preferredGroupId: string): string {
  const preferred = preferredGroupId.trim()
  if (preferred && workspace.groups.some(group => group.id === preferred)) return preferred
  return workspace.groups[0]?.id || ''
}

export function rememberGroupSelection(selections: GroupSelectionByCategory, categoryId: CollectionCategoryId, groupId: string): GroupSelectionByCategory {
  return { ...selections, [categoryId]: groupId.trim() }
}
