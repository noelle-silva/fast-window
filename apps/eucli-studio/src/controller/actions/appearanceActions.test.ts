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
    actions.setSidebarWidth(320)

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
