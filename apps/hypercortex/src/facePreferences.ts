import type { HyperCortexNoteFaceManifestV2 } from './noteFaces'

/**
 * 笔记面设置的两层优先级统一机制：
 * 笔记级（存在笔记包内）> 全局级（存在全局设置）> 声明默认值。
 * 全局面偏好（顺序、默认创建面）的规范化与解析都收敛在本模块。
 *
 * 已知类型清单来自运行时声明仓库（后端声明单源），由调用方传入。
 */

// ---- 全局面偏好：规范化 ----

/** 全量收敛：已知类型按输入顺序排前，遗漏的类型按已知类型顺序补齐。 */
export function normalizeFaceKindOrder(value: unknown, knownKinds: readonly string[]): string[] {
  const out: string[] = []
  const push = (kind: unknown) => {
    const id = String(kind || '').trim()
    if (!id || !knownKinds.includes(id) || out.includes(id)) return
    out.push(id)
  }
  if (Array.isArray(value)) value.forEach(push)
  knownKinds.forEach(push)
  return out
}

/** 新笔记默认创建的面类型：保留顺序、去重，只接受可创建的类型。 */
export function normalizeDefaultFaceKinds(value: unknown, creatableKinds: readonly string[]): string[] {
  const out: string[] = []
  const push = (kind: unknown) => {
    const id = String(kind || '').trim()
    if (!id || out.includes(id) || !creatableKinds.includes(id)) return
    out.push(id)
  }
  if (Array.isArray(value)) value.forEach(push)
  return out
}

// ---- 面顺序解析（Q28 / Q48） ----

/** 将列表中的元素移动 delta 位；越界或位置非法时原样返回（浅拷贝）。 */
export function moveListItem<T>(list: readonly T[], index: number, delta: number): T[] {
  const next = index + delta
  if (index < 0 || next < 0 || next >= list.length) return list.slice()
  const out = list.slice()
  const [item] = out.splice(index, 1)
  out.splice(next, 0, item)
  return out
}

/** 将面类型列表按全局顺序重排；全局顺序未覆盖的类型保持原有相对顺序追加在后。 */
export function orderKindsByGlobalOrder(kinds: readonly string[], globalKindOrder: readonly string[]): string[] {
  const out: string[] = []
  const push = (kind: unknown) => {
    const id = String(kind || '').trim()
    if (!id || out.includes(id)) return
    out.push(id)
  }
  for (const kind of globalKindOrder) {
    if (kinds.includes(kind)) push(kind)
  }
  kinds.forEach(push)
  return out
}

/**
 * 解析笔记的面顺序：笔记级 faceOrder 优先，未列出的面按全局类型顺序补全，
 * 仍未被全局顺序覆盖的类型（未知面）最后追加，保证任何面都不丢失。
 */
export function resolveNoteFaceOrder(input: {
  faceOrder?: unknown
  faces?: Record<string, HyperCortexNoteFaceManifestV2> | null
  globalKindOrder?: readonly string[]
}): string[] {
  const faces = input.faces || {}
  const out: string[] = []
  const push = (faceId: unknown) => {
    const id = String(faceId || '').trim()
    if (!id || !faces[id] || out.includes(id)) return
    out.push(id)
  }
  if (Array.isArray(input.faceOrder)) input.faceOrder.forEach(push)
  for (const kind of input.globalKindOrder || []) {
    for (const [faceId, face] of Object.entries(faces)) {
      if (face?.kind === kind) push(faceId)
    }
  }
  Object.keys(faces).forEach(push)
  return out
}
