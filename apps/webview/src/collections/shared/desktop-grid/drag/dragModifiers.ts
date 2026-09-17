import * as React from 'react'
import type { DesktopGridDragMode, DesktopGridDragModifiers } from '../core/dragTypes'

const DEFAULT_DESKTOP_GRID_DRAG_MODIFIERS: DesktopGridDragModifiers = { ctrlKey: false }

type ModifierEventLike = {
  ctrlKey?: boolean
  nativeEvent?: ModifierEventLike
  originalEvent?: ModifierEventLike
  srcEvent?: ModifierEventLike
}

export function getDesktopGridDragModifiers(event: unknown, fallback: DesktopGridDragModifiers = DEFAULT_DESKTOP_GRID_DRAG_MODIFIERS): DesktopGridDragModifiers {
  const modifierSource = findModifierEvent(event)
  if (!modifierSource) return fallback
  return { ctrlKey: Boolean(modifierSource.ctrlKey || fallback.ctrlKey) }
}

export function getDesktopGridDragMode(modifiers: DesktopGridDragModifiers): DesktopGridDragMode {
  return modifiers.ctrlKey ? 'overlay' : 'reflow'
}

export function useDesktopGridDragModifierState(): React.MutableRefObject<DesktopGridDragModifiers> {
  const modifiersRef = React.useRef<DesktopGridDragModifiers>(DEFAULT_DESKTOP_GRID_DRAG_MODIFIERS)

  React.useEffect(() => {
    const update = (event: KeyboardEvent) => {
      modifiersRef.current = { ctrlKey: event.ctrlKey }
    }
    const clear = () => {
      modifiersRef.current = DEFAULT_DESKTOP_GRID_DRAG_MODIFIERS
    }
    window.addEventListener('keydown', update)
    window.addEventListener('keyup', update)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', update)
      window.removeEventListener('keyup', update)
      window.removeEventListener('blur', clear)
    }
  }, [])

  return modifiersRef
}

function findModifierEvent(event: unknown): ModifierEventLike | null {
  if (!isModifierEventLike(event)) return null
  if (typeof event.ctrlKey === 'boolean') return event
  return findModifierEvent(event.srcEvent) || findModifierEvent(event.originalEvent) || findModifierEvent(event.nativeEvent)
}

function isModifierEventLike(event: unknown): event is ModifierEventLike {
  return Boolean(event && typeof event === 'object')
}
