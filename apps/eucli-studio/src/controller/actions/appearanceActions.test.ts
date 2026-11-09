import { describe, expect, it, vi } from 'vitest'
import { createAppearanceActions } from './appearanceActions'

function setup(settings: Record<string, any> = {}) {
  const state: any = { data: { settings }, draft: {} }
  const emit = vi.fn()
  const saveMeta = vi.fn(async () => {})
  const actions = createAppearanceActions({
    state,
    emit,
    saveMeta,
    currentRenderSafetyPolicy: () => 'original',
  })
  return { state, emit, saveMeta, actions }
}

describe('外观通知地址', () => {
  it('外观设置变化走 settings 地址，不触发全局广播', () => {
    const state: any = { data: { settings: {} }, draft: {} }
    const emit = vi.fn()
    const emitScope = vi.fn()
    const actions = createAppearanceActions({
      state,
      emit,
      emitScope,
      saveMeta: vi.fn(async () => {}),
      currentRenderSafetyPolicy: () => 'original',
    })

    actions.setChatFontSize(18, false)
    actions.setSidebarWidth('a', 320)

    expect(emitScope.mock.calls.map((call) => call[0])).toEqual(['settings', 'settings'])
    expect(emit).not.toHaveBeenCalled()
  })
})

describe('消息屏外跳过开关', () => {
  it('切换后立即更新设置并持久化', () => {
    const { state, emit, saveMeta, actions } = setup()

    actions.setMessageOffscreenSkipEnabled(false)
    expect(state.data.settings.messageOffscreenSkipEnabled).toBe(false)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(saveMeta).toHaveBeenCalledTimes(1)

    actions.setMessageOffscreenSkipEnabled(true)
    expect(state.data.settings.messageOffscreenSkipEnabled).toBe(true)
    expect(emit).toHaveBeenCalledTimes(2)
    expect(saveMeta).toHaveBeenCalledTimes(2)
  })
})

describe('模型按钮显示供应商开关', () => {
  it('切换后立即更新设置并持久化', () => {
    const { state, emit, saveMeta, actions } = setup()

    actions.setComposerModelShowProvider(true)
    expect(state.data.settings.composerModelShowProvider).toBe(true)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(saveMeta).toHaveBeenCalledTimes(1)

    actions.setComposerModelShowProvider(false)
    expect(state.data.settings.composerModelShowProvider).toBe(false)
    expect(emit).toHaveBeenCalledTimes(2)
    expect(saveMeta).toHaveBeenCalledTimes(2)
  })
})

describe('侧边栏 A / B 布局动作', () => {
  it('调整一侧位置会让另一侧翻到对面，并落盘', () => {
    const { state, saveMeta, actions } = setup()

    actions.setSidebarSide('b', 'left')

    expect(state.data.settings.sidebarLayout).toEqual({
      a: { side: 'right', width: 260, tabsVariant: 'soft' },
      b: { side: 'left', width: 260, tabsVariant: 'soft' },
    })
    expect(saveMeta).toHaveBeenCalledTimes(1)
  })

  it('宽度按侧边栏身份分别保存', () => {
    const { state, actions } = setup()

    actions.setSidebarWidth('b', 380)

    expect(state.data.settings.sidebarLayout.b.width).toBe(380)
    expect(state.data.settings.sidebarLayout.a.width).toBe(260)
    expect(state.data.settings.sidebarLayout.b.side).toBe('right')
  })

  it('两侧的顶部样式各存一份', () => {
    const { state, actions } = setup()

    actions.setSidebarTabsVariant('a', 'pill')
    actions.setSidebarTabsVariant('b', 'dot')

    expect(state.data.settings.sidebarLayout.a.tabsVariant).toBe('pill')
    expect(state.data.settings.sidebarLayout.b.tabsVariant).toBe('dot')
  })
})

describe('输入区按钮布局动作', () => {
  it('勾选迁移会落盘并按区域重新排列', () => {
    const { state, saveMeta, actions } = setup()

    actions.setComposerToolOnToolbar('image-picker', false)
    const layout = state.data.settings.composerToolsLayout
    expect(layout.inline).not.toContain('image-picker')
    expect(layout.menu).toContain('image-picker')
    expect(saveMeta).toHaveBeenCalledTimes(1)

    actions.setComposerToolOnToolbar('image-picker', true)
    expect(state.data.settings.composerToolsLayout.inline).toContain('image-picker')
    expect(saveMeta).toHaveBeenCalledTimes(2)
  })

  it('区域内拖拽换位会落盘', () => {
    const { state, saveMeta, actions } = setup()

    actions.moveComposerToolWithinArea('stream-toggle', 'image-picker')

    const inline = state.data.settings.composerToolsLayout.inline
    expect(inline[0]).toBe('stream-toggle')
    expect(inline[1]).toBe('image-picker')
    expect(saveMeta).toHaveBeenCalledTimes(1)
  })

  it('跨区域拖拽不改动布局', () => {
    const { state, actions } = setup()
    actions.setComposerToolOnToolbar('clean-reasoning', false)
    const before = JSON.parse(JSON.stringify(state.data.settings.composerToolsLayout))

    actions.moveComposerToolWithinArea('image-picker', 'clean-reasoning')

    expect(state.data.settings.composerToolsLayout).toEqual(before)
  })
})

describe('条目悬停图标开关', () => {
  it('工作桌面与收藏夹各存一份', () => {
    const { state, saveMeta, actions } = setup()
    const settings = state.data.settings as any

    actions.setFavoriteHoverRoleIcon(false)
    expect(settings.favoriteHoverShowsRoleIcon).toBe(false)
    expect(settings.deskHoverShowsRoleIcon).toBeUndefined()

    actions.setDeskHoverRoleIcon(false)
    expect(settings.deskHoverShowsRoleIcon).toBe(false)
    expect(saveMeta).toHaveBeenCalledTimes(2)
  })

  it('再次打开时写成明确的开', () => {
    const { state, actions } = setup({ favoriteHoverShowsRoleIcon: false })

    actions.setFavoriteHoverRoleIcon(true)

    expect(state.data.settings.favoriteHoverShowsRoleIcon).toBe(true)
  })
})
