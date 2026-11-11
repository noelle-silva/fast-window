// 工作过程显示设置：总开关 + 三档展开方式。
//
// 三档只描述「默认展开状态」，用户点击过的那一段始终以手动选择为准。

export type WorkProcessDisplayMode = 'never-expand' | 'collapse-when-done' | 'stay-expanded'

export const WORK_PROCESS_DISPLAY_MODE_OPTIONS: Array<{ value: WorkProcessDisplayMode; label: string }> = [
  { value: 'never-expand', label: '全程收起' },
  { value: 'collapse-when-done', label: '输出中展开，完成后收起' },
  { value: 'stay-expanded', label: '始终展开' },
]

export const DEFAULT_WORK_PROCESS_DISPLAY_MODE: WorkProcessDisplayMode = 'collapse-when-done'
export const DEFAULT_WORK_PROCESS_DISPLAY_ENABLED = true

export function normalizeWorkProcessDisplayMode(raw: unknown): WorkProcessDisplayMode {
  const value = String(raw ?? '').trim()
  return value === 'never-expand' || value === 'collapse-when-done' || value === 'stay-expanded'
    ? value
    : DEFAULT_WORK_PROCESS_DISPLAY_MODE
}

// 只有显式 false 才算关闭；字段缺失按默认开启处理。
export function normalizeWorkProcessDisplayEnabled(raw: unknown): boolean {
  if (raw === false) return false
  return String(raw ?? '').trim() !== 'false'
}

// 非手动状态下，一段工作过程应有的展开状态。
export function workProcessExpandedByMode(mode: WorkProcessDisplayMode, active: boolean): boolean {
  if (mode === 'never-expand') return false
  if (mode === 'stay-expanded') return true
  return active
}
