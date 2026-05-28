import * as React from 'react'
import { advanceGroupShortcutWheelGesture, emptyGroupShortcutWheelGesture, normalizeGroupShortcutWheelDeltaY, resolveGroupShortcutArrowDirection, type GroupShortcutWheelGesture } from './groupShortcutNavigation'
import { resolveAdjacentGroupId, type GroupNavigationDirection } from './groupSelection'
import type { CategoryWorkspace } from './types'

type UseGroupShortcutNavigationOptions = {
  enabled: boolean
  workspace: CategoryWorkspace
  groupId: string
  onSelectGroup(groupId: string): void
}

export function useGroupShortcutNavigation({ enabled, workspace, groupId, onSelectGroup }: UseGroupShortcutNavigationOptions): void {
  const wheelGestureRef = React.useRef<GroupShortcutWheelGesture>(emptyGroupShortcutWheelGesture())

  const resolveNavigationTarget = React.useCallback((direction: GroupNavigationDirection): string | null => {
    if (!enabled) return null
    return resolveAdjacentGroupId(workspace, groupId, direction)
  }, [enabled, groupId, workspace])

  const navigate = React.useCallback((direction: GroupNavigationDirection): boolean => {
    const nextGroupId = resolveNavigationTarget(direction)
    if (!nextGroupId) return false

    onSelectGroup(nextGroupId)
    return true
  }, [onSelectGroup, resolveNavigationTarget])

  const canNavigate = React.useCallback((): boolean => resolveNavigationTarget('next') !== null, [resolveNavigationTarget])

  React.useEffect(() => {
    wheelGestureRef.current = emptyGroupShortcutWheelGesture()
  }, [enabled, groupId, workspace.id])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !event.ctrlKey) return

      const direction = resolveGroupShortcutArrowDirection(event.key)
      if (!direction) return
      if (!navigate(direction)) return

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
      if (!canNavigate()) {
        wheelGestureRef.current = emptyGroupShortcutWheelGesture()
        return
      }

      event.preventDefault()
      const resolution = advanceGroupShortcutWheelGesture(wheelGestureRef.current, { deltaY, timeStamp: event.timeStamp })
      wheelGestureRef.current = resolution.gesture
      const direction = resolution.direction
      if (!direction) return

      navigate(direction)
    }

    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [canNavigate, navigate])
}
