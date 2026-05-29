import * as React from 'react'
import { resolveAdjacentCategoryId, type CategoryNavigationDirection } from './categorySelection'
import { resolveAdjacentGroupId, type GroupNavigationBoundary, type GroupNavigationDirection } from './groupSelection'
import { advanceGroupShortcutWheelGesture, emptyGroupShortcutWheelGesture, normalizeGroupShortcutWheelDeltaY, resolveShortcutKeyNavigationCommand, type GroupShortcutWheelGesture } from './shortcutNavigation'
import type { CategoryWorkspaceView, CollectionViewCategoryId } from './types'

type UseCollectionShortcutNavigationOptions = {
  enabled: boolean
  groupNavigationEnabled: boolean
  workspace: CategoryWorkspaceView
  activeCategoryId: CollectionViewCategoryId
  groupId: string
  onSelectCategory(categoryId: CollectionViewCategoryId): void
  onSelectGroup(groupId: string): void
}

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

export function useCollectionShortcutNavigation({ enabled, groupNavigationEnabled, workspace, activeCategoryId, groupId, onSelectCategory, onSelectGroup }: UseCollectionShortcutNavigationOptions): void {
  const wheelGestureRef = React.useRef<GroupShortcutWheelGesture>(emptyGroupShortcutWheelGesture())

  const resolveGroupNavigationTarget = React.useCallback((direction: GroupNavigationDirection, boundary: GroupNavigationBoundary): string | null => {
    if (!enabled || !groupNavigationEnabled) return null
    return resolveAdjacentGroupId(workspace, groupId, direction, boundary)
  }, [enabled, groupId, groupNavigationEnabled, workspace])

  const navigateGroup = React.useCallback((direction: GroupNavigationDirection, boundary: GroupNavigationBoundary): boolean => {
    const nextGroupId = resolveGroupNavigationTarget(direction, boundary)
    if (!nextGroupId) return false

    onSelectGroup(nextGroupId)
    return true
  }, [onSelectGroup, resolveGroupNavigationTarget])

  const navigateCategory = React.useCallback((direction: CategoryNavigationDirection): boolean => {
    if (!enabled) return false

    const nextCategoryId = resolveAdjacentCategoryId(workspace.categoryOrder, activeCategoryId, direction, 'stop')
    if (!nextCategoryId) return false

    onSelectCategory(nextCategoryId)
    return true
  }, [activeCategoryId, enabled, onSelectCategory, workspace.categoryOrder])

  const canHandleWheelNavigation = React.useCallback((): boolean => (
    resolveGroupNavigationTarget('previous', 'stop') !== null || resolveGroupNavigationTarget('next', 'stop') !== null
  ), [resolveGroupNavigationTarget])

  React.useEffect(() => {
    wheelGestureRef.current = emptyGroupShortcutWheelGesture()
  }, [enabled, groupId, groupNavigationEnabled, workspace.id])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !event.ctrlKey) return
      if (isEditableShortcutTarget(event.target)) return

      const command = resolveShortcutKeyNavigationCommand(event.key)
      if (!command) return

      const handled = command.scope === 'group'
        ? navigateGroup(command.direction, 'wrap')
        : navigateCategory(command.direction)
      if (!handled) return

      event.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigateCategory, navigateGroup])

  React.useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || !event.ctrlKey) return

      const deltaY = normalizeGroupShortcutWheelDeltaY(event.deltaY, event.deltaMode, window.innerHeight)
      if (!deltaY) return
      if (!canHandleWheelNavigation()) {
        wheelGestureRef.current = emptyGroupShortcutWheelGesture()
        return
      }

      event.preventDefault()
      const resolution = advanceGroupShortcutWheelGesture(wheelGestureRef.current, { deltaY, timeStamp: event.timeStamp })
      wheelGestureRef.current = resolution.gesture
      const direction = resolution.direction
      if (!direction) return

      navigateGroup(direction, 'stop')
    }

    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [canHandleWheelNavigation, navigateGroup])
}
