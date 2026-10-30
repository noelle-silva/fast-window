import { clampWithPrecision, toFiniteNumber } from './numberNormalize'

// 输入区（composer）外观几何量的单一事实源：宽度、输入框行数、专属圆角。
// 外框与内部输入框共同消费同一组取值，保证两者形状永远对齐。

export const COMPOSER_WIDTH_PERCENT_MIN = 40
export const COMPOSER_WIDTH_PERCENT_MAX = 100
export const COMPOSER_WIDTH_PERCENT_DEFAULT = 80

export const COMPOSER_MIN_ROWS_MIN = 1
export const COMPOSER_MIN_ROWS_MAX = 12
export const COMPOSER_MIN_ROWS_DEFAULT = 2

export const COMPOSER_RADIUS_MIN = 0
export const COMPOSER_RADIUS_MAX = 32
export const COMPOSER_RADIUS_DEFAULT = 32

export function normalizeComposerWidthPercent(value: unknown): number {
  const raw = toFiniteNumber(value)
  if (raw === null) return COMPOSER_WIDTH_PERCENT_DEFAULT
  return clampWithPrecision(raw, COMPOSER_WIDTH_PERCENT_MIN, COMPOSER_WIDTH_PERCENT_MAX, 0)
}

export function normalizeComposerMinRows(value: unknown): number {
  const raw = toFiniteNumber(value)
  if (raw === null) return COMPOSER_MIN_ROWS_DEFAULT
  return clampWithPrecision(raw, COMPOSER_MIN_ROWS_MIN, COMPOSER_MIN_ROWS_MAX, 0)
}

export function normalizeComposerRadius(value: unknown): number {
  const raw = toFiniteNumber(value)
  if (raw === null) return COMPOSER_RADIUS_DEFAULT
  return clampWithPrecision(raw, COMPOSER_RADIUS_MIN, COMPOSER_RADIUS_MAX, 0)
}

// 宽度以「两侧留白占比」表达：左右各留白 (100 - widthPercent) / 2，外框与输入框同源消费。
export function composerSideInsetPercent(widthPercent: unknown): number {
  return (100 - normalizeComposerWidthPercent(widthPercent)) / 2
}

// 模型按钮是否带供应商前缀：默认只显示模型标识，开启后显示「供应商 / 模型标识」。
export const COMPOSER_MODEL_SHOW_PROVIDER_DEFAULT = false

export function normalizeComposerModelShowProvider(raw: unknown): boolean {
  return typeof raw === 'boolean' ? raw : COMPOSER_MODEL_SHOW_PROVIDER_DEFAULT
}
