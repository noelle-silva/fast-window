import * as React from 'react'
import { resolveAdjacentGroupId, type GroupNavigationBoundary, type GroupNavigationDirection } from './groupSelection'
import { advanceGroupShortcutWheelGesture, emptyGroupShortcutWheelGesture, normalizeGroupShortcutWheelDeltaY, resolveShortcutKeyNavigationCommand, type GroupShortcutWheelGesture } from './shortcutNavigation'
import type { WorkspaceView } from './types'

type UseCollectionShortcutNavigationOptions = {
  enabled: boolean
  workspace: WorkspaceView
  groupId: string
  onSelectGroup(groupId: string): void
}

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

export function useCollectionShortcutNavigation({ enabled, workspace, groupId, onSelectGroup }: UseCollectionShortcutNavigationOptions): void {
  const wheelGestureRef = React.useRef<GroupShortcutWheelGesture>(emptyGroupShortcutWheelGesture())

  const resolveGroupNavigationTarget = React.useCallback((direction: GroupNavigationDirection, boundary: GroupNavigationBoundary): string | null => {
    if (!enabled) return null
    return resolveAdjacentGroupId(workspace, groupId, direction, boundary)
  }, [enabled, groupId, workspace])

  const navigateGroup = React.useCallback((direction: GroupNavigationDirection, boundary: GroupNavigationBoundary): boolean => {
    const nextGroupId = resolveGroupNavigationTarget(direction, boundary)
    if (!nextGroupId) return false

    onSelectGroup(nextGroupId)
    return true
  }, [onSelectGroup, resolveGroupNavigationTarget])

  const canHandleWheelNavigation = React.useCallback((): boolean => (
    resolveGroupNavigationTarget('previous', 'stop') !== null || resolveGroupNavigationTarget('next', 'stop') !== null
  ), [resolveGroupNavigationTarget])

  React.useEffect(() => {
    wheelGestureRef.current = emptyGroupShortcutWheelGesture()
  }, [enabled, groupId, workspace])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !event.ctrlKey) return
      if (isEditableShortcutTarget(event.target)) return

      const command = resolveShortcutKeyNavigationCommand(event.key)
      if (!command) return

      const handled = navigateGroup(command.direction, 'wrap')
      if (!handled) return

      event.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigateGroup])

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
