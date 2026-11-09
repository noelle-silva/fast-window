import { describe, expect, it } from 'vitest'
import {
  SIDEBAR_LAYOUT_SETTING_KEY,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  applySidebarSide,
  applySidebarTabsVariant,
  applySidebarWidth,
  migrateSidebarLayout,
  normalizeSidebarLayout,
  resolveSidebarLayout,
} from './sidebarLayout'

describe('侧边栏布局配置', () => {
  it('缺失或非法数据回落到默认：A 靠左、B 靠右、默认宽度', () => {
    expect(normalizeSidebarLayout(null)).toEqual({
      a: { side: 'left', width: SIDEBAR_WIDTH_DEFAULT, tabsVariant: 'soft' },
      b: { side: 'right', width: SIDEBAR_WIDTH_DEFAULT, tabsVariant: 'soft' },
    })
    expect(normalizeSidebarLayout({ side: 'middle', width: 'abc' })).toEqual({
      a: { side: 'left', width: SIDEBAR_WIDTH_DEFAULT, tabsVariant: 'soft' },
      b: { side: 'right', width: SIDEBAR_WIDTH_DEFAULT, tabsVariant: 'soft' },
    })
  })

  it('宽度夹在上下限之间并取整', () => {
    expect(normalizeSidebarLayout({ side: 'right', width: 10 }).a.width).toBe(SIDEBAR_WIDTH_MIN)
    expect(normalizeSidebarLayout({ side: 'right', width: 9999 }).a.width).toBe(SIDEBAR_WIDTH_MAX)
    expect(normalizeSidebarLayout({ side: 'right', width: 260.6 }).a).toEqual({
      side: 'right',
      width: 261,
      tabsVariant: 'soft',
    })
  })

  it('历史扁平配置作为 A 的初值，B 落到对侧', () => {
    const layout = normalizeSidebarLayout({ side: 'right', width: 320 })
    expect(layout.a).toEqual({ side: 'right', width: 320, tabsVariant: 'soft' })
    expect(layout.b).toEqual({ side: 'left', width: SIDEBAR_WIDTH_DEFAULT, tabsVariant: 'soft' })
  })

  it('双栏配置各自保存侧别与宽度', () => {
    const settings = {
      [SIDEBAR_LAYOUT_SETTING_KEY]: {
        a: { side: 'right', width: 300 },
        b: { side: 'left', width: 240 },
      },
    }
    expect(resolveSidebarLayout(settings)).toEqual({
      a: { side: 'right', width: 300, tabsVariant: 'soft' },
      b: { side: 'left', width: 240, tabsVariant: 'soft' },
    })
  })

  it('两栏被写成同一侧时，B 修正到 A 的对面', () => {
    const layout = normalizeSidebarLayout({
      a: { side: 'left', width: 300 },
      b: { side: 'left', width: 240 },
    })
    expect(layout.a.side).toBe('left')
    expect(layout.b.side).toBe('right')
    expect(layout.b.width).toBe(240)
  })

  it('调整任一栏侧别时，另一栏自动翻到对面', () => {
    const base = normalizeSidebarLayout(null)
    const movedB = applySidebarSide(base, 'b', 'left')
    expect(movedB.b.side).toBe('left')
    expect(movedB.a.side).toBe('right')

    const movedA = applySidebarSide(movedB, 'a', 'left')
    expect(movedA.a.side).toBe('left')
    expect(movedA.b.side).toBe('right')
  })

  it('顶部样式两侧各存一份，默认落在默认样式上', () => {
    const base = normalizeSidebarLayout(null)
    expect(base.a.tabsVariant).toBe('soft')
    expect(base.b.tabsVariant).toBe('soft')

    const changed = applySidebarTabsVariant(base, 'b', 'pill')
    expect(changed.b.tabsVariant).toBe('pill')
    expect(changed.a.tabsVariant).toBe('soft')

    expect(applySidebarTabsVariant(changed, 'a', 'nope').a.tabsVariant).toBe('soft')
  })

  it('旧配置没有样式字段时补默认值，已有的值原样保留', () => {
    const migrated = normalizeSidebarLayout({ a: { side: 'left', width: 300 }, b: { side: 'right', width: 240, tabsVariant: 'dot' } })
    expect(migrated.a.tabsVariant).toBe('soft')
    expect(migrated.b.tabsVariant).toBe('dot')
  })

  it('宽度只改目标栏，两栏互不影响', () => {
    const base = normalizeSidebarLayout(null)
    const widened = applySidebarWidth(base, 'b', 420)
    expect(widened.b.width).toBe(420)
    expect(widened.a.width).toBe(SIDEBAR_WIDTH_DEFAULT)
    expect(applySidebarWidth(base, 'b', 9999).b.width).toBe(SIDEBAR_WIDTH_MAX)
  })

  it('旧的角色 / 工作区两套配置在迁移时合并为一份，并删除旧键', () => {
    const settings = {
      uiMode: {
        role: { sidebarSide: 'right', sidebarWidth: 340 },
        workspace: { sidebarSide: 'left', sidebarWidth: 280 },
      },
    }

    const layout = migrateSidebarLayout(settings)

    expect(layout.a).toEqual({ side: 'right', width: 340, tabsVariant: 'soft' })
    expect(layout.b.side).toBe('left')
    expect((settings as any)[SIDEBAR_LAYOUT_SETTING_KEY]).toEqual(layout)
    expect('uiMode' in settings).toBe(false)
  })

  it('新配置已存在时优先使用新配置，旧键仍然清除', () => {
    const settings = {
      [SIDEBAR_LAYOUT_SETTING_KEY]: { a: { side: 'left', width: 300 }, b: { side: 'right', width: 260 } },
      uiMode: { role: { sidebarSide: 'right', sidebarWidth: 500 } },
    }

    const layout = migrateSidebarLayout(settings)
    expect(layout.a).toEqual({ side: 'left', width: 300, tabsVariant: 'soft' })
    expect(layout.b).toEqual({ side: 'right', width: 260, tabsVariant: 'soft' })
    expect('uiMode' in settings).toBe(false)
  })
})
