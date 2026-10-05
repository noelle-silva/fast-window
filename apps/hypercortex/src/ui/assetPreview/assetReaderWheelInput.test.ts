// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import {
  attachAssetReaderWheelListener,
  claimAssetReaderWheelEvent,
  dominantAssetReaderWheelDelta,
  isAssetReaderModifierWheel,
  isInteractiveAssetReaderWheelTarget,
  normalizeAssetReaderWheelDelta,
  READER_WHEEL_DELTA_PAGE,
} from './assetReaderWheelInput'

/**
 * 行为锁定测试（084 · 拆分期护栏）：
 * 锁定滚轮输入的判定、归一化与监听器挂载/卸载行为。
 */

function wheelEvent(init: WheelEventInit): WheelEvent {
  return new WheelEvent('wheel', init)
}

describe('dominantAssetReaderWheelDelta', () => {
  it('picks the axis with the larger absolute delta', () => {
    expect(dominantAssetReaderWheelDelta(wheelEvent({ deltaX: 10, deltaY: 3 }))).toBe(10)
    expect(dominantAssetReaderWheelDelta(wheelEvent({ deltaX: 3, deltaY: -10 }))).toBe(-10)
  })

  it('falls back to deltaY on ties', () => {
    expect(dominantAssetReaderWheelDelta(wheelEvent({ deltaX: 5, deltaY: 5 }))).toBe(5)
    expect(dominantAssetReaderWheelDelta(wheelEvent({ deltaX: -5, deltaY: 5 }))).toBe(5)
  })
})

describe('isAssetReaderModifierWheel', () => {
  it('is true for ctrl or meta wheels only', () => {
    expect(isAssetReaderModifierWheel(wheelEvent({ ctrlKey: true }))).toBe(true)
    expect(isAssetReaderModifierWheel(wheelEvent({ metaKey: true }))).toBe(true)
    expect(isAssetReaderModifierWheel(wheelEvent({}))).toBe(false)
  })
})

describe('claimAssetReaderWheelEvent', () => {
  it('prevents default and stops propagation in all directions', () => {
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as WheelEvent

    claimAssetReaderWheelEvent(event)

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1)
  })
})

describe('isInteractiveAssetReaderWheelTarget', () => {
  it('flags form controls, buttons and ignore-marked targets', () => {
    const surface = document.createElement('div')
    const targets: HTMLElement[] = []
    for (const tag of ['input', 'textarea', 'select', 'button']) {
      const el = document.createElement(tag)
      surface.appendChild(el)
      targets.push(el)
    }
    const roleButton = document.createElement('div')
    roleButton.setAttribute('role', 'button')
    surface.appendChild(roleButton)
    targets.push(roleButton)
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    surface.appendChild(editable)
    targets.push(editable)
    const ignored = document.createElement('div')
    ignored.setAttribute('data-asset-reader-wheel-ignore', '')
    surface.appendChild(ignored)
    targets.push(ignored)

    for (const target of targets) {
      expect(isInteractiveAssetReaderWheelTarget(target)).toBe(true)
    }
  })

  it('is false for plain targets, null and closest-less objects', () => {
    expect(isInteractiveAssetReaderWheelTarget(document.createElement('div'))).toBe(false)
    expect(isInteractiveAssetReaderWheelTarget(null)).toBe(false)
    expect(isInteractiveAssetReaderWheelTarget({} as unknown as EventTarget)).toBe(false)
  })
})

describe('normalizeAssetReaderWheelDelta', () => {
  it('returns 0 for non-finite or zero deltas', () => {
    const surface = document.createElement('div')
    expect(normalizeAssetReaderWheelDelta(wheelEvent({ deltaMode: 0 }), 0, surface)).toBe(0)
    expect(normalizeAssetReaderWheelDelta(wheelEvent({ deltaMode: 0 }), Number.NaN, surface)).toBe(0)
    expect(normalizeAssetReaderWheelDelta(wheelEvent({ deltaMode: 0 }), Number.POSITIVE_INFINITY, surface)).toBe(0)
  })

  it('passes pixel deltas through unchanged', () => {
    const surface = document.createElement('div')
    expect(normalizeAssetReaderWheelDelta(wheelEvent({ deltaMode: 0 }), 10, surface)).toBe(10)
  })

  it('scales line deltas by 40 pixels', () => {
    const surface = document.createElement('div')
    expect(normalizeAssetReaderWheelDelta(wheelEvent({ deltaMode: 1 }), 2, surface)).toBe(80)
  })

  it('scales page deltas by the surface height, floored at one pixel', () => {
    const surface = document.createElement('div')
    Object.defineProperty(surface, 'clientHeight', { value: 500, configurable: true })
    expect(normalizeAssetReaderWheelDelta(wheelEvent({ deltaMode: READER_WHEEL_DELTA_PAGE }), 2, surface)).toBe(1000)

    const zeroHeight = document.createElement('div')
    Object.defineProperty(zeroHeight, 'clientHeight', { value: 0, configurable: true })
    expect(normalizeAssetReaderWheelDelta(wheelEvent({ deltaMode: READER_WHEEL_DELTA_PAGE }), 2, zeroHeight)).toBe(2)
  })
})

describe('attachAssetReaderWheelListener', () => {
  it('attaches a non-passive capture listener and removes it on destroy', () => {
    const surface = document.createElement('div')
    const addSpy = vi.spyOn(surface, 'addEventListener')
    const listener = vi.fn()

    const handle = attachAssetReaderWheelListener(surface, listener)

    expect(addSpy).toHaveBeenCalledWith('wheel', listener, { passive: false, capture: true })
    surface.dispatchEvent(wheelEvent({ deltaY: 1, bubbles: true, cancelable: true }))
    expect(listener).toHaveBeenCalledTimes(1)

    handle.destroy()
    surface.dispatchEvent(wheelEvent({ deltaY: 1, bubbles: true, cancelable: true }))
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
