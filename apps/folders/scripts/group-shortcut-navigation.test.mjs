import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { advanceGroupShortcutWheelGesture, emptyGroupShortcutWheelGesture, normalizeGroupShortcutWheelDeltaY, resolveShortcutKeyNavigationCommand } from '../src/shortcutNavigation.ts'

describe('group shortcut navigation gestures', () => {
  it('maps arrow keys to collection navigation commands', () => {
    assert.deepEqual(resolveShortcutKeyNavigationCommand('ArrowUp'), { scope: 'group', direction: 'previous' })
    assert.deepEqual(resolveShortcutKeyNavigationCommand('ArrowDown'), { scope: 'group', direction: 'next' })
    assert.deepEqual(resolveShortcutKeyNavigationCommand('ArrowLeft'), { scope: 'category', direction: 'previous' })
    assert.deepEqual(resolveShortcutKeyNavigationCommand('ArrowRight'), { scope: 'category', direction: 'next' })
    assert.equal(resolveShortcutKeyNavigationCommand('Enter'), null)
  })

  it('normalizes wheel delta units to pixels', () => {
    assert.equal(normalizeGroupShortcutWheelDeltaY(5, 0, 720), 5)
    assert.equal(normalizeGroupShortcutWheelDeltaY(5, 1, 720), 80)
    assert.equal(normalizeGroupShortcutWheelDeltaY(1, 2, 720), 720)
  })

  it('accumulates small wheel movement before navigating', () => {
    const first = advanceGroupShortcutWheelGesture(emptyGroupShortcutWheelGesture(), { deltaY: 30, timeStamp: 10 })
    assert.equal(first.direction, null)
    assert.deepEqual(first.gesture, { accumulatedDeltaY: 30, lastEventAt: 10 })

    const second = advanceGroupShortcutWheelGesture(first.gesture, { deltaY: 50, timeStamp: 20 })
    assert.equal(second.direction, 'next')
    assert.deepEqual(second.gesture, emptyGroupShortcutWheelGesture())
  })

  it('resolves negative wheel movement to previous navigation', () => {
    const result = advanceGroupShortcutWheelGesture(emptyGroupShortcutWheelGesture(), { deltaY: -80, timeStamp: 10 })
    assert.equal(result.direction, 'previous')
    assert.deepEqual(result.gesture, emptyGroupShortcutWheelGesture())
  })

  it('resets wheel accumulation when the user reverses direction', () => {
    const first = advanceGroupShortcutWheelGesture(emptyGroupShortcutWheelGesture(), { deltaY: 60, timeStamp: 10 })
    const second = advanceGroupShortcutWheelGesture(first.gesture, { deltaY: -30, timeStamp: 20 })

    assert.equal(second.direction, null)
    assert.deepEqual(second.gesture, { accumulatedDeltaY: -30, lastEventAt: 20 })
  })

  it('resets stale wheel accumulation between separate gestures', () => {
    const first = advanceGroupShortcutWheelGesture(emptyGroupShortcutWheelGesture(), { deltaY: 60, timeStamp: 10 })
    const second = advanceGroupShortcutWheelGesture(first.gesture, { deltaY: 30, timeStamp: 400 })

    assert.equal(second.direction, null)
    assert.deepEqual(second.gesture, { accumulatedDeltaY: 30, lastEventAt: 400 })
  })
})
