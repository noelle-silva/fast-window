// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import {
  captureAssetReaderViewportAnchor,
  getAssetReaderPageNumberProps,
  getAssetReaderPageSelector,
  restoreAssetReaderViewportAnchor,
} from './assetReaderViewportAnchor'

/**
 * 行为锁定测试（084 · 拆分期护栏）：
 * 锁定“抓取页面锚点”和“按锚点回滚滚动”的外部行为。
 * 布局坐标由受控替身提供，保证结果确定。
 */

function pageElement(pageNumber: string, rect: DOMRect): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('data-asset-reader-page-number', pageNumber)
  el.getBoundingClientRect = () => rect
  return el
}

function surfaceWith(pages: HTMLElement[], surfaceRect: DOMRect, clientWidth: number, clientHeight: number): HTMLElement {
  const surface = document.createElement('div')
  pages.forEach(page => surface.appendChild(page))
  surface.getBoundingClientRect = () => surfaceRect
  Object.defineProperty(surface, 'clientWidth', { value: clientWidth, configurable: true })
  Object.defineProperty(surface, 'clientHeight', { value: clientHeight, configurable: true })
  return surface
}

describe('getAssetReaderPageNumberProps / getAssetReaderPageSelector', () => {
  it('exposes the page number attribute and a matching selector', () => {
    expect(getAssetReaderPageNumberProps(3)).toEqual({ 'data-asset-reader-page-number': 3 })
    expect(getAssetReaderPageSelector(3)).toBe('[data-asset-reader-page-number="3"]')
  })
})

describe('captureAssetReaderViewportAnchor', () => {
  it('anchors to the page under the surface center', () => {
    const page = pageElement('1', new DOMRect(0, 0, 500, 600))
    const surface = surfaceWith([page], new DOMRect(0, 0, 800, 600), 800, 600)

    expect(captureAssetReaderViewportAnchor(surface)).toEqual({
      pageNumber: 1,
      pageRatioX: 0.8,
      pageRatioY: 0.5,
      viewportOffsetX: 400,
      viewportOffsetY: 300,
    })
  })

  it('falls back to the nearest page center when the center misses every page', () => {
    const near = pageElement('1', new DOMRect(0, 0, 200, 200))
    const nearer = pageElement('2', new DOMRect(600, 200, 200, 200))
    const surface = surfaceWith([near, nearer], new DOMRect(0, 0, 800, 600), 800, 600)

    expect(captureAssetReaderViewportAnchor(surface)).toEqual({
      pageNumber: 2,
      pageRatioX: 0,
      pageRatioY: 0.5,
      viewportOffsetX: 400,
      viewportOffsetY: 300,
    })
  })

  it('clamps page ratios into [0, 1]', () => {
    const page = pageElement('1', new DOMRect(100, 100, 100, 100))
    const surface = surfaceWith([page], new DOMRect(0, 0, 800, 600), 800, 600)

    const anchor = captureAssetReaderViewportAnchor(surface)
    expect(anchor).toEqual({
      pageNumber: 1,
      pageRatioX: 1,
      pageRatioY: 1,
      viewportOffsetX: 400,
      viewportOffsetY: 300,
    })
  })

  it('treats zero-size page rectangles as one pixel', () => {
    const page = pageElement('1', new DOMRect(0, 0, 0, 0))
    const surface = surfaceWith([page], new DOMRect(0, 0, 800, 600), 800, 600)

    expect(captureAssetReaderViewportAnchor(surface)?.pageRatioX).toBe(1)
    expect(captureAssetReaderViewportAnchor(surface)?.pageRatioY).toBe(1)
  })

  it('returns null when the page number attribute is not a positive number', () => {
    const page = pageElement('abc', new DOMRect(0, 0, 500, 600))
    const surface = surfaceWith([page], new DOMRect(0, 0, 800, 600), 800, 600)

    expect(captureAssetReaderViewportAnchor(surface)).toBeNull()
  })

  it('returns null when the surface has no pages', () => {
    const surface = surfaceWith([], new DOMRect(0, 0, 800, 600), 800, 600)
    expect(captureAssetReaderViewportAnchor(surface)).toBeNull()
  })
})

describe('restoreAssetReaderViewportAnchor', () => {
  type FakeSurface = {
    getBoundingClientRect: () => DOMRect
    querySelector: (selector: string) => HTMLElement | null
    scrollLeft: number
    scrollTop: number
  }

  function fakeSurface(page: HTMLElement | null, surfaceRect: DOMRect, scrollLeft = 0, scrollTop = 0) {
    const querySelector = vi.fn(() => page)
    const surface: FakeSurface = {
      getBoundingClientRect: () => surfaceRect,
      querySelector,
      scrollLeft,
      scrollTop,
    }
    return { surface, querySelector }
  }

  it('scrolls the surface so the anchored page point returns under the viewport offset', () => {
    const page = { getBoundingClientRect: () => new DOMRect(100, 50, 200, 100) } as unknown as HTMLElement
    const { surface, querySelector } = fakeSurface(page, new DOMRect(0, 0, 800, 600), 0, 0)

    restoreAssetReaderViewportAnchor(surface as unknown as HTMLElement, {
      pageNumber: 1,
      pageRatioX: 0.5,
      pageRatioY: 0.5,
      viewportOffsetX: 50,
      viewportOffsetY: 10,
    })

    expect(querySelector).toHaveBeenCalledWith('[data-asset-reader-page-number="1"]')
    expect(surface.scrollLeft).toBe(150)
    expect(surface.scrollTop).toBe(90)
  })

  it('does nothing for a null anchor', () => {
    const { surface, querySelector } = fakeSurface(null, new DOMRect(0, 0, 800, 600))
    restoreAssetReaderViewportAnchor(surface as unknown as HTMLElement, null)
    expect(querySelector).not.toHaveBeenCalled()
    expect(surface.scrollLeft).toBe(0)
    expect(surface.scrollTop).toBe(0)
  })

  it('does nothing when the anchored page is missing', () => {
    const { surface, querySelector } = fakeSurface(null, new DOMRect(0, 0, 800, 600), 5, 7)
    restoreAssetReaderViewportAnchor(surface as unknown as HTMLElement, {
      pageNumber: 9,
      pageRatioX: 0.5,
      pageRatioY: 0.5,
      viewportOffsetX: 50,
      viewportOffsetY: 10,
    })
    expect(querySelector).toHaveBeenCalledTimes(1)
    expect(surface.scrollLeft).toBe(5)
    expect(surface.scrollTop).toBe(7)
  })
})
