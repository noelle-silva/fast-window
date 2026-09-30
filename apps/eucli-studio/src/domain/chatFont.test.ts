import { describe, expect, it } from 'vitest'
import {
  CHAT_FONT_SIZE_DEFAULT,
  CHAT_FONT_SIZE_MAX,
  CHAT_FONT_SIZE_MIN,
  DEFAULT_CHAT_FONT_STACK,
  chatFontFamilyLabel,
  chatFontFamilyStack,
  normalizeChatFontFamily,
  normalizeChatFontSize,
} from './chatFont'

describe('normalizeChatFontSize', () => {
  it('keeps in-range integer sizes', () => {
    expect(normalizeChatFontSize(16)).toBe(16)
    expect(normalizeChatFontSize('18')).toBe(18)
    expect(normalizeChatFontSize(15.4)).toBe(15)
  })

  it('clamps out-of-range sizes', () => {
    expect(normalizeChatFontSize(1)).toBe(CHAT_FONT_SIZE_MIN)
    expect(normalizeChatFontSize(999)).toBe(CHAT_FONT_SIZE_MAX)
  })

  it('falls back to default for invalid values', () => {
    expect(normalizeChatFontSize(undefined)).toBe(CHAT_FONT_SIZE_DEFAULT)
    expect(normalizeChatFontSize(null)).toBe(CHAT_FONT_SIZE_DEFAULT)
    expect(normalizeChatFontSize('')).toBe(CHAT_FONT_SIZE_DEFAULT)
    expect(normalizeChatFontSize('  ')).toBe(CHAT_FONT_SIZE_DEFAULT)
    expect(normalizeChatFontSize('abc')).toBe(CHAT_FONT_SIZE_DEFAULT)
    expect(normalizeChatFontSize(Infinity)).toBe(CHAT_FONT_SIZE_DEFAULT)
    expect(normalizeChatFontSize(true)).toBe(CHAT_FONT_SIZE_DEFAULT)
  })
})

describe('normalizeChatFontFamily', () => {
  it('keeps known fonts from the built-in list', () => {
    expect(normalizeChatFontFamily('KaiTi')).toBe('KaiTi')
    expect(normalizeChatFontFamily(' Microsoft YaHei ')).toBe('Microsoft YaHei')
  })

  it('falls back to the default stack for empty or unknown fonts', () => {
    expect(normalizeChatFontFamily('')).toBe('')
    expect(normalizeChatFontFamily('Comic Sans MS')).toBe('')
    expect(normalizeChatFontFamily(undefined)).toBe('')
  })
})

describe('chatFontFamilyStack', () => {
  it('returns the default stack for the default option', () => {
    expect(chatFontFamilyStack('')).toBe(DEFAULT_CHAT_FONT_STACK)
  })

  it('prepends the chosen font before the default stack', () => {
    expect(chatFontFamilyStack('KaiTi')).toBe(`"KaiTi", ${DEFAULT_CHAT_FONT_STACK}`)
  })
})

describe('chatFontFamilyLabel', () => {
  it('resolves labels for known fonts and the default option', () => {
    expect(chatFontFamilyLabel('')).toBe('默认（微软雅黑 UI）')
    expect(chatFontFamilyLabel('LXGW WenKai')).toBe('霞鹜文楷')
  })
})
