import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REASONING_EFFORT,
  REASONING_EFFORT_OPTIONS,
  canonicalReasoningEffort,
  normalizeReasoningEffort,
  reasoningEffortLabel,
} from './reasoning'

describe('思考等级词汇表', () => {
  it('按由低到高排列社区通用的七个等级', () => {
    expect(REASONING_EFFORT_OPTIONS.map((option) => option.value)).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultra',
    ])
  })

  it('展示名直接使用源字段', () => {
    expect(reasoningEffortLabel('xhigh')).toBe('X High')
    expect(reasoningEffortLabel('ultra')).toBe('Ultra')
    expect(reasoningEffortLabel('medium')).toBe('Medium')
  })

  it('历史档位归一为新词汇表', () => {
    expect(canonicalReasoningEffort('very_low')).toBe('minimal')
    expect(canonicalReasoningEffort('very_high')).toBe('xhigh')
  })

  it('非法与空值不猜档位', () => {
    expect(canonicalReasoningEffort('extreme')).toBe('')
    expect(canonicalReasoningEffort('')).toBe('')
    expect(normalizeReasoningEffort('extreme')).toBe('')
    expect(normalizeReasoningEffort('extreme', DEFAULT_REASONING_EFFORT)).toBe(DEFAULT_REASONING_EFFORT)
  })
})
