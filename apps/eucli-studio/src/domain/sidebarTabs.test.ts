import { describe, expect, it } from 'vitest'
import {
  SIDEBAR_TABS_VARIANT_DEFAULT,
  SIDEBAR_TABS_VARIANT_OPTIONS,
  normalizeSidebarTabsVariant,
} from './sidebarTabs'

describe('顶部切换栏样式清单', () => {
  it('清单里的每一项都能归一化回自己', () => {
    for (const option of SIDEBAR_TABS_VARIANT_OPTIONS) {
      expect(normalizeSidebarTabsVariant(option.value)).toBe(option.value)
    }
  })

  it('缺失或认不出的值落到默认样式', () => {
    expect(normalizeSidebarTabsVariant(undefined)).toBe(SIDEBAR_TABS_VARIANT_DEFAULT)
    expect(normalizeSidebarTabsVariant('')).toBe(SIDEBAR_TABS_VARIANT_DEFAULT)
    expect(normalizeSidebarTabsVariant('nope')).toBe(SIDEBAR_TABS_VARIANT_DEFAULT)
  })

  it('最初的经典样式仍在清单里', () => {
    expect(SIDEBAR_TABS_VARIANT_OPTIONS.some((it) => it.value === 'mui')).toBe(true)
  })
})
