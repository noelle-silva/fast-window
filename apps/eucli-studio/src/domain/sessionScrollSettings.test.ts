import { describe, expect, it } from 'vitest'
import {
  SESSION_SCROLL_STEP_PERCENT_DEFAULT,
  SESSION_SCROLL_STEP_PERCENT_MAX,
  SESSION_SCROLL_STEP_PERCENT_MIN,
  normalizeSessionScrollStepPercent,
} from './sessionScrollSettings'

describe('会话翻页步长的取值收敛', () => {
  it('缺失或非法输入回落默认值', () => {
    expect(normalizeSessionScrollStepPercent(undefined)).toBe(SESSION_SCROLL_STEP_PERCENT_DEFAULT)
    expect(normalizeSessionScrollStepPercent(null)).toBe(SESSION_SCROLL_STEP_PERCENT_DEFAULT)
    expect(normalizeSessionScrollStepPercent('')).toBe(SESSION_SCROLL_STEP_PERCENT_DEFAULT)
    expect(normalizeSessionScrollStepPercent('调大一点')).toBe(SESSION_SCROLL_STEP_PERCENT_DEFAULT)
    expect(normalizeSessionScrollStepPercent(Number.NaN)).toBe(SESSION_SCROLL_STEP_PERCENT_DEFAULT)
  })

  it('越界夹到上下限', () => {
    expect(normalizeSessionScrollStepPercent(0)).toBe(SESSION_SCROLL_STEP_PERCENT_MIN)
    expect(normalizeSessionScrollStepPercent(120)).toBe(SESSION_SCROLL_STEP_PERCENT_MAX)
  })

  it('字符串数字可用，小数取整', () => {
    expect(normalizeSessionScrollStepPercent('60')).toBe(60)
    expect(normalizeSessionScrollStepPercent(72.6)).toBe(73)
  })
})
