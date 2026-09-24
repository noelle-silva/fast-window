import type { FaceSettingField } from './protocol'

/**
 * 面设置的通用解析与展示：笔记级覆盖 > 全局值 > 声明默认。
 * 宿主只按插件声明的字段做解析，不识别任何具体面类型。
 */

/** 校验并收敛单个设置值；非法值返回 undefined（视为未设置）。 */
export function normalizeFaceSettingValue(field: FaceSettingField, value: unknown): unknown | undefined {
  if (value == null) return undefined
  if (field.kind === 'enum') {
    return field.options.some(option => option.value === value) ? value : undefined
  }
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return undefined
  return Math.min(field.max, Math.max(field.min, n))
}

/** 解析一组声明字段的全部生效设置（笔记级覆盖 > 全局值 > 声明默认）。 */
export function resolveFaceSettingValues(
  fields: readonly FaceSettingField[] | null | undefined,
  input: { noteSettings?: Record<string, unknown> | null; globalSettings?: Record<string, unknown> | null },
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of fields || []) {
    const noteValue = normalizeFaceSettingValue(field, input.noteSettings?.[field.key])
    const globalValue = normalizeFaceSettingValue(field, input.globalSettings?.[field.key])
    out[field.key] = noteValue ?? globalValue ?? field.default
  }
  return out
}

/** 某个字段是否存在笔记级覆盖。 */
export function hasFaceSettingOverride(field: FaceSettingField, noteSettings: Record<string, unknown> | null | undefined): boolean {
  return normalizeFaceSettingValue(field, noteSettings?.[field.key]) !== undefined
}

/** 设置值的界面展示文本（percent 数值按百分比展示）。 */
export function formatFaceSettingValue(field: FaceSettingField, value: unknown): string {
  if (field.kind === 'number') {
    const n = Number(value)
    if (!Number.isFinite(n)) return ''
    return field.format === 'percent' ? `${Math.round(n * 100)}%` : String(n)
  }
  return field.options.find(option => option.value === value)?.label || String(value ?? '')
}

/** 替换说明模板中的值占位（{value} / {global}）。 */
export function renderFaceSettingTemplate(template: string | undefined, field: FaceSettingField, value: unknown): string {
  if (!template) return ''
  const text = formatFaceSettingValue(field, value)
  return template.replaceAll('{value}', text).replaceAll('{global}', text)
}
