import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PdfPageRenderCache, getPdfPageFrameKey, type PdfRenderedPageFrame } from './pdfPageRenderCache'

/**
 * 行为锁定测试（084 · 拆分期护栏）：
 * 锁定帧键格式与像素预算 LRU 缓存行为；时间源固定为受控递增计数，保证结果确定。
 */

function frame(key: string, pixelArea: number): PdfRenderedPageFrame {
  return {
    key,
    pageNumber: 1,
    scale: 1,
    canvas: {} as HTMLCanvasElement,
    width: 1,
    height: pixelArea,
    pixelArea,
  }
}

let clock = 0

beforeEach(() => {
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('getPdfPageFrameKey', () => {
  it('formats document, page and rounded scale', () => {
    expect(getPdfPageFrameKey('doc', 3, 1)).toBe('doc:3:1000')
    expect(getPdfPageFrameKey('doc', 3, 1.234)).toBe('doc:3:1234')
    expect(getPdfPageFrameKey('doc', 3, 0.5)).toBe('doc:3:500')
    expect(getPdfPageFrameKey('', 0, 0)).toBe(':0:0')
    expect(getPdfPageFrameKey('doc', 3, -1.5)).toBe('doc:3:-1500')
  })
})

describe('PdfPageRenderCache', () => {
  it('returns null for missing keys and stores frames by key', () => {
    const cache = new PdfPageRenderCache()
    expect(cache.get('missing')).toBeNull()
    const f = frame('a', 10)
    cache.set(f)
    expect(cache.get('a')).toBe(f)
  })

  it('clears all entries and the pixel budget', () => {
    const cache = new PdfPageRenderCache(100)
    cache.set(frame('a', 60))
    cache.clear()
    expect(cache.get('a')).toBeNull()
    cache.set(frame('b', 60))
    expect(cache.get('b')).not.toBeNull()
  })

  it('replaces an existing entry and adjusts the tracked pixel area', () => {
    const cache = new PdfPageRenderCache(100)
    const first = frame('a', 60)
    const second = frame('a', 20)
    cache.set(first)
    cache.set(second)
    expect(cache.get('a')).toBe(second)
    clock += 1
    cache.set(frame('b', 60))
    expect(cache.get('b')).not.toBeNull()
    expect(cache.get('a')).not.toBeNull()
  })

  it('evicts the least recently used entry when the pixel budget is exceeded', () => {
    const cache = new PdfPageRenderCache(100)
    clock = 1
    cache.set(frame('a', 60))
    clock = 2
    cache.set(frame('b', 60))
    expect(cache.get('a')).toBeNull()
    expect(cache.get('b')).not.toBeNull()
  })

  it('treats get as a recency touch', () => {
    const cache = new PdfPageRenderCache(100)
    clock = 1
    cache.set(frame('a', 40))
    clock = 2
    cache.set(frame('b', 40))
    clock = 3
    expect(cache.get('a')).not.toBeNull()

    clock = 4
    cache.set(frame('c', 40))
    expect(cache.get('b')).toBeNull()
    expect(cache.get('a')).not.toBeNull()
    expect(cache.get('c')).not.toBeNull()
  })

  it('self-evicts a single frame that alone exceeds the budget', () => {
    const cache = new PdfPageRenderCache(100)
    cache.set(frame('big', 200))
    expect(cache.get('big')).toBeNull()
  })

  it('uses the default pixel budget of 160,000,000', () => {
    const cache = new PdfPageRenderCache()
    cache.set(frame('big', 160_000_001))
    expect(cache.get('big')).toBeNull()
    clock += 1
    cache.set(frame('ok', 160_000_000))
    expect(cache.get('ok')).not.toBeNull()
  })
})
