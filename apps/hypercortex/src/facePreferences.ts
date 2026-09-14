import type { HyperCortexHtmlFaceDisplayModeV1 } from './core'
import {
  HTML_FACE_FIXED_SCALE,
  htmlFaceDisplayModeFromSettings,
  htmlFaceFixedScaleFromSettings,
  normalizeHtmlFaceDisplayMode,
  normalizeHtmlFaceFixedScale,
} from './htmlFaceDisplay'
import {
  getNoteFaceAdapter,
  listNoteFaceAdapters,
  type HyperCortexNoteFaceManifestV2,
  type HyperCortexNoteFaceSettingsV2,
} from './noteFaces'

/**
 * 笔记面设置的两层优先级统一机制：
 * 笔记级（存在笔记包内）> 全局级（存在全局设置）> 协议默认值。
 * 全局面偏好（顺序、默认创建面）的规范化与解析都收敛在本模块。
 */

// ---- 全局面偏好：规范化 ----

/** 面类型的全局顺序由面协议注册表的注册顺序给出。 */
export const DEFAULT_FACE_KIND_ORDER: readonly string[] = listNoteFaceAdapters().map(adapter => adapter.kind)

/** 全量收敛：已知类型按输入顺序排前，遗漏的类型按注册顺序补齐。 */
export function normalizeFaceKindOrder(value: unknown): string[] {
  const registered = listNoteFaceAdapters().map(adapter => adapter.kind)
  const out: string[] = []
  const push = (kind: unknown) => {
    const id = String(kind || '').trim()
    if (!id || !registered.includes(id) || out.includes(id)) return
    out.push(id)
  }
  if (Array.isArray(value)) value.forEach(push)
  registered.forEach(push)
  return out
}

/** 新笔记默认创建的面类型：保留顺序、去重，只接受协议声明可创建的类型。 */
export function normalizeDefaultFaceKinds(value: unknown): string[] {
  const out: string[] = []
  const push = (kind: unknown) => {
    const id = String(kind || '').trim()
    if (!id || out.includes(id)) return
    const adapter = getNoteFaceAdapter(id)
    if (!adapter || !adapter.capabilities.creatable) return
    out.push(id)
  }
  if (Array.isArray(value)) value.forEach(push)
  return out
}

// ---- 面顺序解析（Q28 / Q48） ----

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

// ---- HTML 面显示偏好的优先级解析（Q33 / Q34 / Q35） ----

export type FacePreferenceSource = 'note' | 'global'

export type HtmlFacePreferencesV1 = {
  /** 生效的显示方式（笔记级 > 全局级 > 协议默认）。 */
  mode: HyperCortexHtmlFaceDisplayModeV1
  modeSource: FacePreferenceSource
  /** 生效的缩放比例（笔记级 > 全局级 > 协议默认）。 */
  fixedScale: number
  fixedScaleSource: FacePreferenceSource
  /** 笔记级缩放覆盖值；null 表示未覆盖（使用全局值）。 */
  noteFixedScale: number | null
}

export function resolveHtmlFacePreferences(input: {
  faceSettings?: HyperCortexNoteFaceSettingsV2 | null
  globalMode: HyperCortexHtmlFaceDisplayModeV1
  globalFixedScale: number
}): HtmlFacePreferencesV1 {
  const noteMode = htmlFaceDisplayModeFromSettings(input.faceSettings)
  const noteFixedScale = htmlFaceFixedScaleFromSettings(input.faceSettings)
  return {
    mode: noteMode ?? normalizeHtmlFaceDisplayMode(input.globalMode),
    modeSource: noteMode ? 'note' : 'global',
    fixedScale: noteFixedScale ?? normalizeHtmlFaceFixedScale(input.globalFixedScale, HTML_FACE_FIXED_SCALE.default),
    fixedScaleSource: noteFixedScale !== undefined ? 'note' : 'global',
    noteFixedScale: noteFixedScale ?? null,
  }
}
