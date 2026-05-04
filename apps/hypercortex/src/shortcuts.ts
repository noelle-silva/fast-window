export type HyperCortexShortcutId =
  | 'newNote'
  | 'saveNote'
  | 'toggleMode'
  | 'toggleQuickSearch'
  | 'toggleSidebar'
  | 'goBackPage'
  | 'closeActiveTab'
  | 'selectPrevTab'
  | 'selectNextTab'
  | 'cycleFace'

export type HyperCortexShortcutBindingsV1 = {
  version: 1
  newNote: string
  saveNote: string
  toggleMode: string
  toggleQuickSearch: string
  toggleSidebar: string
  goBackPage: string
  closeActiveTab: string
  selectPrevTab: string
  selectNextTab: string
  cycleFace: string
}

export const DEFAULT_SHORTCUT_BINDINGS: HyperCortexShortcutBindingsV1 = {
  version: 1,
  newNote: '',
  saveNote: '',
  toggleMode: '',
  toggleQuickSearch: '',
  toggleSidebar: '',
  goBackPage: '',
  closeActiveTab: '',
  selectPrevTab: '',
  selectNextTab: '',
  cycleFace: '',
}

function normChord(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeShortcutBindings(input: unknown): HyperCortexShortcutBindingsV1 {
  if (!input || typeof input !== 'object') return { ...DEFAULT_SHORTCUT_BINDINGS }
  const obj = input as any
  const version = obj.version === 1 ? 1 : 1
  return {
    version,
    newNote: normChord(obj.newNote),
    saveNote: normChord(obj.saveNote),
    toggleMode: normChord(obj.toggleMode),
    toggleQuickSearch: normChord(obj.toggleQuickSearch),
    toggleSidebar: normChord(obj.toggleSidebar),
    goBackPage: normChord(obj.goBackPage),
    closeActiveTab: normChord(obj.closeActiveTab),
    selectPrevTab: normChord(obj.selectPrevTab),
    selectNextTab: normChord(obj.selectNextTab),
    cycleFace: normChord(obj.cycleFace),
  }
}

export function formatChordForDisplay(chord: string): string {
  const s = String(chord || '').trim()
  return s ? s : '（未设置）'
}

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta'])

export function normalizeMainKey(key: string): string {
  const k = String(key || '')
  if (!k) return ''
  if (k === ' ') return 'Space'
  if (k === 'Esc') return 'Escape'
  if (k.length === 1) return k.toUpperCase()
  return k
}

export function chordFromKeyboardEvent(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | null {
  const keyRaw = String(e.key || '').trim()
  if (!keyRaw || keyRaw === 'Unidentified' || keyRaw === 'Dead') return null
  if (MODIFIER_KEYS.has(keyRaw)) return null

  const mainKey = normalizeMainKey(keyRaw)
  if (!mainKey) return null

  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Meta')
  parts.push(mainKey)
  return parts.join('+')
}

export function mainKeyFromChord(chord: string): string {
  const s = String(chord || '').trim()
  if (!s) return ''
  const parts = s.split('+').map(p => p.trim()).filter(Boolean)
  const tail = parts[parts.length - 1] || ''
  return normalizeMainKey(tail)
}

export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as any
  if (!el) return false
  const closest = typeof el.closest === 'function' ? (sel: string) => el.closest(sel) : null
  if (closest) {
    if (closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return true
  }
  return el.isContentEditable === true
}

export function chordHasModifier(chord: string): boolean {
  const s = String(chord || '')
  return s.includes('Ctrl+') || s.includes('Alt+') || s.includes('Shift+') || s.includes('Meta+')
}

export function shouldTriggerShortcut(e: KeyboardEvent, chord: string): boolean {
  const expected = String(chord || '').trim()
  if (!expected) return false
  if ((e as any).isComposing) return false
  if (e.repeat) return false
  const got = chordFromKeyboardEvent(e)
  if (!got) return false
  if (got !== expected) return false
  if (!chordHasModifier(expected) && isEditableTarget(e.target)) return false
  return true
}
