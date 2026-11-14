// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SurfaceTuningBlock } from './SurfaceTuningBlock'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const WALLPAPER_ON = {
  wallpaper: {
    enabled: true,
    activeId: 'w1',
    presets: [{ id: 'w1', relPath: 'wallpapers/w1.webp', view: { x: 50, y: 50, scale: 1 } }],
  },
}

describe('壁纸区块内的组件调节子块', () => {
  let host: HTMLDivElement | null = null
  let root: any = null

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount()
      })
      root = null
    }
    host?.remove()
    host = null
  })

  function renderBlock(settings: Record<string, any>, actions: Record<string, any> = {}) {
    return <SurfaceTuningBlock controller={{ actions, capabilities: {} }} loading={false} settings={settings} />
  }

  function sliderInputs(): HTMLInputElement[] {
    return Array.from(host!.querySelectorAll('input[type="range"]')) as HTMLInputElement[]
  }

  it('六行读数按外观设计稿默认值渲染', async () => {
    await act(async () => {
      root.render(renderBlock({}))
    })

    const texts = Array.from(host!.querySelectorAll('p, span')).map((node) => node.textContent)
    for (const label of ['组件调节', '聊天背景透明度', '聊天背景磨砂度', '顶部栏透明度', '顶部栏磨砂度', '输入栏透明度', '输入栏磨砂度']) {
      expect(texts).toContain(label)
    }
    expect(texts).toContain('59%')
    expect(texts).toContain('0%')
    expect(texts).toContain('86%')
    expect(texts).toContain('10px')
    expect(texts.filter((text) => text === '3px')).toHaveLength(2)
  })

  it('壁纸未启用时滑块停用，启用壁纸后全部可用', async () => {
    await act(async () => {
      root.render(renderBlock({}))
    })
    expect(sliderInputs()).toHaveLength(6)
    expect(sliderInputs().every((input) => input.disabled)).toBe(true)

    await act(async () => {
      root.render(renderBlock(WALLPAPER_ON))
    })
    expect(sliderInputs()).toHaveLength(6)
    expect(sliderInputs().every((input) => !input.disabled)).toBe(true)
  })

  it('每行滑杆拿到的取值范围与当前值互不串行', async () => {
    await act(async () => {
      root.render(renderBlock(WALLPAPER_ON))
    })

    const ranges = sliderInputs().map((input) => [input.min, input.max, input.value])
    expect(ranges).toEqual([
      ['0', '100', '59'],
      ['0', '24', '3'],
      ['0', '100', '0'],
      ['0', '24', '3'],
      ['40', '100', '86'],
      ['0', '24', '10'],
    ])
  })

  it('键盘微调只回传本行对应的动作', async () => {
    const setComposerOpacity = vi.fn()
    const setChatBgOpacity = vi.fn()

    await act(async () => {
      root.render(renderBlock(WALLPAPER_ON, { setComposerOpacity, setChatBgOpacity }))
    })

    const composerOpacityInput = sliderInputs()[4]
    await act(async () => {
      composerOpacityInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })

    expect(setComposerOpacity).toHaveBeenCalled()
    expect(setComposerOpacity.mock.calls[0][0]).toBe(87)
    expect(setChatBgOpacity).not.toHaveBeenCalled()
  })
})
