import { describe, expect, it } from 'vitest'
import {
  createSessionSwitchState,
  reduceSessionSwitch,
  sessionSwitchFailed,
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

function failed(state: any, key: string, reason = '网络错误') {
  return reduceSessionSwitch(state, { type: 'FAILED', key, seq: state.seq, reason })
}

describe('session switch state machine', () => {
  it('keeps the old visible page until the new page is painted', () => {
    let state = createSessionSwitchState()
    state = select(state, 'a')
    expect(state.visibleKey).toBe('')
    expect(sessionSwitchNeedsSkeleton(state)).toBe(true)

    state = bodyReady(state, 'a')
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
    expect(bodyReady(state, 'a')).toBe(state)
  })

  it('resets to a blank state', () => {
    let state = createSessionSwitchState()
    state = select(state, 'a')
    state = painted(state, 'a')
    const reset = reduceSessionSwitch(state, { type: 'RESET' })
    expect(reset).toEqual(createSessionSwitchState())
  })

  // FAILED 是终态：正文永远等不到时，必须让 UI 收敛到可重试的可见状态，
  // 而不是一直显示「正在打开…」+ 进度条。
  describe('加载失败终态', () => {
    it('进入失败终态后不再是「切换中」', () => {
      let state = createSessionSwitchState()
      state = select(state, 'a')
      expect(sessionSwitchPending(state)).toBe(true)

      state = failed(state, 'a', '网络错误')
      expect(sessionSwitchFailed(state)).toBe(true)
      expect(state.failedReason).toBe('网络错误')
      // 失败不是「还在努力」：进度条必须停。
      expect(sessionSwitchPending(state)).toBe(false)
      expect(sessionSwitchNeedsSkeleton(state)).toBe(false)
    })

    it('失败后换目标会清空失败标记', () => {
      let state = createSessionSwitchState()
      state = select(state, 'a')
      state = failed(state, 'a', '数据损坏')
      expect(sessionSwitchFailed(state)).toBe(true)

      state = select(state, 'b')
      expect(sessionSwitchFailed(state)).toBe(false)
      expect(state.failedReason).toBe('')
      expect(sessionSwitchPending(state)).toBe(true)
    })

    it('失败后正文到达（重试成功）会清空失败标记', () => {
      let state = createSessionSwitchState()
      state = select(state, 'a')
      state = failed(state, 'a', '网络错误')
      state = bodyReady(state, 'a')
      expect(sessionSwitchFailed(state)).toBe(false)
    })

    it('失败后画出页面（迟到的成功）会清空失败标记', () => {
      let state = createSessionSwitchState()
      state = select(state, 'a')
      state = failed(state, 'a', '网络错误')
      state = painted(state, 'a')
      expect(sessionSwitchFailed(state)).toBe(false)
      expect(state.visibleKey).toBe('a')
    })

    it('迟到的 FAILED 不影响新目标', () => {
      let state = createSessionSwitchState()
      state = select(state, 'a')
      state = select(state, 'b')
      const staleSeq = state.seq - 1
      const after = reduceSessionSwitch(state, { type: 'FAILED', key: 'a', seq: staleSeq, reason: '旧失败' })
      expect(after).toBe(state)
      expect(sessionSwitchFailed(after)).toBe(false)
    })

    it('失败态不重复记录同一原因（幂等）', () => {
      let state = createSessionSwitchState()
      state = select(state, 'a')
      state = failed(state, 'a', '网络错误')
      expect(failed(state, 'a', '网络错误')).toBe(state)
    })
  })
})
