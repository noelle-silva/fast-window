import { describe, expect, it } from 'vitest'
import { SETTINGS_NAVIGATION_ITEMS, mergeSettingsNavigationItems } from './settingsNavigation'

const DEFAULT_VALUES = SETTINGS_NAVIGATION_ITEMS.map((item) => item.value)

describe('mergeSettingsNavigationItems', () => {
  it('没有保存顺序时返回默认顺序', () => {
    expect(mergeSettingsNavigationItems(undefined).map((item) => item.value)).toEqual(DEFAULT_VALUES)
    expect(mergeSettingsNavigationItems(null).map((item) => item.value)).toEqual(DEFAULT_VALUES)
  })

  it('按保存顺序重排全部分类', () => {
    const reversed = [...DEFAULT_VALUES].reverse()
    expect(mergeSettingsNavigationItems(reversed).map((item) => item.value)).toEqual(reversed)
  })

  it('忽略未知值与重复值', () => {
    const merged = mergeSettingsNavigationItems(['tools', 'not-a-tab', 'tools', '', 'appearance']).map((item) => item.value)
    expect(merged.slice(0, 2)).toEqual(['tools', 'appearance'])
    expect(new Set(merged)).toEqual(new Set(DEFAULT_VALUES))
    expect(merged.length).toBe(DEFAULT_VALUES.length)
  })

  it('未覆盖到的分类按默认顺序补在末尾', () => {
    const merged = mergeSettingsNavigationItems(['data', 'appearance']).map((item) => item.value)
    expect(merged.slice(0, 2)).toEqual(['data', 'appearance'])
    expect(merged.length).toBe(DEFAULT_VALUES.length)
    expect(new Set(merged)).toEqual(new Set(DEFAULT_VALUES))
  })

  it('非数组输入回退默认顺序', () => {
    expect(mergeSettingsNavigationItems('not-an-order').map((item) => item.value)).toEqual(DEFAULT_VALUES)
    expect(mergeSettingsNavigationItems({ order: DEFAULT_VALUES }).map((item) => item.value)).toEqual(DEFAULT_VALUES)
  })
})
