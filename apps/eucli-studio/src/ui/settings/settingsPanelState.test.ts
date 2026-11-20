import { describe, expect, it } from 'vitest'
import { readSettingsPanelState } from './settingsPanelState'

// 守卫「设置面板读到的能力清单」与「controller 缓存的清单」结构一致。
// 两者少差一层字段，下拉就会退化成只显示已保存值——现象是协议下拉只剩一个旧值。
describe('设置面板读取能力清单', () => {
  const capabilities = {
    protocols: [
      { value: 'anthropic_latest', label: 'Anthropic (Latest)', description: '' },
      { value: 'openai', label: 'OpenAI 兼容', description: '' },
      { value: 'anthropic_legacy', label: 'Anthropic (Legacy)', description: '' },
    ],
    reasoningEfforts: [
      { value: 'auto', label: 'Auto', description: '' },
      { value: 'high', label: 'High', description: '' },
    ],
  }

  it('从 controller 缓存的 value 字段读出完整清单', () => {
    const controller = {
      getState: () => ({
        providerCapabilities: { value: capabilities, error: '', fetchedAt: 1 },
      }),
    }
    const state = readSettingsPanelState(controller)
    expect(state.providerCapabilities.protocols.map((item: any) => item.value)).toEqual([
      'anthropic_latest',
      'openai',
      'anthropic_legacy',
    ])
    expect(state.providerCapabilities.reasoningEfforts.map((item: any) => item.value)).toEqual(['auto', 'high'])
  })

  it('缓存缺席时返回空数组，不编造选项', () => {
    const state = readSettingsPanelState({ getState: () => ({}) })
    expect(state.providerCapabilities).toEqual({ protocols: [], reasoningEfforts: [] })
  })
})
