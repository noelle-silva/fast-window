import * as React from 'react'
import { advanceGroupShortcutWheelGesture, emptyGroupShortcutWheelGesture, normalizeGroupShortcutWheelDeltaY, resolveGroupShortcutArrowDirection, type GroupShortcutWheelGesture } from './groupShortcutNavigation'
import { resolveAdjacentGroupId, type GroupNavigationBoundary, type GroupNavigationDirection } from './groupSelection'
import type { CategoryWorkspace } from './types'

type UseGroupShortcutNavigationOptions = {
  enabled: boolean
  workspace: CategoryWorkspace
  groupId: string
  onSelectGroup(groupId: string): void
}

export function useGroupShortcutNavigation({ enabled, workspace, groupId, onSelectGroup }: UseGroupShortcutNavigationOptions): void {
  const wheelGestureRef = React.useRef<GroupShortcutWheelGesture>(emptyGroupShortcutWheelGesture())

  const resolveNavigationTarget = React.useCallback((direction: GroupNavigationDirection, boundary: GroupNavigationBoundary): string | null => {
    if (!enabled) return null
    return resolveAdjacentGroupId(workspace, groupId, direction, boundary)
  }, [enabled, groupId, workspace])

  const navigate = React.useCallback((direction: GroupNavigationDirection, boundary: GroupNavigationBoundary): boolean => {
    const nextGroupId = resolveNavigationTarget(direction, boundary)
    if (!nextGroupId) return false

    onSelectGroup(nextGroupId)
    return true
  }, [onSelectGroup, resolveNavigationTarget])

  const canHandleWheelNavigation = React.useCallback((): boolean => (
    resolveNavigationTarget('previous', 'stop') !== null || resolveNavigationTarget('next', 'stop') !== null
  ), [resolveNavigationTarget])

  React.useEffect(() => {
    wheelGestureRef.current = emptyGroupShortcutWheelGesture()
  }, [enabled, groupId, workspace.id])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !event.ctrlKey) return

      const direction = resolveGroupShortcutArrowDirection(event.key)
      if (!direction) return
      if (!navigate(direction, 'wrap')) return

      event.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate])

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

      navigate(direction, 'stop')
    }

    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [canHandleWheelNavigation, navigate])
}
