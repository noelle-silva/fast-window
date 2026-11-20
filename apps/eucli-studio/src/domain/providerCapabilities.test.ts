import { describe, expect, it } from 'vitest'
import {
  normalizeCapabilityOptions,
  normalizeProviderCapabilities,
  resolveCapabilitySelection,
} from './providerCapabilities'

describe('协议与档位清单', () => {
  it('原样保留业务端取值，只丢空值并去重', () => {
    const options = normalizeCapabilityOptions([
      { value: 'anthropic_latest', label: 'Anthropic (Latest)' },
      { value: '  openai  ', label: 'OpenAI 兼容' },
      { value: '' },
      { value: 'anthropic_latest', label: '重复项' },
      null,
      'not-an-object',
    ])
    // 客户端不认识的新取值也必须原样保留，不能被改写成任何别的值。
    expect(options.map((option) => option.value)).toEqual(['anthropic_latest', 'openai'])
  })

  it('label 缺席时退回取值本身，客户端不发明展示名', () => {
    const options = normalizeCapabilityOptions([{ value: 'brand_new_protocol' }])
    expect(options[0]).toEqual({ value: 'brand_new_protocol', label: 'brand_new_protocol', description: '' })
  })

  it('同时归一协议与思考档位两份清单', () => {
    const capabilities = normalizeProviderCapabilities({
      protocols: [{ value: 'openai', label: 'OpenAI 兼容' }],
      reasoningEfforts: [{ value: 'auto', label: 'Auto' }, { value: 'max', label: 'Max' }],
    })
    expect(capabilities.protocols.map((option) => option.value)).toEqual(['openai'])
    expect(capabilities.reasoningEfforts.map((option) => option.value)).toEqual(['auto', 'max'])
  })

  it('响应缺失时返回空清单而不是编造选项', () => {
    expect(normalizeProviderCapabilities(null)).toEqual({ protocols: [], reasoningEfforts: [] })
    expect(normalizeProviderCapabilities({})).toEqual({ protocols: [], reasoningEfforts: [] })
  })
})

describe('下拉选中项解析', () => {
  const options = normalizeCapabilityOptions([
    { value: 'anthropic_latest', label: 'Anthropic (Latest)' },
    { value: 'openai', label: 'OpenAI 兼容' },
  ])

  it('已保存值在清单里时直接命中', () => {
    const selection = resolveCapabilitySelection(options, 'openai')
    expect(selection.value).toBe('openai')
    expect(selection.label).toBe('OpenAI 兼容')
    expect(selection.options).toHaveLength(2)
  })

  it('没有已保存值时取清单第一项，顺序即业务端的默认顺序', () => {
    expect(resolveCapabilitySelection(options, '').value).toBe('anthropic_latest')
  })

  it('清单里没有已保存值时原样挂上去，不清洗也不丢失', () => {
    // 业务端刚改过枚举、或清单加载失败：用户仍能看到自己保存的值，
    // 同时还能切换成清单里的有效值。
    const selection = resolveCapabilitySelection(options, 'anthropic')
    expect(selection.value).toBe('anthropic')
    expect(selection.label).toBe('anthropic')
    expect(selection.options.map((option) => option.value)).toEqual(['anthropic_latest', 'openai', 'anthropic'])
  })

  it('清单为空且无已保存值时返回空选中项', () => {
    const selection = resolveCapabilitySelection([], '')
    expect(selection.value).toBe('')
    expect(selection.options).toEqual([])
  })

  it('清单为空但有已保存值时仍然只显示它', () => {
    const selection = resolveCapabilitySelection([], 'openai')
    expect(selection.value).toBe('openai')
    expect(selection.options).toEqual([{ value: 'openai', label: 'openai', description: '' }])
  })
})
