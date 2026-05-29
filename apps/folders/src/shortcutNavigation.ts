import type { SelectionNavigationDirection } from './selectionNavigation'

const WHEEL_DELTA_LINE = 1
const WHEEL_DELTA_PAGE = 2
const WHEEL_NAVIGATION_THRESHOLD_PX = 80
const WHEEL_GESTURE_RESET_MS = 250

export type ShortcutNavigationScope = 'group' | 'category'

export type ShortcutNavigationCommand = {
  scope: ShortcutNavigationScope
  direction: SelectionNavigationDirection
}

export type GroupShortcutWheelGesture = {
  accumulatedDeltaY: number
  lastEventAt: number
}

export type GroupShortcutWheelInput = {
  deltaY: number
  timeStamp: number
}

export type GroupShortcutWheelResolution = {
  gesture: GroupShortcutWheelGesture
  direction: SelectionNavigationDirection | null
}

export function emptyGroupShortcutWheelGesture(): GroupShortcutWheelGesture {
  return { accumulatedDeltaY: 0, lastEventAt: 0 }
}

export function resolveShortcutKeyNavigationCommand(key: string): ShortcutNavigationCommand | null {
  if (key === 'ArrowUp') return { scope: 'group', direction: 'previous' }
  if (key === 'ArrowDown') return { scope: 'group', direction: 'next' }
  if (key === 'ArrowLeft') return { scope: 'category', direction: 'previous' }
  if (key === 'ArrowRight') return { scope: 'category', direction: 'next' }
  return null
}

export function normalizeGroupShortcutWheelDeltaY(deltaY: number, deltaMode: number, pageHeight: number): number {
  if (deltaMode === WHEEL_DELTA_LINE) return deltaY * 16
  if (deltaMode === WHEEL_DELTA_PAGE) return deltaY * pageHeight
  return deltaY
}

export function advanceGroupShortcutWheelGesture(gesture: GroupShortcutWheelGesture, input: GroupShortcutWheelInput): GroupShortcutWheelResolution {
  if (!input.deltaY) return { gesture, direction: null }

  const previousDirection = Math.sign(gesture.accumulatedDeltaY)
  const nextDirection = Math.sign(input.deltaY)
  const shouldReset = input.timeStamp - gesture.lastEventAt > WHEEL_GESTURE_RESET_MS || previousDirection !== nextDirection
  const accumulatedDeltaY = (shouldReset ? 0 : gesture.accumulatedDeltaY) + input.deltaY
  const nextGesture = { accumulatedDeltaY, lastEventAt: input.timeStamp }

  if (Math.abs(accumulatedDeltaY) < WHEEL_NAVIGATION_THRESHOLD_PX) return { gesture: nextGesture, direction: null }

  return {
    gesture: emptyGroupShortcutWheelGesture(),
    direction: accumulatedDeltaY > 0 ? 'next' : 'previous',
  }
}
