import { describe, expect, it } from 'vitest'
import {
  SIDEBAR_LAYOUT_SETTING_KEY,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  migrateSidebarLayout,
  normalizeSidebarLayout,
  resolveSidebarLayout,
} from './sidebarLayout'

describe('侧边栏布局配置', () => {
  it('缺失或非法数据回落到默认：左侧 + 默认宽度', () => {
    expect(normalizeSidebarLayout(null)).toEqual({ side: 'left', width: SIDEBAR_WIDTH_DEFAULT })
    expect(normalizeSidebarLayout({ side: 'middle', width: 'abc' })).toEqual({
      side: 'left',
      width: SIDEBAR_WIDTH_DEFAULT,
    })
  })

  it('宽度夹在上下限之间并取整', () => {
    expect(normalizeSidebarLayout({ side: 'right', width: 10 }).width).toBe(SIDEBAR_WIDTH_MIN)
    expect(normalizeSidebarLayout({ side: 'right', width: 9999 }).width).toBe(SIDEBAR_WIDTH_MAX)
    expect(normalizeSidebarLayout({ side: 'right', width: 260.6 })).toEqual({ side: 'right', width: 261 })
  })

  it('读取只认统一侧边栏配置', () => {
    const settings = { [SIDEBAR_LAYOUT_SETTING_KEY]: { side: 'right', width: 320 } }
    expect(resolveSidebarLayout(settings)).toEqual({ side: 'right', width: 320 })
  })

  it('旧的角色 / 工作区两套配置在迁移时合并为一份，并删除旧键', () => {
    const settings = {
      uiMode: {
        role: { sidebarSide: 'right', sidebarWidth: 340 },
        workspace: { sidebarSide: 'left', sidebarWidth: 280 },
      },
    }

    const layout = migrateSidebarLayout(settings)

    expect(layout).toEqual({ side: 'right', width: 340 })
    expect(settings).toEqual({ [SIDEBAR_LAYOUT_SETTING_KEY]: { side: 'right', width: 340 } })
    expect('uiMode' in settings).toBe(false)
  })

  it('新配置已存在时优先使用新配置，旧键仍然清除', () => {
    const settings = {
      [SIDEBAR_LAYOUT_SETTING_KEY]: { side: 'left', width: 300 },
      uiMode: { role: { sidebarSide: 'right', sidebarWidth: 500 } },
    }

    expect(migrateSidebarLayout(settings)).toEqual({ side: 'left', width: 300 })
    expect(settings).toEqual({ [SIDEBAR_LAYOUT_SETTING_KEY]: { side: 'left', width: 300 } })
  })
})
