import { clampWithPrecision, toFiniteNumber } from './numberNormalize'

export const CHAT_FONT_SIZE_MIN = 12
export const CHAT_FONT_SIZE_MAX = 22
export const CHAT_FONT_SIZE_DEFAULT = 14

export const CHAT_LETTER_SPACING_MIN = 0
export const CHAT_LETTER_SPACING_MAX = 4
export const CHAT_LETTER_SPACING_DEFAULT = 0

export const CHAT_LINE_HEIGHT_MIN = 1.2
export const CHAT_LINE_HEIGHT_MAX = 2.6
export const CHAT_LINE_HEIGHT_DEFAULT = 1.75

// 默认会话字体栈参考 cherry-studio 的 Windows 默认：微软雅黑 UI 优先，其余平台逐级回落。
export const DEFAULT_CHAT_FONT_STACK =
  '"Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", system-ui, -apple-system, "PingFang SC", "Noto Sans CJK SC", sans-serif'

export type ChatFontOption = {
  value: string
  label: string
}

// 内置精选字体清单：Tauri 无法枚举系统字体，这里只列常见且值得一试的字体；
// 未安装的字体由 CSS 字体栈自动回落，不做探测。
export const CHAT_FONT_OPTIONS: ChatFontOption[] = [
  { value: '', label: '默认（微软雅黑 UI）' },
  { value: 'Microsoft YaHei UI', label: '微软雅黑 UI' },
  { value: 'Microsoft YaHei', label: '微软雅黑' },
  { value: 'DengXian', label: '等线' },
  { value: 'KaiTi', label: '楷体' },
  { value: 'SimSun', label: '宋体' },
  { value: 'SimHei', label: '黑体' },
  { value: 'Source Han Sans SC', label: '思源黑体' },
  { value: 'LXGW WenKai', label: '霞鹜文楷' },
  { value: 'Segoe UI', label: 'Segoe UI' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Consolas', label: 'Consolas' },
]

export function normalizeChatFontSize(value: unknown): number {
  const raw = toFiniteNumber(value)
  if (raw === null) return CHAT_FONT_SIZE_DEFAULT
  return clampWithPrecision(raw, CHAT_FONT_SIZE_MIN, CHAT_FONT_SIZE_MAX, 0)
}

export function normalizeChatLetterSpacing(value: unknown): number {
  const raw = toFiniteNumber(value)
  if (raw === null) return CHAT_LETTER_SPACING_DEFAULT
  return clampWithPrecision(raw, CHAT_LETTER_SPACING_MIN, CHAT_LETTER_SPACING_MAX, 1)
}

export function normalizeChatLineHeight(value: unknown): number {
  const raw = toFiniteNumber(value)
  if (raw === null) return CHAT_LINE_HEIGHT_DEFAULT
  return clampWithPrecision(raw, CHAT_LINE_HEIGHT_MIN, CHAT_LINE_HEIGHT_MAX, 2)
}

export function normalizeChatFontFamily(value: unknown): string {
  const family = String(value ?? '').trim()
  return CHAT_FONT_OPTIONS.some((option) => option.value === family) ? family : ''
}

// chatFontFamilyStack 把设置取值解析为可用的 CSS 字体栈：选项字体在前，默认栈兜底。
export function chatFontFamilyStack(value: unknown): string {
  const family = normalizeChatFontFamily(value)
  return family ? `"${family}", ${DEFAULT_CHAT_FONT_STACK}` : DEFAULT_CHAT_FONT_STACK
}

export function chatFontFamilyLabel(value: unknown): string {
  const family = normalizeChatFontFamily(value)
  return CHAT_FONT_OPTIONS.find((option) => option.value === family)?.label || CHAT_FONT_OPTIONS[0].label
}
