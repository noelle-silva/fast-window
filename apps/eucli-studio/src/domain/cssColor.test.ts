import { describe, expect, it } from 'vitest'
import { flattenCssColor, formatCssColor, parseCssColor } from './cssColor'

describe('parseCssColor', () => {
  it('parses 3-digit hex', () => {
    expect(parseCssColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseCssColor('#0a0')).toEqual({ r: 0, g: 170, b: 0, a: 1 })
  })

  it('parses 6-digit hex', () => {
    expect(parseCssColor('#4f72b8')).toEqual({ r: 79, g: 114, b: 184, a: 1 })
    expect(parseCssColor('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
  })

  it('parses 8-digit hex with alpha', () => {
    const parsed = parseCssColor('#00000080')
    expect(parsed?.r).toBe(0)
    expect(parsed?.a).toBeCloseTo(128 / 255, 3)
  })

  it('parses rgb() and rgba() functions', () => {
    expect(parseCssColor('rgb(18, 52, 86)')).toEqual({ r: 18, g: 52, b: 86, a: 1 })
    expect(parseCssColor('rgba(37,99,235,.12)')).toEqual({ r: 37, g: 99, b: 235, a: 0.12 })
    expect(parseCssColor('rgba(238, 247, 244, 0.86)')).toEqual({ r: 238, g: 247, b: 244, a: 0.86 })
  })

  it('rejects non-color values and out-of-range channels', () => {
    expect(parseCssColor('0 10px 26px rgba(15,23,42,.065)')).toBeNull()
    expect(parseCssColor('rgb(300,0,0)')).toBeNull()
    expect(parseCssColor('')).toBeNull()
    expect(parseCssColor(null)).toBeNull()
  })
})

describe('formatCssColor', () => {
  it('formats opaque colors as hex', () => {
    expect(formatCssColor({ r: 79, g: 114, b: 184, a: 1 })).toBe('#4f72b8')
    expect(formatCssColor({ r: 255, g: 255, b: 255, a: 1 })).toBe('#ffffff')
  })

  it('formats translucent colors as rgba', () => {
    expect(formatCssColor({ r: 37, g: 99, b: 235, a: 0.12 })).toBe('rgba(37,99,235,0.12)')
    expect(formatCssColor({ r: 238, g: 247, b: 244, a: 0.86 })).toBe('rgba(238,247,244,0.86)')
  })

  it('clamps channels and rounds values', () => {
    expect(formatCssColor({ r: 300, g: -5, b: 129.6, a: 2 })).toBe('#ff0082')
  })

  it('round-trips parsed values', () => {
    for (const raw of ['#4f72b8', '#eaf4ff', 'rgba(37,99,235,.12)', 'rgba(255,255,255,0.86)']) {
      const parsed = parseCssColor(raw)
      expect(parsed).not.toBeNull()
      expect(parseCssColor(formatCssColor(parsed!))).toEqual(parsed)
    }
  })
})
describe('flattenCssColor 半透明色合成', () => {
  it('把 rgba 叠到底色上，输出不透明 hex', () => {
    expect(flattenCssColor('rgba(37,99,235,.12)', '#ffffff')).toBe('#e5ecfd')
    expect(flattenCssColor('rgba(0,0,0,0.5)', '#ffffff')).toBe('#808080')
  })

  it('不透明颜色规范化成 hex，不受底色影响', () => {
    expect(flattenCssColor('#4F72B8', '#000000')).toBe('#4f72b8')
    expect(flattenCssColor('rgb(18,52,86)', '#ffffff')).toBe('#123456')
  })

  it('无法解析时直接报错，不做静默兜底', () => {
    expect(() => flattenCssColor('not-a-color', '#ffffff')).toThrow()
    expect(() => flattenCssColor('rgba(0,0,0,.5)', 'not-a-color')).toThrow()
  })
})
