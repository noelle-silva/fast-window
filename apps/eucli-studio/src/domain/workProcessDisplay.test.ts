import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORK_PROCESS_DISPLAY_MODE,
  normalizeWorkProcessDisplayEnabled,
  normalizeWorkProcessDisplayMode,
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
})
