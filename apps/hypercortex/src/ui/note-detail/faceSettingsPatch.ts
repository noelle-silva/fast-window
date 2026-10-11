/**
 * 面设置补丁的会话侧纯函数：补丁合并语义（null 删除）与逐项相等判断。
 * 宿主把面设置编辑视作会话草稿的一部分（与面内容同一模型），落盘由保存管线统一负责。
 */

/** 把设置补丁合并进现有设置：值为 null 表示删除该键，空键忽略。 */
export function applyFaceSettingsPatch(
  settings: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown | null>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(settings || {}) }
  for (const [key, value] of Object.entries(patch)) {
    const trimmed = String(key || '').trim()
    if (!trimmed) continue
    if (value == null) delete next[trimmed]
    else next[trimmed] = value
  }
  return next
}

/** 两份面设置是否逐项相等（键排序后比较；值以 JSON 序列化兜底）。 */
export function areFaceSettingsEqual(
  left: Record<string, unknown> | null | undefined,
  right: Record<string, unknown> | null | undefined,
): boolean {
  const a = left || {}
  const b = right || {}
  const keys = Object.keys(a).sort()
  const otherKeys = Object.keys(b).sort()
  if (keys.length !== otherKeys.length) return false
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] !== otherKeys[i]) return false
  }
  for (const key of keys) {
    if (a[key] === b[key]) continue
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false
  }
  return true
}
