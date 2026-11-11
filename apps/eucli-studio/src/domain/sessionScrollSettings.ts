import { clampWithPrecision, toFiniteNumber } from './numberNormalize'

// 会话消息区键盘翻页的步长：一次翻过可视高度的百分之多少。
// 原生 PageUp / PageDown 是 87.5%，这里默认取 80%（翻得略少一点，上下文接得住），
// 想更接近原生可以自己往上调。默认值与取值范围的唯一事实源就在这个文件。

export const SESSION_SCROLL_STEP_PERCENT_MIN = 40
export const SESSION_SCROLL_STEP_PERCENT_MAX = 100
export const SESSION_SCROLL_STEP_PERCENT_DEFAULT = 80

// 滑块步进：5% 一档，够细也不至于手抖。
export const SESSION_SCROLL_STEP_PERCENT_STEP = 5

export function normalizeSessionScrollStepPercent(value: unknown): number {
  const raw = toFiniteNumber(value)
  if (raw === null) return SESSION_SCROLL_STEP_PERCENT_DEFAULT
  return clampWithPrecision(raw, SESSION_SCROLL_STEP_PERCENT_MIN, SESSION_SCROLL_STEP_PERCENT_MAX, 0)
}
