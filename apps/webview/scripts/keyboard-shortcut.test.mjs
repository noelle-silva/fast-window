import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { buildShortcutFromEvent, isEditableTarget } from '../src/keyboard.ts'

function keyEvent(code, modifiers = {}) {
  return {
    code,
    ctrlKey: Boolean(modifiers.ctrlKey),
    altKey: Boolean(modifiers.altKey),
    shiftKey: Boolean(modifiers.shiftKey),
    metaKey: Boolean(modifiers.metaKey),
  }
}

describe('buildShortcutFromEvent', () => {
  it('accepts single keys', () => {
    assert.equal(buildShortcutFromEvent(keyEvent('KeyQ')), 'KeyQ')
    assert.equal(buildShortcutFromEvent(keyEvent('Space')), 'Space')
    assert.equal(buildShortcutFromEvent(keyEvent('F8')), 'F8')
  })

  it('builds modifier combinations in fixed order', () => {
    assert.equal(buildShortcutFromEvent(keyEvent('KeyA', { ctrlKey: true })), 'control+KeyA')
    assert.equal(
      buildShortcutFromEvent(keyEvent('KeyA', { metaKey: true, shiftKey: true, altKey: true, ctrlKey: true })),
      'control+alt+shift+super+KeyA',
    )
  })

  it('rejects pure modifier keys', () => {
    assert.equal(buildShortcutFromEvent(keyEvent('ControlLeft')), null)
    assert.equal(buildShortcutFromEvent(keyEvent('ControlRight', { ctrlKey: true })), null)
    assert.equal(buildShortcutFromEvent(keyEvent('ShiftRight', { shiftKey: true })), null)
    assert.equal(buildShortcutFromEvent(keyEvent('MetaLeft', { metaKey: true })), null)
    assert.equal(buildShortcutFromEvent(keyEvent('CapsLock')), null)
  })

  it('rejects empty and unidentified codes', () => {
    assert.equal(buildShortcutFromEvent(keyEvent('')), null)
    assert.equal(buildShortcutFromEvent(keyEvent('Unidentified')), null)
    assert.equal(buildShortcutFromEvent({ ctrlKey: false }), null)
  })
})

describe('isEditableTarget', () => {
  it('recognizes editable elements', () => {
    assert.equal(isEditableTarget({ tagName: 'INPUT' }), true)
    assert.equal(isEditableTarget({ tagName: 'textarea' }), true)
    assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: true }), true)
    assert.equal(isEditableTarget({ tagName: 'DIV' }), false)
    assert.equal(isEditableTarget(null), false)
  })
})
