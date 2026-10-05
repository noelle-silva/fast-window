import { describe, expect, it } from 'vitest'
import { getPdfRenderWindowRequests, type PdfRenderRequest } from './pdfRenderWindow'

/**
 * 行为锁定测试（084 · 拆分期护栏）：
 * 锁定渲染窗口请求列表的页面集合、缩放桶、优先级与去重顺序。
 */

function requests(
  layout: 'scroll' | 'spread',
  pageCount: number,
  spreadStartPage: number,
  visiblePages: number[],
  scale: number,
  scaleStep: number,
  minScale: number,
  maxScale: number,
): PdfRenderRequest[] {
  return getPdfRenderWindowRequests({ layout, pageCount, spreadStartPage, visiblePages, scale, scaleStep, minScale, maxScale })
}

describe('getPdfRenderWindowRequests', () => {
  it('builds spread windows with primary, warm and scale buckets', () => {
    expect(requests('spread', 10, 3, [], 1, 0.25, 0.5, 2)).toEqual([
      { pageNumber: 3, scale: 1, priority: 0 },
      { pageNumber: 4, scale: 1, priority: 0 },
      { pageNumber: 3, scale: 0.75, priority: 1 },
      { pageNumber: 3, scale: 1.25, priority: 1 },
      { pageNumber: 4, scale: 0.75, priority: 1 },
      { pageNumber: 4, scale: 1.25, priority: 1 },
      { pageNumber: 1, scale: 1, priority: 2 },
      { pageNumber: 2, scale: 1, priority: 2 },
      { pageNumber: 5, scale: 1, priority: 2 },
      { pageNumber: 6, scale: 1, priority: 2 },
      { pageNumber: 1, scale: 0.75, priority: 3 },
      { pageNumber: 1, scale: 1.25, priority: 3 },
      { pageNumber: 2, scale: 0.75, priority: 3 },
      { pageNumber: 2, scale: 1.25, priority: 3 },
      { pageNumber: 5, scale: 0.75, priority: 3 },
      { pageNumber: 5, scale: 1.25, priority: 3 },
      { pageNumber: 6, scale: 0.75, priority: 3 },
      { pageNumber: 6, scale: 1.25, priority: 3 },
    ])
  })

  it('builds scroll windows with neighbors as warm pages and dedupes across sets', () => {
    expect(requests('scroll', 5, 1, [2, 3], 1, 0.5, 0.5, 2)).toEqual([
      { pageNumber: 2, scale: 1, priority: 0 },
      { pageNumber: 3, scale: 1, priority: 0 },
      { pageNumber: 2, scale: 0.5, priority: 1 },
      { pageNumber: 2, scale: 1.5, priority: 1 },
      { pageNumber: 3, scale: 0.5, priority: 1 },
      { pageNumber: 3, scale: 1.5, priority: 1 },
      { pageNumber: 1, scale: 1, priority: 2 },
      { pageNumber: 4, scale: 1, priority: 2 },
      { pageNumber: 1, scale: 0.5, priority: 3 },
      { pageNumber: 1, scale: 1.5, priority: 3 },
      { pageNumber: 4, scale: 0.5, priority: 3 },
      { pageNumber: 4, scale: 1.5, priority: 3 },
    ])
  })

  it('drops out-of-range visible pages and neighbors', () => {
    expect(requests('scroll', 3, 1, [1, 5], 1, 1, 0.5, 2)).toEqual([
      { pageNumber: 1, scale: 1, priority: 0 },
      { pageNumber: 1, scale: 0.5, priority: 1 },
      { pageNumber: 1, scale: 2, priority: 1 },
      { pageNumber: 2, scale: 1, priority: 2 },
      { pageNumber: 2, scale: 0.5, priority: 3 },
      { pageNumber: 2, scale: 2, priority: 3 },
    ])
  })

  it('returns no requests for empty visible pages in scroll layout', () => {
    expect(requests('scroll', 5, 1, [], 1, 0.5, 0.5, 2)).toEqual([])
  })

  it('collapses overlapping spread windows into a single deduped set', () => {
    expect(requests('spread', 2, 1, [], 1, 1, 0.5, 2)).toEqual([
      { pageNumber: 1, scale: 1, priority: 0 },
      { pageNumber: 2, scale: 1, priority: 0 },
      { pageNumber: 1, scale: 0.5, priority: 1 },
      { pageNumber: 1, scale: 2, priority: 1 },
      { pageNumber: 2, scale: 0.5, priority: 1 },
      { pageNumber: 2, scale: 2, priority: 1 },
    ])
  })

  it('clamps scale buckets into range and dedupes the clamped values', () => {
    expect(requests('scroll', 3, 1, [1], 2, 1, 0.5, 2)).toEqual([
      { pageNumber: 1, scale: 2, priority: 0 },
      { pageNumber: 1, scale: 1, priority: 1 },
      { pageNumber: 2, scale: 2, priority: 2 },
      { pageNumber: 2, scale: 1, priority: 3 },
    ])
  })

  it('rounds scale buckets to three decimals', () => {
    expect(requests('scroll', 1, 1, [1], 0.1234, 0, 0, 1)).toEqual([
      { pageNumber: 1, scale: 0.123, priority: 0 },
    ])
  })
})
