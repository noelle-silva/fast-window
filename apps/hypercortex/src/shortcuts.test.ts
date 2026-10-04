import { describe, expect, it } from 'vitest'
import {
  chordFromKeyboardEvent,
  chordHasModifier,
  DEFAULT_SHORTCUT_BINDINGS,
  formatChordForDisplay,
  isEditableTarget,
  mainKeyFromChord,
  normalizeMainKey,
  normalizeShortcutBindings,
  shouldTriggerShortcut,
} from './shortcuts'

type FakeKeyboardEvent = Pick<
  KeyboardEvent,
  'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'repeat' | 'isComposing' | 'target'
>

function keyboardEvent(overrides: Partial<FakeKeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    repeat: false,
    isComposing: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    target: null,
    ...overrides,
  } as unknown as KeyboardEvent
}

function targetWithClosest(selectorMatches: boolean, contentEditable = false): EventTarget {
  return {
    closest: () => (selectorMatches ? {} : null),
    isContentEditable: contentEditable,
  } as unknown as EventTarget
}

describe('normalizeShortcutBindings', () => {
  it.each([null, undefined, 42, 'Ctrl+N', []])('falls back to defaults for non-object input %s', input => {
    expect(normalizeShortcutBindings(input)).toEqual(DEFAULT_SHORTCUT_BINDINGS)
  })

  it('trims string chords and blanks non-string values', () => {
    expect(normalizeShortcutBindings({ newNote: ' Ctrl+N ', saveNote: 7 })).toEqual({
      ...DEFAULT_SHORTCUT_BINDINGS,
      newNote: 'Ctrl+N',
    })
  })

  it('ignores unknown properties and pins the version', () => {
    const result = normalizeShortcutBindings({ version: 99, cycleFace: ' F ', injected: 'x' })
    expect(result.version).toBe(1)
    expect(result.cycleFace).toBe('F')
    expect(result).not.toHaveProperty('injected')
  })
})

describe('formatChordForDisplay', () => {
  it('labels empty or whitespace chords as unset', () => {
    expect(formatChordForDisplay('')).toBe('（未设置）')
    expect(formatChordForDisplay('   ')).toBe('（未设置）')
  })

  it('returns the trimmed chord otherwise', () => {
    expect(formatChordForDisplay(' Ctrl+K ')).toBe('Ctrl+K')
  })
})

describe('normalizeMainKey', () => {
  it.each([
    ['', ''],
    [' ', 'Space'],
    ['Esc', 'Escape'],
    ['a', 'A'],
    ['k', 'K'],
    ['Enter', 'Enter'],
    ['F5', 'F5'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeMainKey(input)).toBe(expected)
  })
})

describe('chordFromKeyboardEvent', () => {
  it('uppercases a single character key without modifiers', () => {
    expect(chordFromKeyboardEvent(keyboardEvent({ key: 'k' }))).toBe('K')
  })

  it('orders modifiers as Ctrl, Alt, Shift, Meta before the main key', () => {
    const event = keyboardEvent({ key: 'z', ctrlKey: true, altKey: true, shiftKey: true, metaKey: true })
    expect(chordFromKeyboardEvent(event)).toBe('Ctrl+Alt+Shift+Meta+Z')
  })

  it.each(['Shift', 'Control', 'Alt', 'Meta', 'Unidentified', 'Dead', ''])(
    'rejects modifier-only or unidentified key %s',
    key => {
      expect(chordFromKeyboardEvent(keyboardEvent({ key }))).toBeNull()
    },
  )

  it('rejects the space key because the raw key is trimmed before parsing', () => {
    expect(chordFromKeyboardEvent(keyboardEvent({ key: ' ' }))).toBeNull()
  })
})

describe('mainKeyFromChord', () => {
  it('returns empty for an empty chord', () => {
    expect(mainKeyFromChord('')).toBe('')
  })

  it.each([
    ['Ctrl+K', 'K'],
    ['Alt+Space', 'Space'],
    ['Ctrl+Shift+S', 'S'],
  ])('extracts the main key of %s as %s', (chord, expected) => {
    expect(mainKeyFromChord(chord)).toBe(expected)
  })
})

describe('isEditableTarget', () => {
  it('returns false for null', () => {
    expect(isEditableTarget(null)).toBe(false)
  })

  it('returns true when the closest editable selector matches', () => {
    expect(isEditableTarget(targetWithClosest(true))).toBe(true)
  })

  it('returns true for contentEditable elements without a matching selector', () => {
    expect(isEditableTarget(targetWithClosest(false, true))).toBe(true)
  })

  it('returns true for contentEditable elements that lack closest()', () => {
    expect(isEditableTarget({ isContentEditable: true } as unknown as EventTarget)).toBe(true)
  })

  it('returns false for plain non-editable elements', () => {
    expect(isEditableTarget(targetWithClosest(false))).toBe(false)
  })
})

describe('chordHasModifier', () => {
  it.each([
    ['', false],
    ['K', false],
    ['Ctrl', false],
    ['Ctrl+K', true],
    ['Alt+X', true],
    ['Shift+Tab', true],
    ['Meta+Space', true],
  ])('reports %s as %s', (chord, expected) => {
    expect(chordHasModifier(chord)).toBe(expected)
  })
})

describe('shouldTriggerShortcut', () => {
  it('never triggers without a configured chord', () => {
    expect(shouldTriggerShortcut(keyboardEvent({ key: 'n' }), '')).toBe(false)
  })

  it('ignores composing and repeated key events', () => {
    expect(shouldTriggerShortcut(keyboardEvent({ key: 'n', isComposing: true }), 'N')).toBe(false)
    expect(shouldTriggerShortcut(keyboardEvent({ key: 'n', repeat: true }), 'N')).toBe(false)
  })

  it('ignores mismatching chords', () => {
    expect(shouldTriggerShortcut(keyboardEvent({ key: 'n' }), 'Ctrl+N')).toBe(false)
  })

  it('triggers a bare key on a non-editable target', () => {
    expect(shouldTriggerShortcut(keyboardEvent({ key: 'n' }), 'N')).toBe(true)
  })

  it('suppresses a bare key inside editable targets', () => {
    expect(shouldTriggerShortcut(keyboardEvent({ key: 'n', target: targetWithClosest(true) }), 'N')).toBe(false)
  })

  it('allows a modified chord inside editable targets', () => {
    const event = keyboardEvent({ key: 'k', ctrlKey: true, target: targetWithClosest(true) })
    expect(shouldTriggerShortcut(event, 'Ctrl+K')).toBe(true)
  })
})
