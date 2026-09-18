export function normalizeHotkeyString(raw: any) {
  const s0 = typeof raw === 'string' ? raw : String(raw ?? '')
  const s = s0.trim()
  if (!s) return ''
  const parts = s
    .split('+')
    .map((x) => String(x || '').trim())
    .filter((x) => !!x)

  const modSet = new Set<string>()
  let key = ''
  for (const p0 of parts) {
    const p = p0.toLowerCase()
    if (p === 'ctrl' || p === 'control') modSet.add('Ctrl')
    else if (p === 'alt' || p === 'option') modSet.add('Alt')
    else if (p === 'shift') modSet.add('Shift')
    else if (p === 'meta' || p === 'cmd' || p === 'command' || p === 'win') modSet.add('Meta')
    else key = p0
  }

  const k0 = String(key || '').trim()
  if (!k0) return ''
  const k1 = k0.length === 1 ? k0.toUpperCase() : k0

  const mods = ['Ctrl', 'Alt', 'Shift', 'Meta'].filter((m) => modSet.has(m))
  return [...mods, k1].join('+')
}

export function hotkeyFromKeyEvent(e: { key?: any; ctrlKey?: any; altKey?: any; shiftKey?: any; metaKey?: any }) {
  const k0 = String(e?.key || '').trim()
  if (!k0) return ''
  const lower = k0.toLowerCase()
  if (lower === 'control' || lower === 'shift' || lower === 'alt' || lower === 'meta') return ''

  const mods: string[] = []
  if (e?.ctrlKey) mods.push('Ctrl')
  if (e?.altKey) mods.push('Alt')
  if (e?.shiftKey) mods.push('Shift')
  if (e?.metaKey) mods.push('Meta')

  const key =
    k0 === ' ' ? 'Space' : k0.length === 1 ? k0.toUpperCase() : k0.startsWith('Arrow') ? k0 : k0[0].toUpperCase() + k0.slice(1)
  return normalizeHotkeyString([...mods, key].join('+'))
}
