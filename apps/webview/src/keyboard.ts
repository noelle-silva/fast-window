export function buildShortcutFromEvent(e: KeyboardEvent): string | null {
  const code = typeof e.code === 'string' ? e.code : ''
  if (!code || code === 'Unidentified') return null

  const parts: string[] = []
  if (e.ctrlKey) parts.push('control')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  if (e.metaKey) parts.push('super')
  parts.push(code)
  return parts.join('+')
}

export function isEditableTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null
  if (!el || typeof (el as any).tagName !== 'string') return false
  const tag = el.tagName.toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if ((el as any).isContentEditable) return true
  if (typeof (el as any).closest === 'function' && (el as any).closest('[contenteditable="true"],[role="textbox"]')) return true
  return false
}
