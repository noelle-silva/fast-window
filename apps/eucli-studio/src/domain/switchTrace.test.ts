import { afterEach, describe, expect, it } from 'vitest'
import {
  beginSwitchTrace,
  currentSwitchTrace,
  endSwitchTrace,
  markSwitchBoundary,
  nextSwitchId,
  resetSwitchTraceForTests,
  setSwitchTraceSink,
  type SwitchMark,
} from './switchTrace'

describe('switch trace', () => {
  afterEach(() => resetSwitchTraceForTests())

  it('marks boundaries with monotonic elapsed time', () => {
    const marks: SwitchMark[] = []
    setSwitchTraceSink((m) => marks.push(m))
    beginSwitchTrace('session-a')
    markSwitchBoundary('frontend.select')
    markSwitchBoundary('frontend.bodyReady')
    markSwitchBoundary('frontend.painted')

    expect(marks.map((m) => m.boundary)).toEqual([
      'frontend.select',
      'frontend.bodyReady',
      'frontend.painted',
    ])
    expect(new Set(marks.map((m) => m.switchId)).size).toBe(1)
    expect(marks[0].key).toBe('session-a')
    for (let i = 1; i < marks.length; i++) {
      expect(marks[i].sinceStartMs).toBeGreaterThanOrEqual(marks[i - 1].sinceStartMs)
    }
  })

  it('is a no-op when no sink is attached (观测不改变行为)', () => {
    beginSwitchTrace('k')
    expect(() => markSwitchBoundary('frontend.select')).not.toThrow()
    expect(currentSwitchTrace()?.key).toBe('k')
    endSwitchTrace()
    expect(currentSwitchTrace()).toBeNull()
  })

  it('never throws when the sink throws', () => {
    setSwitchTraceSink(() => {
      throw new Error('boom')
    })
    beginSwitchTrace('k')
    expect(() => markSwitchBoundary('frontend.settled')).not.toThrow()
  })

  it('ends a trace with a settled boundary', () => {
    const marks: SwitchMark[] = []
    setSwitchTraceSink((m) => marks.push(m))
    beginSwitchTrace('k')
    endSwitchTrace()
    expect(marks.map((m) => m.boundary)).toEqual(['frontend.settled'])
  })

  it('generates unique switch ids', () => {
    const ids = new Set(Array.from({ length: 20 }, () => nextSwitchId()))
    expect(ids.size).toBe(20)
  })
})
