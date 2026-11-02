// cloneJsonData 只处理 JSON 兼容数据：对象、数组、字符串、数字、布尔、null。
//
// 偏好（ui / settings）会被持久化成 JSON，所以读边界必须先把它们从存储快照里
// 深拷贝出来。否则内存里的修改会直接改到存储快照 / 上次落盘基线，
// 让「无变化不写盘」永远判等。
export function cloneJsonData<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => cloneJsonData(item)) as T
  const source = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(source)) out[key] = cloneJsonData(source[key])
  return out as T
}
