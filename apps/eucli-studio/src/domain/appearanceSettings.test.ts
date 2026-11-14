import { describe, expect, it } from 'vitest'
import {
  CHAT_BG_BLUR_DEFAULT,
  CHAT_BG_BLUR_MAX,
  CHAT_BG_BLUR_MIN,
  CHAT_BG_OPACITY_DEFAULT,
  CHAT_BG_OPACITY_MAX,
  CHAT_BG_OPACITY_MIN,
  COMPOSER_BLUR_DEFAULT,
  COMPOSER_BLUR_MAX,
  COMPOSER_BLUR_MIN,
  COMPOSER_OPACITY_DEFAULT,
  COMPOSER_OPACITY_MAX,
  COMPOSER_OPACITY_MIN,
  TOPBAR_BLUR_DEFAULT,
  TOPBAR_BLUR_MAX,
  TOPBAR_BLUR_MIN,
  TOPBAR_OPACITY_DEFAULT,
  TOPBAR_OPACITY_MAX,
  TOPBAR_OPACITY_MIN,
  normalizeChatBgBlur,
  normalizeChatBgOpacity,
  normalizeComposerBlur,
  normalizeComposerOpacity,
  normalizeTopbarBlur,
  normalizeTopbarOpacity,
} from './appearanceSettings'

describe('外观表面默认值与范围', () => {
  it('默认值取设计稿：聊天 59%/3px、顶栏 0%/3px、输入栏 86%/10px', () => {
    expect([CHAT_BG_OPACITY_DEFAULT, CHAT_BG_BLUR_DEFAULT]).toEqual([59, 3])
    expect([TOPBAR_OPACITY_DEFAULT, TOPBAR_BLUR_DEFAULT]).toEqual([0, 3])
    expect([COMPOSER_OPACITY_DEFAULT, COMPOSER_BLUR_DEFAULT]).toEqual([86, 10])
  })

  it('缺失值回落到既有默认值', () => {
    expect(normalizeChatBgOpacity(undefined)).toBe(CHAT_BG_OPACITY_DEFAULT)
    expect(normalizeChatBgBlur(undefined)).toBe(CHAT_BG_BLUR_DEFAULT)
    expect(normalizeTopbarOpacity(undefined)).toBe(TOPBAR_OPACITY_DEFAULT)
    expect(normalizeTopbarBlur(undefined)).toBe(TOPBAR_BLUR_DEFAULT)
    expect(normalizeComposerOpacity(undefined)).toBe(COMPOSER_OPACITY_DEFAULT)
    expect(normalizeComposerBlur(undefined)).toBe(COMPOSER_BLUR_DEFAULT)
  })

  it('越界值收敛到统一范围', () => {
    expect(normalizeChatBgOpacity(-10)).toBe(CHAT_BG_OPACITY_MIN)
    expect(normalizeChatBgOpacity(999)).toBe(CHAT_BG_OPACITY_MAX)
    expect(normalizeChatBgBlur(999)).toBe(CHAT_BG_BLUR_MAX)
    expect(normalizeTopbarOpacity(999)).toBe(TOPBAR_OPACITY_MAX)
    expect(normalizeTopbarBlur(999)).toBe(TOPBAR_BLUR_MAX)
    expect(normalizeComposerOpacity(0)).toBe(COMPOSER_OPACITY_MIN)
    expect(normalizeComposerOpacity(999)).toBe(COMPOSER_OPACITY_MAX)
    expect(normalizeComposerBlur(999)).toBe(COMPOSER_BLUR_MAX)
    expect(normalizeChatBgBlur(-1)).toBe(CHAT_BG_BLUR_MIN)
    expect(normalizeTopbarBlur(-1)).toBe(TOPBAR_BLUR_MIN)
    expect(normalizeComposerBlur(-1)).toBe(COMPOSER_BLUR_MIN)
    expect(normalizeTopbarOpacity(-1)).toBe(TOPBAR_OPACITY_MIN)
  })

  it('取整并保留范围内的数值', () => {
    expect(normalizeChatBgOpacity(41.6)).toBe(42)
    expect(normalizeChatBgBlur('12')).toBe(12)
    expect(normalizeTopbarOpacity(59.4)).toBe(59)
    expect(normalizeComposerOpacity(85.5)).toBe(86)
    expect(normalizeComposerBlur(9.2)).toBe(9)
  })
})
