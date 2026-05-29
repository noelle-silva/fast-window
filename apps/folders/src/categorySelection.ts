import { resolveAdjacentSelectionId, type SelectionNavigationBoundary, type SelectionNavigationDirection } from './selectionNavigation'
import type { CollectionViewCategoryId } from './types'

export type CategoryNavigationDirection = SelectionNavigationDirection
export type CategoryNavigationBoundary = SelectionNavigationBoundary

export function resolveAdjacentCategoryId(categoryOrder: CollectionViewCategoryId[], currentCategoryId: CollectionViewCategoryId, direction: CategoryNavigationDirection, boundary: CategoryNavigationBoundary = 'wrap'): CollectionViewCategoryId | null {
  return resolveAdjacentSelectionId(categoryOrder, currentCategoryId, direction, boundary)
}
