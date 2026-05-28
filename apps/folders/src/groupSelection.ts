import type { CategoryWorkspace, CollectionViewCategoryId } from './types'

export type GroupSelectionByCategory = Partial<Record<CollectionViewCategoryId, string>>
export type GroupNavigationDirection = 'previous' | 'next'
export type GroupNavigationBoundary = 'wrap' | 'stop'

export function resolveGroupSelection(workspace: CategoryWorkspace, preferredGroupId: string): string {
  const preferred = preferredGroupId.trim()
  if (preferred && workspace.groups.some(group => group.id === preferred)) return preferred
  return workspace.groups[0]?.id || ''
}

export function rememberGroupSelection(selections: GroupSelectionByCategory, categoryId: CollectionViewCategoryId, groupId: string): GroupSelectionByCategory {
  return { ...selections, [categoryId]: groupId.trim() }
}

export function resolveAdjacentGroupId(workspace: CategoryWorkspace, currentGroupId: string, direction: GroupNavigationDirection, boundary: GroupNavigationBoundary = 'wrap'): string | null {
  const current = currentGroupId.trim()
  if (workspace.groups.length < 2 || !current) return null

  const currentIndex = workspace.groups.findIndex(group => group.id === current)
  if (currentIndex < 0) return null

  if (boundary === 'stop') {
    const nextIndex = direction === 'previous' ? currentIndex - 1 : currentIndex + 1
    return workspace.groups[nextIndex]?.id || null
  }

  const nextIndex = direction === 'previous'
    ? (currentIndex - 1 + workspace.groups.length) % workspace.groups.length
    : (currentIndex + 1) % workspace.groups.length
  return workspace.groups[nextIndex].id
}
