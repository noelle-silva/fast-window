// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachAssetReaderCtrlWheelZoom, type AssetReaderCtrlWheelZoomHandle } from './assetReaderCtrlWheelZoom'
import type { AssetReaderViewportAnchor } from './assetReaderViewportAnchor'

/**
 * 行为锁定测试（084 · 拆分期护栏）：
 * 锁定 Ctrl/Meta 滚轮缩放的步进、钳制、锚点复用/释放与销毁行为。
 */

const handles: AssetReaderCtrlWheelZoomHandle[] = []

function makeSurface() {
  const surface = document.createElement('div')
  const page = document.createElement('div')
  page.setAttribute('data-asset-reader-page-number', '1')
  page.getBoundingClientRect = () => new DOMRect(0, 0, 500, 600)
  surface.appendChild(page)
  surface.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600)
  Object.defineProperty(surface, 'clientWidth', { value: 800, configurable: true })
  Object.defineProperty(surface, 'clientHeight', { value: 600, configurable: true })
  document.body.appendChild(surface)
  return surface
}

function setup(overrides: Partial<{ scale: number; clampScale: (scale: number) => number; step: number }> = {}) {
  const surface = makeSurface()
  const scaleRef = { value: overrides.scale ?? 1 }
  const setScale = vi.fn((scale: number) => { scaleRef.value = scale })
  const committed = vi.fn<(anchor: AssetReaderViewportAnchor) => void>()
  const handle = attachAssetReaderCtrlWheelZoom({
    surface,
    getScale: () => scaleRef.value,
    setScale,
    onScaleCommitted: committed,
    step: overrides.step ?? 0.1,
    clampScale: overrides.clampScale ?? (scale => Math.min(Math.max(scale, 0.5), 2)),
  })
  handles.push(handle)
  return { surface, scaleRef, setScale, committed, handle }
}

function wheel(surface: HTMLElement, init: WheelEventInit, target?: EventTarget): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
  ;(target ?? surface).dispatchEvent(event)
  return event
}

afterEach(() => {
  handles.splice(0).forEach(handle => handle.destroy())
  document.body.innerHTML = ''
})

describe('attachAssetReaderCtrlWheelZoom', () => {
  it('ignores wheels without the ctrl or meta modifier', () => {
    const { surface, setScale, committed } = setup()
    wheel(surface, { deltaY: -100 })
    expect(setScale).not.toHaveBeenCalled()
    expect(committed).not.toHaveBeenCalled()
  })

  it('ignores ctrl wheels originating from interactive targets', () => {
    const { surface, setScale } = setup()
    const button = document.createElement('button')
    surface.appendChild(button)
    wheel(surface, { deltaY: -100, ctrlKey: true }, button)
    expect(setScale).not.toHaveBeenCalled()
  })

  it('ignores zero deltas', () => {
    const { surface, setScale } = setup()
    wheel(surface, { deltaY: 0, ctrlKey: true })
    expect(setScale).not.toHaveBeenCalled()
  })

  it('zooms in on a negative delta and out on a positive delta', () => {
    const { surface, setScale, committed } = setup()

    wheel(surface, { deltaY: -100, ctrlKey: true })
    expect(setScale).toHaveBeenLastCalledWith(1.1)
    expect(committed).toHaveBeenCalledTimes(1)

    wheel(surface, { deltaY: 100, ctrlKey: true })
    expect(setScale).toHaveBeenLastCalledWith(1)
    expect(committed).toHaveBeenCalledTimes(2)
  })

  it('does nothing when the current scale is invalid', () => {
    const { surface, setScale } = setup({ scale: 0 })
    wheel(surface, { deltaY: -100, ctrlKey: true })
    expect(setScale).not.toHaveBeenCalled()
  })

  it('does nothing when the clamped next scale equals the current scale', () => {
    const { surface, setScale, committed } = setup({ scale: 2 })
    wheel(surface, { deltaY: -100, ctrlKey: true })
    expect(setScale).not.toHaveBeenCalled()
    expect(committed).not.toHaveBeenCalled()
  })

  it('captures the anchor once and reuses it across consecutive wheels', () => {
    const { surface, committed } = setup()
    wheel(surface, { deltaY: -100, ctrlKey: true })
    wheel(surface, { deltaY: -100, ctrlKey: true })
    expect(committed).toHaveBeenCalledTimes(2)
    expect(committed.mock.calls[0][0]).toBe(committed.mock.calls[1][0])
  })

  it('releases the anchor on Control or Meta keyup and recaptures', () => {
    const { surface, committed } = setup()
    wheel(surface, { deltaY: -100, ctrlKey: true })
    const first = committed.mock.calls[0][0]

    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }))
    wheel(surface, { deltaY: -100, ctrlKey: true })
    const second = committed.mock.calls[1][0]

    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta' }))
    wheel(surface, { deltaY: -100, ctrlKey: true })
    const third = committed.mock.calls[2][0]

    expect(second).not.toBe(first)
    expect(third).not.toBe(second)
  })

  it('releases the anchor on window blur', () => {
    const { surface, committed } = setup()
    wheel(surface, { deltaY: -100, ctrlKey: true })
    const first = committed.mock.calls[0][0]

    window.dispatchEvent(new Event('blur'))
    wheel(surface, { deltaY: -100, ctrlKey: true })
    const second = committed.mock.calls[1][0]

    expect(second).not.toBe(first)
  })

  it('stops responding after destroy', () => {
    const { surface, setScale, handle } = setup()
    handle.destroy()
    wheel(surface, { deltaY: -100, ctrlKey: true })
    expect(setScale).not.toHaveBeenCalled()
  })
})
