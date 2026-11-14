// 模型组策略词汇表由业务端持有，客户端只做「整理清单」和「渲染层兜底」两件事。
// 这里锁死两条边界：清单原样落地、已保存的值原样显示。
import { describe, expect, it } from 'vitest'
import { normalizeModelGroupStrategyOptions, resolveModelGroupStrategySelection } from './modelGroupStrategies'

const BOX_STRATEGIES = [
  { value: 'sequential', label: '顺序轮询', description: '按成员顺序轮流使用，均摊负载' },
  { value: 'weighted_random', label: '权重随机', description: '按成员权重随机抽取' },
  { value: 'fallback', label: '故障转移', description: '始终从第一位开始，失败才顺位换下一个' },
]

describe('模型组策略清单归一化', () => {
  it('按业务端顺序原样保留 value / label / description', () => {
    expect(normalizeModelGroupStrategyOptions(BOX_STRATEGIES)).toEqual(BOX_STRATEGIES)
  })

  it('丢掉空值与非对象项，重复 value 只留第一份', () => {
    const options = normalizeModelGroupStrategyOptions([
      { value: 'fallback', label: '故障转移' },
      { value: '', label: '空值' },
      null,
      'fallback',
      { value: '  ', label: '空白' },
      { value: 'fallback', label: '重复' },
      { value: ' weighted_random ', label: ' 权重随机 ' },
    ])

    expect(options).toEqual([
      { value: 'fallback', label: '故障转移', description: '' },
      { value: 'weighted_random', label: '权重随机', description: '' },
    ])
  })

  it('label 缺席时退回策略值本身，客户端不发明名字', () => {
    expect(normalizeModelGroupStrategyOptions([{ value: 'race' }])).toEqual([{ value: 'race', label: 'race', description: '' }])
  })

  it('非数组输入按空清单处理', () => {
    expect(normalizeModelGroupStrategyOptions(undefined)).toEqual([])
    expect(normalizeModelGroupStrategyOptions({ data: BOX_STRATEGIES })).toEqual([])
  })
})

describe('模型组策略渲染层兜底', () => {
  it('已保存值命中清单时，展示名与说明都取自清单', () => {
    const selection = resolveModelGroupStrategySelection(BOX_STRATEGIES, 'fallback')

    expect(selection.value).toBe('fallback')
    expect(selection.label).toBe('故障转移')
    expect(selection.description).toBe('始终从第一位开始，失败才顺位换下一个')
    expect(selection.options).toEqual(BOX_STRATEGIES)
  })

  it('已保存值不在清单里时原样保留，并排在可选项末尾', () => {
    const selection = resolveModelGroupStrategySelection(BOX_STRATEGIES, 'brand_new')

    expect(selection.value).toBe('brand_new')
    expect(selection.label).toBe('brand_new')
    expect(selection.options.map((option) => option.value)).toEqual(['sequential', 'weighted_random', 'fallback', 'brand_new'])
  })

  it('清单为空时只显示已保存的那个值', () => {
    const selection = resolveModelGroupStrategySelection([], 'fallback')

    expect(selection.value).toBe('fallback')
    expect(selection.options).toEqual([{ value: 'fallback', label: 'fallback', description: '' }])
  })

  it('已保存值为空时取清单第一项作为显示值，但不清洗保存值之外的任何东西', () => {
    const selection = resolveModelGroupStrategySelection(BOX_STRATEGIES, '')

    expect(selection.value).toBe('sequential')
    expect(selection.label).toBe('顺序轮询')
  })

  it('清单与已保存值都为空时没有可选项', () => {
    expect(resolveModelGroupStrategySelection([], '')).toEqual({ value: '', label: '', description: '', options: [] })
  })
})
