import type { FaceSettingField } from './protocol'

/**
 * 面设置的通用解析与展示：笔记级覆盖 > 全局值 > 声明默认。
 * 宿主只按插件声明的字段做解析，不识别任何具体面类型。
 */

/** 面插件全局设置容器（类型标识 → 字段键 → 值）的通用规范化：只保留对象值并浅拷贝。 */
export function normalizeFacePluginSettingsContainer(raw: unknown): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [kind, value] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(kind || '').trim()
    if (!key || !value || typeof value !== 'object' || Array.isArray(value)) continue
    out[key] = { ...(value as Record<string, unknown>) }
  }
  return out
}

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

/** 替换说明模板中的值占位：{value} 用给定值、{global} 用全局值。 */
export function renderFaceSettingTemplate(
  template: string | undefined,
  field: FaceSettingField,
  values: { value: unknown; global: unknown },
): string {
  if (!template) return ''
  return template
    .replaceAll('{value}', formatFaceSettingValue(field, values.value))
    .replaceAll('{global}', formatFaceSettingValue(field, values.global))
}
