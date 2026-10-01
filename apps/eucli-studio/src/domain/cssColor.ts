// CSS 颜色解析与格式化：把设置里的颜色字符串与取色器需要的 RGBA 数值互转。
// 只支持设置体系实际出现的写法（#rgb / #rrggbb / #rrggbbaa / rgb() / rgba()）；
// 阴影类完整 CSS 片段解析为 null，由调用方决定只读展示。

import { parse, formatHex, formatRgb, converter, type Color } from 'culori'

export type CssRgba = { r: number; g: number; b: number; a: number }
export type CssHsla = { h: number; s: number; l: number; a: number }

const HEX_SHORT = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i
const HEX_LONG = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i
const HEX_ALPHA = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i
const RGB_FUNCTION = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/i

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function channel(value: string, hexLength: number) {
  const parsed = parseInt(value, 16)
  return hexLength === 1 ? parsed * 17 : parsed
}

export function parseCssColor(value: unknown): CssRgba | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  const short = HEX_SHORT.exec(raw)
  if (short) {
    return { r: channel(short[1], 1), g: channel(short[2], 1), b: channel(short[3], 1), a: 1 }
  }

  const long = HEX_LONG.exec(raw)
  if (long) {
    return { r: channel(long[1], 2), g: channel(long[2], 2), b: channel(long[3], 2), a: 1 }
  }

  const alpha = HEX_ALPHA.exec(raw)
  if (alpha) {
    return {
      r: channel(alpha[1], 2),
      g: channel(alpha[2], 2),
      b: channel(alpha[3], 2),
      a: clamp(parseInt(alpha[4], 16) / 255, 0, 1),
    }
  }

  const fn = RGB_FUNCTION.exec(raw)
  if (fn) {
    const r = Number(fn[1])
    const g = Number(fn[2])
    const b = Number(fn[3])
    if (r > 255 || g > 255 || b > 255) return null
    const a = fn[4] === undefined ? 1 : clamp(Number(fn[4]), 0, 1)
    return { r, g, b, a }
  }

  return null
}

function toHexPair(value: number) {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')
}

function formatAlpha(value: number) {
  const alpha = clamp(value, 0, 1)
  return String(Math.round(alpha * 1000) / 1000)
}

export function formatCssColor(color: CssRgba): string {
  const r = clamp(Math.round(color.r), 0, 255)
  const g = clamp(Math.round(color.g), 0, 255)
  const b = clamp(Math.round(color.b), 0, 255)
  const a = clamp(color.a, 0, 1)
  if (a >= 1) return `#${toHexPair(r)}${toHexPair(g)}${toHexPair(b)}`
  return `rgba(${r},${g},${b},${formatAlpha(a)})`
}

// ============================================================
// culori 兼容层：供 colorDerivation.ts 使用
// ============================================================

const toRgb = converter('rgb')
const toHsl = converter('hsl')

/** 解析任意 CSS 颜色为 culori Color 对象 */
export function parseColor(cssValue: string): Color | undefined {
  return parse(cssValue)
}

/** 格式化 culori Color 为 CSS 字符串（hex 或 rgba） */
export function formatCss(color: Color): string {
  if (color.alpha !== undefined && color.alpha < 1) {
    return formatRgb(color) || formatHex(color) || '#000000'
  }
  return formatHex(color) || '#000000'
}

/** 转换 culori Color 为 RGBA 对象（用于取色器） */
export function formatRgba(color: Color): CssRgba | null {
  if (color.mode === 'rgb') {
    return {
      r: Math.round((color.r ?? 0) * 255),
      g: Math.round((color.g ?? 0) * 255),
      b: Math.round((color.b ?? 0) * 255),
      a: color.alpha ?? 1,
    }
  }
  // 转换到 rgb 模式
  const rgb = toRgb(color)
  if (!rgb) return null
  return {
    r: Math.round((rgb.r ?? 0) * 255),
    g: Math.round((rgb.g ?? 0) * 255),
    b: Math.round((rgb.b ?? 0) * 255),
    a: rgb.alpha ?? 1,
  }
}

/** 转换 culori Color 为 HSLA 对象（用于明度调整） */
export function formatHsla(color: Color): CssHsla | null {
  if (color.mode === 'hsl') {
    return {
      h: color.h ?? 0,
      s: color.s ?? 0,
      l: color.l ?? 0,
      a: color.alpha ?? 1,
    }
  }
  // 转换到 hsl 模式
  const hsl = toHsl(color)
  if (!hsl) return null
  return {
    h: hsl.h ?? 0,
    s: hsl.s ?? 0,
    l: hsl.l ?? 0,
    a: hsl.alpha ?? 1,
  }
}
