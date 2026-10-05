import { describe, expect, it } from 'vitest'
import {
  getNextPdfSpreadStartPage,
  getPdfSpreadFitScale,
  getPdfSpreadStartPage,
  getPreviousPdfSpreadStartPage,
} from './pdfReaderLayout'

/**
 * 行为锁定测试（084 · 拆分期护栏）：
 * 只喂输入、看输出，锁定当前实现的真实行为（含越界与怪癖），不验证功能对错。
 */

describe('getPdfSpreadStartPage', () => {
  it('keeps odd pages and pairs even pages with the previous page', () => {
    expect(getPdfSpreadStartPage(1, 10)).toBe(1)
    expect(getPdfSpreadStartPage(2, 10)).toBe(1)
    expect(getPdfSpreadStartPage(3, 10)).toBe(3)
    expect(getPdfSpreadStartPage(4, 10)).toBe(3)
  })

  it('clamps the page into the valid range', () => {
    expect(getPdfSpreadStartPage(0, 10)).toBe(1)
    expect(getPdfSpreadStartPage(-5, 10)).toBe(1)
    expect(getPdfSpreadStartPage(10, 10)).toBe(9)
    expect(getPdfSpreadStartPage(99, 10)).toBe(9)
  })

  it('treats a non-positive page count as a single page', () => {
    expect(getPdfSpreadStartPage(5, 0)).toBe(1)
    expect(getPdfSpreadStartPage(5, -3)).toBe(1)
  })

  it('floors fractional input', () => {
    expect(getPdfSpreadStartPage(3.9, 10)).toBe(3)
    expect(getPdfSpreadStartPage(2.1, 10)).toBe(1)
  })
})

describe('getNextPdfSpreadStartPage', () => {
  it('advances by two and normalizes to an odd spread start', () => {
    expect(getNextPdfSpreadStartPage(1, 10)).toBe(3)
    expect(getNextPdfSpreadStartPage(3, 10)).toBe(5)
  })

  it('clamps at the last spread', () => {
    expect(getNextPdfSpreadStartPage(9, 10)).toBe(9)
    expect(getNextPdfSpreadStartPage(1, 2)).toBe(1)
  })

  it('treats a non-positive page count as a single page', () => {
    expect(getNextPdfSpreadStartPage(1, 0)).toBe(1)
  })
})

describe('getPreviousPdfSpreadStartPage', () => {
  it('steps back by two and normalizes to an odd spread start', () => {
    expect(getPreviousPdfSpreadStartPage(5, 10)).toBe(3)
    expect(getPreviousPdfSpreadStartPage(3, 10)).toBe(1)
  })

  it('clamps at the first spread', () => {
    expect(getPreviousPdfSpreadStartPage(1, 10)).toBe(1)
  })
})

describe('getPdfSpreadFitScale', () => {
  it('fits the page height into the viewport, capped at 1', () => {
    expect(getPdfSpreadFitScale({ width: 600, height: 800 }, { width: 1000, height: 400 })).toBe(0.5)
    expect(getPdfSpreadFitScale({ width: 600, height: 800 }, { width: 1000, height: 1600 })).toBe(1)
  })

  it('returns 1 for invalid page or viewport sizes', () => {
    expect(getPdfSpreadFitScale({ width: 0, height: 800 }, { width: 1000, height: 400 })).toBe(1)
    expect(getPdfSpreadFitScale({ width: 600, height: 0 }, { width: 1000, height: 400 })).toBe(1)
    expect(getPdfSpreadFitScale({ width: 600, height: Number.NaN }, { width: 1000, height: 400 })).toBe(1)
    expect(getPdfSpreadFitScale({ width: Number.POSITIVE_INFINITY, height: 800 }, { width: 1000, height: 400 })).toBe(1)
    expect(getPdfSpreadFitScale({ width: 600, height: 800 }, { width: 1000, height: 0 })).toBe(1)
    expect(getPdfSpreadFitScale({ width: 600, height: 800 }, { width: 1000, height: Number.NaN })).toBe(1)
  })

  it('floors the scale at 0.01 and treats sub-pixel viewports as one pixel', () => {
    expect(getPdfSpreadFitScale({ width: 600, height: 800 }, { width: 1000, height: 1 })).toBe(0.01)
    expect(getPdfSpreadFitScale({ width: 600, height: 800 }, { width: 1000, height: 0.5 })).toBe(0.01)
  })
})
