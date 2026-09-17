import type { Workspace } from './types'
import { resolveAdjacentSelectionId, type SelectionNavigationBoundary, type SelectionNavigationDirection } from './selectionNavigation'

export type GroupNavigationDirection = SelectionNavigationDirection
export type GroupNavigationBoundary = SelectionNavigationBoundary

export function resolveGroupSelection(workspace: Workspace, preferredGroupId: string): string {
  const preferred = preferredGroupId.trim()
  if (preferred && workspace.groups.some(group => group.id === preferred)) return preferred
  return workspace.groups[0]?.id || ''
}

export function resolveAdjacentGroupId(workspace: Workspace, currentGroupId: string, direction: GroupNavigationDirection, boundary: GroupNavigationBoundary = 'wrap'): string | null {
  return resolveAdjacentSelectionId(workspace.groups.map(group => group.id), currentGroupId, direction, boundary)
}
