// 渲染探针：默认关闭，只在显式开启后累计指定表面的 render 次数。
//
// 设计约束：
// - 关闭时唯一成本是一次布尔判断，不分配、不遍历、不触碰 Map；
// - 探针不参与任何行为分支，组件是否渲染只由自身 props / state 决定；
// - 计数按固定 ID 归集，避免调用方手拼字符串。

export const RENDER_PROBE_IDS = [
  'shell',
  'topbar',
  'sidebar',
  'composer',
  'sessionViewport',
  'settings',
  'overlay',
  'messageList',
  'messageRow',
] as const

export type RenderProbeId = (typeof RENDER_PROBE_IDS)[number]

export type RenderProbeSnapshot = {
  enabled: boolean
  counts: Record<RenderProbeId, number>
}

let enabled = false
const counts = new Map<RenderProbeId, number>()

export function enableRenderProbe() {
  enabled = true
}

export function disableRenderProbe() {
  enabled = false
}

export function resetRenderProbe() {
  counts.clear()
}

export function isRenderProbeEnabled() {
  return enabled
}

export function recordRender(id: RenderProbeId) {
  if (!enabled) return
  counts.set(id, (counts.get(id) || 0) + 1)
}

export function snapshotRenderProbe(): RenderProbeSnapshot {
  const next = {} as Record<RenderProbeId, number>
  for (const id of RENDER_PROBE_IDS) next[id] = counts.get(id) || 0
  return { enabled, counts: next }
}

// 在组件 render 体内调用。关闭时不进入任何分支逻辑。
export function useRenderProbe(id: RenderProbeId) {
  recordRender(id)
}
