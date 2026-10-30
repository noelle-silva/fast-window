import { describe, expect, it } from 'vitest'
import {
  createSessionSwitchState,
  reduceSessionSwitch,
  sessionSwitchNeedsSkeleton,
  sessionSwitchPending,
} from './sessionSwitch'

function select(state: any, key: string) {
  return reduceSessionSwitch(state, { type: 'SELECT', key })
}

function painted(state: any, key: string) {
  return reduceSessionSwitch(state, { type: 'PAINTED', key, seq: state.seq })
}

function bodyReady(state: any, key: string) {
  return reduceSessionSwitch(state, { type: 'BODY_READY', key, seq: state.seq })
}

describe('session switch state machine', () => {
  it('keeps the old visible page until the new page is painted', () => {
    let state = createSessionSwitchState()
    state = select(state, 'a')
    expect(state.visibleKey).toBe('')
    expect(sessionSwitchNeedsSkeleton(state)).toBe(true)

    state = bodyReady(state, 'a')
    expect(state.bodyReadyKey).toBe('a')
    // BODY_READY 永不推进可见页。
    expect(state.visibleKey).toBe('')

    state = painted(state, 'a')
    expect(state.visibleKey).toBe('a')
    expect(sessionSwitchPending(state)).toBe(false)
    expect(sessionSwitchNeedsSkeleton(state)).toBe(false)
  })

  it('never advances the visible page from SELECT or BODY_READY', () => {
    let state = createSessionSwitchState()
    state = select(state, 'a')
    state = painted(state, 'a')

    state = select(state, 'b')
    state = bodyReady(state, 'b')
    expect(state.visibleKey).toBe('a')
    expect(sessionSwitchPending(state)).toBe(true)
    expect(sessionSwitchNeedsSkeleton(state)).toBe(false)

    state = painted(state, 'b')
    expect(state.visibleKey).toBe('b')
  })

  it('drops late PAINTED events for a superseded selection (A to B to C)', () => {
    let state = createSessionSwitchState()
    state = select(state, 'a')
    state = painted(state, 'a')

    state = select(state, 'b')
    const bSeq = state.seq
    state = select(state, 'c')
    expect(state.seq).toBeGreaterThan(bSeq)

    // B 的迟到通知：seq 不匹配，静默丢弃。
    const afterLateB = reduceSessionSwitch(state, { type: 'PAINTED', key: 'b', seq: bSeq })
    expect(afterLateB).toBe(state)
    expect(afterLateB.visibleKey).toBe('a')

    state = painted(state, 'c')
    expect(state.visibleKey).toBe('c')
  })

  it('ignores a PAINTED event for a key that is not the current selection', () => {
    let state = createSessionSwitchState()
    state = select(state, 'a')
    const stale = painted(state, 'z')
    expect(stale).toBe(state)
  })

  it('keeps the previous visible page when the selection is cleared', () => {
    let state = createSessionSwitchState()
    state = select(state, 'a')
    state = painted(state, 'a')
    state = select(state, '')
    expect(state.visibleKey).toBe('a')
    expect(state.selectedKey).toBe('a')
  })

  it('is idempotent for repeated identical events', () => {
    let state = createSessionSwitchState()
    state = select(state, 'a')
    state = painted(state, 'a')
    expect(painted(state, 'a')).toBe(state)
    expect(bodyReady(state, 'a')).not.toBe(state)
    const ready = bodyReady(state, 'a')
    expect(bodyReady(ready, 'a')).toBe(ready)
  })

  it('resets to a blank state', () => {
    let state = createSessionSwitchState()
    state = select(state, 'a')
    state = painted(state, 'a')
    const reset = reduceSessionSwitch(state, { type: 'RESET' })
    expect(reset).toEqual(createSessionSwitchState())
  })
})
