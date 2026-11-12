import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORK_PROCESS_DISPLAY_MODE,
  normalizeWorkProcessDisplayEnabled,
  normalizeWorkProcessDisplayMode,
  normalizeWorkProcessInnerScrollEnabled,
  normalizeWorkProcessInnerScrollHeight,
  normalizeWorkProcessInnerScrollWidth,
  workProcessExpandedByMode,
} from './workProcessDisplay'

describe('工作过程显示设置', () => {
  it('开关默认开启，只有显式 false 才关闭', () => {
    expect(normalizeWorkProcessDisplayEnabled(undefined)).toBe(true)
    expect(normalizeWorkProcessDisplayEnabled(null)).toBe(true)
    expect(normalizeWorkProcessDisplayEnabled(true)).toBe(true)
    expect(normalizeWorkProcessDisplayEnabled(false)).toBe(false)
    expect(normalizeWorkProcessDisplayEnabled('false')).toBe(false)
  })

  it('展开方式默认取输出中展开、完成后收起', () => {
    expect(DEFAULT_WORK_PROCESS_DISPLAY_MODE).toBe('collapse-when-done')
    expect(normalizeWorkProcessDisplayMode(undefined)).toBe('collapse-when-done')
    expect(normalizeWorkProcessDisplayMode('乱写')).toBe('collapse-when-done')
    expect(normalizeWorkProcessDisplayMode('never-expand')).toBe('never-expand')
    expect(normalizeWorkProcessDisplayMode('stay-expanded')).toBe('stay-expanded')
  })

  it('三档在运行中与结束后给出各自的展开结果', () => {
    expect(workProcessExpandedByMode('never-expand', true)).toBe(false)
    expect(workProcessExpandedByMode('never-expand', false)).toBe(false)
    expect(workProcessExpandedByMode('collapse-when-done', true)).toBe(true)
    expect(workProcessExpandedByMode('collapse-when-done', false)).toBe(false)
    expect(workProcessExpandedByMode('stay-expanded', true)).toBe(true)
    expect(workProcessExpandedByMode('stay-expanded', false)).toBe(true)
  })

  it('内部滚动默认关闭，高度收敛在允许区间', () => {
    expect(normalizeWorkProcessInnerScrollEnabled(undefined)).toBe(false)
    expect(normalizeWorkProcessInnerScrollEnabled(true)).toBe(true)
    expect(normalizeWorkProcessInnerScrollHeight(undefined)).toBe(480)
    expect(normalizeWorkProcessInnerScrollHeight(100)).toBe(200)
    expect(normalizeWorkProcessInnerScrollHeight(5000)).toBe(1200)
    expect(normalizeWorkProcessInnerScrollHeight(640)).toBe(640)
  })

  it('宽度按百分比收敛，缺省取 85%，越界钳到上下限', () => {
    expect(normalizeWorkProcessInnerScrollWidth(undefined)).toBe(85)
    expect(normalizeWorkProcessInnerScrollWidth('乱写')).toBe(85)
    expect(normalizeWorkProcessInnerScrollWidth(10)).toBe(60)
    expect(normalizeWorkProcessInnerScrollWidth(180)).toBe(100)
    expect(normalizeWorkProcessInnerScrollWidth(65)).toBe(65)
    // 100 表示不收窄，是合法值而不是越界。
    expect(normalizeWorkProcessInnerScrollWidth(100)).toBe(100)
    expect(normalizeWorkProcessInnerScrollWidth(72.6)).toBe(73)
  })
})
