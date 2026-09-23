import { isDataImageUrl } from '../utils'
import type { RegisteredAppShortcut } from './types'

export function resolveHostShortcutIcon(shortcut: RegisteredAppShortcut, appIcon: string): string {
  return shortcut.icon || appIcon || shortcut.title[0] || 'S'
}

export function resolveHostShortcutIconImageUrl(shortcut: RegisteredAppShortcut, appIcon: string): string | undefined {
  const displayIcon = resolveHostShortcutIcon(shortcut, appIcon)
  return isDataImageUrl(displayIcon) ? displayIcon : undefined
}
