import { describe, expect, it } from 'vitest'
import { formatDurationMs } from './time'

describe('formatDurationMs', () => {
  it('formats sub-minute durations as decimal seconds', () => {
    expect(formatDurationMs(241)).toBe('0.2 秒')
    expect(formatDurationMs(1000)).toBe('1.0 秒')
    expect(formatDurationMs(12345)).toBe('12.3 秒')
  })

  it('never rounds up across the minute boundary', () => {
    expect(formatDurationMs(59_999)).toBe('59.9 秒')
    expect(formatDurationMs(60_000)).toBe('1 分 0 秒')
  })

  it('formats longer durations as minutes and seconds', () => {
    expect(formatDurationMs(83_400)).toBe('1 分 23 秒')
    expect(formatDurationMs(125_000)).toBe('2 分 5 秒')
    expect(formatDurationMs(119_600)).toBe('2 分 0 秒')
  })

  it('formats hour-long durations as hours and minutes', () => {
    expect(formatDurationMs(3_600_000)).toBe('1 小时 0 分')
    expect(formatDurationMs(3_720_000)).toBe('1 小时 2 分')
  })

  it('returns an empty label for missing or non-positive values', () => {
    expect(formatDurationMs(0)).toBe('')
    expect(formatDurationMs(-5)).toBe('')
    expect(formatDurationMs(undefined)).toBe('')
    expect(formatDurationMs('abc')).toBe('')
  })
})
