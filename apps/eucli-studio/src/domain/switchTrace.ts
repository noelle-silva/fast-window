// 会话切换观测：switchId 贯穿一次切换的全部边界，用于量化「卡在哪一段」。
//
// 七个边界（与 design-2 的 P0 一致）：
//   frontend.select       前端入口（用户选中）
//   frontend.bodyReady    会话数据就绪（纯咨询，不门控渲染）
//   frontend.pageMounted  新页首次提交完成
//   frontend.painted      新页真正画出（双 rAF 之后）
//   frontend.enhanceStart 首屏同步解析/装饰开始
//   frontend.enhanceEnd   首屏同步解析/装饰结束
//   frontend.settled      可见页追平选中页，切换结束
//
// 三条铁律：
//   1. 一次切换只发一个 switchId；
//   2. 观测是纯旁路，不改变任何行为分支（禁止观测开关改变行为）；
//   3. 没有挂 sink 时所有 mark 都是空操作，零成本。

export type SwitchBoundary =
  | 'frontend.select'
  | 'frontend.bodyReady'
  | 'frontend.pageMounted'
  | 'frontend.painted'
  | 'frontend.enhanceStart'
  | 'frontend.enhanceEnd'
  | 'frontend.settled'

export type SwitchMark = {
  switchId: string
  boundary: SwitchBoundary
  key: string
  sinceStartMs: number
}

export type SwitchTraceSink = (mark: SwitchMark) => void

type Trace = {
  switchId: string
  key: string
  startedAt: number
  marked: Set<SwitchBoundary>
  mark: (boundary: SwitchBoundary) => void
}

let switchSeq = 0
let sink: SwitchTraceSink | null = null
let active: Trace | null = null

function now() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
}

export function nextSwitchId() {
  switchSeq += 1
  return `sw-${Date.now().toString(36)}-${switchSeq.toString(36)}`
}

// setSwitchTraceSink 只在观测侧调用（基准收集器 / 开发期控制台）。
// 传 null 即彻底关闭观测；关闭后所有边界调用都变成一次空判断。
export function setSwitchTraceSink(next: SwitchTraceSink | null) {
  sink = next
}

export function beginSwitchTrace(key: string) {
  const k = String(key || '').trim()
  if (!k) return
  const marked = new Set<SwitchBoundary>()
  active = {
    switchId: nextSwitchId(),
    key: k,
    startedAt: now(),
    marked,
    mark: (boundary) => {
      if (!sink) return
      // 同一边界在一次切换里只上报一次：观测本身不能制造噪声。
      if (marked.has(boundary)) return
      marked.add(boundary)
      try {
        sink({ switchId: active!.switchId, boundary, key: k, sinceStartMs: Math.max(0, now() - active!.startedAt) })
      } catch (_) {}
    },
  }
}

export function markSwitchBoundary(boundary: SwitchBoundary) {
  if (!sink || !active) return
  active.mark(boundary)
}

export function endSwitchTrace() {
  if (active) active.mark('frontend.settled')
  active = null
}

export function currentSwitchTrace() {
  return active ? { switchId: active.switchId, key: active.key } : null
}

// 测试用：重置模块级状态，避免用例之间互相污染。
export function resetSwitchTraceForTests() {
  sink = null
  active = null
  switchSeq = 0
}
