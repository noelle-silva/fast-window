import type { CategoryWorkspace, CollectionViewCategoryId } from './types'
import { resolveAdjacentSelectionId, type SelectionNavigationBoundary, type SelectionNavigationDirection } from './selectionNavigation'

export type GroupSelectionByCategory = Partial<Record<CollectionViewCategoryId, string>>
export type GroupNavigationDirection = SelectionNavigationDirection
export type GroupNavigationBoundary = SelectionNavigationBoundary

export function resolveGroupSelection(workspace: CategoryWorkspace, preferredGroupId: string): string {
  const preferred = preferredGroupId.trim()
  if (preferred && workspace.groups.some(group => group.id === preferred)) return preferred
  return workspace.groups[0]?.id || ''
}

export function rememberGroupSelection(selections: GroupSelectionByCategory, categoryId: CollectionViewCategoryId, groupId: string): GroupSelectionByCategory {
  return { ...selections, [categoryId]: groupId.trim() }
}

export function resolveAdjacentGroupId(workspace: CategoryWorkspace, currentGroupId: string, direction: GroupNavigationDirection, boundary: GroupNavigationBoundary = 'wrap'): string | null {
  return resolveAdjacentSelectionId(workspace.groups.map(group => group.id), currentGroupId, direction, boundary)
}
