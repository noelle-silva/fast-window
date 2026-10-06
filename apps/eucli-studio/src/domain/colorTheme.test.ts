import { describe, expect, it } from 'vitest'
import {
  BASE_COLOR_KEYS,
  COLOR_THEME_BUILTIN_PRESETS,
  getColorThemeColors,
  normalizeColorThemePreset,
  parseColorThemePresetImport,
  type BaseColors,
} from './colorTheme'
import { parseCssColor } from './cssColor'
import { wcagContrast } from 'culori'

const base: BaseColors = {
  background: '#eaf2f7',
  surface: '#fffaf3',
  surfaceCode: '#0b1220',
  primary: '#4f72b8',
  secondary: '#7c3aed',
  text: '#0f172a',
  border: 'rgba(15,23,42,.12)',
  success: '#16a34a',
  warning: '#d97706',
  danger: '#dc2626',
}

describe('getColorThemeColors', () => {
  it('derives a complete palette from base colors', () => {
    const colors = getColorThemeColors({ id: 'x', name: 'x', description: '', mode: 'light', baseColors: base })
    expect(colors.canvas).toBe(base.background)
    expect(colors.appBackground).toBe(base.background)
    expect(colors.paper).toBe(base.surface)
    expect(colors.primary).toBe(base.primary)
    expect(colors.secondary).toBe(base.secondary)
  })

  it('derives a complete, non-empty palette for every builtin preset', () => {
    // focus / *Shadow 字段是 CSS box-shadow 片段，不是颜色本身。
    const isShadowField = (key: string) => key === 'focus' || /shadow/i.test(key)
    for (const preset of COLOR_THEME_BUILTIN_PRESETS) {
      const colors = getColorThemeColors(preset) as Record<string, string>
      for (const [key, value] of Object.entries(colors)) {
        expect(typeof value, `${preset.id}.${key}`).toBe('string')
        expect(value.trim(), `${preset.id}.${key}`).not.toBe('')
        if (!isShadowField(key)) {
          expect(parseCssColor(value), `${preset.id}.${key} = ${value}`).not.toBeNull()
        }
      }
    }
  })

  it('keeps system text parseable on a dark background', () => {
    const dark = getColorThemeColors({ id: 'x', name: 'x', description: '', mode: 'dark', baseColors: { ...base, background: '#0d1020', text: '#f8fafc' } })
    expect(parseCssColor(dark.textPrimary)).not.toBeNull()
    expect(parseCssColor(dark.systemText)).not.toBeNull()
  })

  it('keeps text readable (>=4.5 contrast) on every builtin preset', () => {
    for (const preset of COLOR_THEME_BUILTIN_PRESETS) {
      const colors = getColorThemeColors(preset)
      const ratio = wcagContrast(colors.textPrimary, colors.appBackground)
      expect(ratio, `${preset.id} textPrimary`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps code text readable on every builtin preset code surface', () => {
    for (const preset of COLOR_THEME_BUILTIN_PRESETS) {
      const colors = getColorThemeColors(preset)
      const ratio = wcagContrast(colors.codeText, colors.codeBackground)
      expect(ratio, `${preset.id} codeText`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps system text readable on every builtin preset', () => {
    for (const preset of COLOR_THEME_BUILTIN_PRESETS) {
      const colors = getColorThemeColors(preset)
      const ratio = wcagContrast(colors.systemText, colors.paper)
      expect(ratio, `${preset.id} systemText`).toBeGreaterThanOrEqual(3)
    }
  })

  it('derives distinct status text from base status colors via lighten/darken', () => {
    const light = getColorThemeColors({ id: 'x', name: 'x', description: '', mode: 'light', baseColors: base })
    const dark = getColorThemeColors({ id: 'x', name: 'x', description: '', mode: 'dark', baseColors: { ...base, background: '#0d1020', text: '#f8fafc' } })
    // 明暗调整必须真正改变颜色，否则说明 HSL 转换失效。
    expect(light.dangerText).not.toBe(base.danger)
    expect(dark.dangerText).not.toBe(base.danger)
  })

  it('picks a readable button label on the primary color', () => {
    const light = getColorThemeColors({ id: 'x', name: 'x', description: '', mode: 'light', baseColors: base })
    expect(wcagContrast(light.buttonText, base.primary)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('normalizeColorThemePreset', () => {
  it('accepts a valid preset and keeps baseColors as the source of truth', () => {
    const preset = normalizeColorThemePreset({ id: 'my-preset', name: '我的配色', mode: 'dark', baseColors: base }, 'fallback')
    expect(preset.id).toBe('my-preset')
    expect(preset.mode).toBe('dark')
    expect(preset.baseColors).toEqual(base)
  })

  it('rejects presets missing base colors', () => {
    expect(() => normalizeColorThemePreset({ name: '缺色', mode: 'light' }, 'fallback')).toThrow()
  })

  it('rejects unsafe css values', () => {
    expect(() =>
      normalizeColorThemePreset({ name: 'x', mode: 'light', baseColors: { ...base, primary: 'url(http://evil)' } }, 'fallback'),
    ).toThrow()
  })

  it('requires every base color key', () => {
    const partial = { ...base } as Record<string, string>
    delete partial[BASE_COLOR_KEYS[0]]
    expect(() => normalizeColorThemePreset({ name: 'x', mode: 'light', baseColors: partial }, 'fallback')).toThrow()
  })
})

describe('parseColorThemePresetImport', () => {
  it('parses a preset list from json', () => {
    const json = JSON.stringify([{ id: 'a', name: 'A', mode: 'light', baseColors: base }])
    const presets = parseColorThemePresetImport(json, () => 'gen')
    expect(presets).toHaveLength(1)
    expect(presets[0].name).toBe('A')
  })

  it('throws on malformed json', () => {
    expect(() => parseColorThemePresetImport('{not json', () => 'gen')).toThrow()
  })
})
