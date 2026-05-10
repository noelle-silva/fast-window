type KeyboardLikeEvent = {
  key?: string
  code?: string
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
  isComposing?: boolean
  preventDefault(): void
  stopPropagation(): void
  nativeEvent?: { stopImmediatePropagation?: () => void }
}

function isActivationKey(event: KeyboardLikeEvent) {
  return (
    event.key === ' ' ||
    event.key === 'Spacebar' ||
    event.code === 'Space' ||
    event.key === 'Enter' ||
    event.code === 'Enter' ||
    event.code === 'NumpadEnter'
  )
}

export function isShortcutActivationLeak(event: KeyboardLikeEvent) {
  if (event.isComposing) return false
  if (!isActivationKey(event)) return false
  return event.ctrlKey === true || event.altKey === true || event.metaKey === true
}

export function blockShortcutActivationLeak(event: KeyboardLikeEvent) {
  if (!isShortcutActivationLeak(event)) return false
  event.preventDefault()
  event.stopPropagation()
  event.nativeEvent?.stopImmediatePropagation?.()
  return true
}
