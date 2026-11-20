import { describe, expect, it } from 'vitest'
import {
  chatReasoningEffort,
  effectiveReasoningEffort,
  normalizeReasoningEffort,
  normalizeReasoningFields,
  reasoningEffortLabel,
} from './reasoning'

const BOX_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'high', label: 'High' },
]

describe('思考档位在客户端只承载不校验', () => {
  it('原样承载已保存的取值，不判断合法性', () => {
    // 合法性由业务端判定并快速失败；客户端复制一份词表只会制造第二个事实源。
    expect(normalizeReasoningEffort(' brand_new_level ')).toBe('brand_new_level')
    expect(normalizeReasoningEffort(null)).toBe('')
  })

  it('展示名来自业务端清单，清单里没有就原样回显', () => {
    expect(reasoningEffortLabel('high', BOX_OPTIONS)).toBe('High')
    expect(reasoningEffortLabel('brand_new_level', BOX_OPTIONS)).toBe('brand_new_level')
    expect(reasoningEffortLabel('', BOX_OPTIONS)).toBe('')
  })

  it('支持推理时原样承载业务端默认档位', () => {
    const model = normalizeReasoningFields({ id: 'm', supportsReasoning: true, defaultReasoningEffort: 'high' })
    expect(model.defaultReasoningEffort).toBe('high')
  })

  it('不支持推理时摘掉推理字段', () => {
    const model = normalizeReasoningFields({ id: 'm', supportsReasoning: false, defaultReasoningEffort: 'high' })
    expect(model.supportsReasoning).toBeUndefined()
    expect(model.defaultReasoningEffort).toBeUndefined()
  })
})

describe('实际生效档位', () => {
  it('会话覆盖优先于模型默认', () => {
    const profile = { supportsReasoning: true, defaultReasoningEffort: 'high' }
    expect(effectiveReasoningEffort({ reasoningEffort: 'max' }, profile)).toBe('max')
    expect(effectiveReasoningEffort({}, profile)).toBe('high')
  })

  it('都不指定时返回空，由业务端走自己的默认行为', () => {
    expect(effectiveReasoningEffort({}, { supportsReasoning: true, defaultReasoningEffort: '' })).toBe('')
  })

  it('模型不支持推理时一律为空', () => {
    const profile = { supportsReasoning: false, defaultReasoningEffort: '' }
    expect(effectiveReasoningEffort({ reasoningEffort: 'max' }, profile)).toBe('')
  })

  it('会话档位只修剪空白', () => {
    expect(chatReasoningEffort({ reasoningEffort: '  max  ' })).toBe('max')
    expect(chatReasoningEffort(null)).toBe('')
  })
})
