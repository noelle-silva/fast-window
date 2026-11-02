import { clampWithPrecision, toFiniteNumber } from './numberNormalize'

// 外观表面（聊天背景 / 顶栏 / 输入区）的默认值与取值范围的单一事实源。
// normalizer、动作层与设置面板统一从这里取值，禁止再写一份 0/24/40/100/86/10。

export const CHAT_BG_OPACITY_MIN = 0
export const CHAT_BG_OPACITY_MAX = 100
export const CHAT_BG_OPACITY_DEFAULT = 0

export const CHAT_BG_BLUR_MIN = 0
export const CHAT_BG_BLUR_MAX = 24
export const CHAT_BG_BLUR_DEFAULT = 0

export const TOPBAR_OPACITY_MIN = 0
export const TOPBAR_OPACITY_MAX = 100
export const TOPBAR_OPACITY_DEFAULT = 100

export const TOPBAR_BLUR_MIN = 0
export const TOPBAR_BLUR_MAX = 24
export const TOPBAR_BLUR_DEFAULT = 0

export const COMPOSER_OPACITY_MIN = 40
export const COMPOSER_OPACITY_MAX = 100
export const COMPOSER_OPACITY_DEFAULT = 86

export const COMPOSER_BLUR_MIN = 0
export const COMPOSER_BLUR_MAX = 24
export const COMPOSER_BLUR_DEFAULT = 10

function normalizeInteger(value: unknown, min: number, max: number, fallback: number): number {
  const raw = toFiniteNumber(value)
  if (raw === null) return fallback
  return clampWithPrecision(raw, min, max, 0)
}

export function normalizeChatBgOpacity(value: unknown): number {
  return normalizeInteger(value, CHAT_BG_OPACITY_MIN, CHAT_BG_OPACITY_MAX, CHAT_BG_OPACITY_DEFAULT)
}

export function normalizeChatBgBlur(value: unknown): number {
  return normalizeInteger(value, CHAT_BG_BLUR_MIN, CHAT_BG_BLUR_MAX, CHAT_BG_BLUR_DEFAULT)
}

export function normalizeTopbarOpacity(value: unknown): number {
  return normalizeInteger(value, TOPBAR_OPACITY_MIN, TOPBAR_OPACITY_MAX, TOPBAR_OPACITY_DEFAULT)
}

export function normalizeTopbarBlur(value: unknown): number {
  return normalizeInteger(value, TOPBAR_BLUR_MIN, TOPBAR_BLUR_MAX, TOPBAR_BLUR_DEFAULT)
}

export function normalizeComposerOpacity(value: unknown): number {
  return normalizeInteger(value, COMPOSER_OPACITY_MIN, COMPOSER_OPACITY_MAX, COMPOSER_OPACITY_DEFAULT)
}

export function normalizeComposerBlur(value: unknown): number {
  return normalizeInteger(value, COMPOSER_BLUR_MIN, COMPOSER_BLUR_MAX, COMPOSER_BLUR_DEFAULT)
}
