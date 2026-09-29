// 工具配置草稿的点路径读写：对象键与列表下标统一寻址。
// 表单渲染层与控制器草稿层共用这一份实现（单一事实源）。

export function normalizeConfigPath(path: any): string[] {
  const parts = Array.isArray(path) ? path : String(path ?? '').split('.')
  return parts.map((part: any) => String(part ?? '').trim()).filter((part: string) => !!part)
}

export function isIndexSegment(segment: string): boolean {
  return /^\d+$/.test(segment)
}

// setConfigValueAtPath 以点路径写值：路径段为对象键或列表下标；
// 逐级自动补齐容器（下标段配列表，其余配对象）。返回新草稿，不改动入参。
export function setConfigValueAtPath(source: Record<string, any>, path: any, value: any): Record<string, any> {
  const draft = cloneConfigObject(source)
  const segments = normalizeConfigPath(path)
  if (!segments.length) return draft
  let cursor: any = draft
  for (let index = 0; index < segments.length - 1; index++) {
    const segment = segments[index]
    const next = cursor[segment]
    if (!next || typeof next !== 'object') {
      cursor[segment] = isIndexSegment(segments[index + 1]) ? [] : {}
    }
    cursor = cursor[segment]
  }
  cursor[segments[segments.length - 1]] = value
  return draft
}

// removeConfigValueAtPath 以点路径删值：对象键删除，列表下标按行移除（后续行前移）。
export function removeConfigValueAtPath(source: Record<string, any>, path: any): Record<string, any> {
  const draft = cloneConfigObject(source)
  const segments = normalizeConfigPath(path)
  if (!segments.length) return draft
  let cursor: any = draft
  for (let index = 0; index < segments.length - 1; index++) {
    const next = cursor[segments[index]]
    if (!next || typeof next !== 'object') return draft
    cursor = next
  }
  const last = segments[segments.length - 1]
  if (Array.isArray(cursor) && isIndexSegment(last)) {
    const position = Number(last)
    if (position >= 0 && position < cursor.length) cursor.splice(position, 1)
    return draft
  }
  delete cursor[last]
  return draft
}

export function cloneConfigObject(value: any): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? cloneConfigValue(value) : {}
}

export function cloneConfigValue(value: any): any {
  if (value === undefined) return undefined
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return value
  }
}
