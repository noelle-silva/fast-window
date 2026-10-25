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
