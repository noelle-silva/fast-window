export type ReasoningDisplayMode = 'never-expand' | 'collapse-when-done' | 'stay-expanded'

export const REASONING_DISPLAY_MODE_OPTIONS: Array<{ value: ReasoningDisplayMode; label: string }> = [
  { value: 'never-expand', label: '不展开（保持收起）' },
  { value: 'collapse-when-done', label: '展开，思考结束后收起' },
  { value: 'stay-expanded', label: '展开，思考结束后保持展开' },
]

export const DEFAULT_REASONING_DISPLAY_MODE: ReasoningDisplayMode = 'collapse-when-done'

export function normalizeReasoningDisplayMode(raw: unknown): ReasoningDisplayMode {
  const value = String(raw || '').trim()
  return value === 'never-expand' || value === 'collapse-when-done' || value === 'stay-expanded' ? value : DEFAULT_REASONING_DISPLAY_MODE
}
