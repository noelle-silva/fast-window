// 切换 / 加载观测：switchId 与 loadId 贯穿一次操作的**全部边界**。
//
// 八个边界（design-1 P0 / design-4 P0）：
//
//   frontend.select       前端入口（用户选中）
//   frontend.command      偏好命令已发出（带 switchId 到 studio）
//   frontend.bodyReady    会话正文就绪（纯咨询，不门控渲染）
//   frontend.painted      新页首次提交完成
//   frontend.enhanceStart 首屏同步解析/装饰开始
//   frontend.enhanceEnd   首屏同步解析/装饰结束
//   frontend.settled      可见页追平选中页，切换结束
//   frontend.failed       本次切换失败（带原因）
//
// 四条铁律：
//   1. 一次切换只发一个 switchId，随命令参数一路带到 studio 后端；
//   2. 观测是纯旁路，不改变任何行为分支；
//   3. 没有挂 sink 时所有 mark 都是空操作，零成本；
//   4. 同一边界在一次切换里只上报一次（观测本身不制造噪声）。
//
// loadId 是「一次会话正文加载」的关联键，与 switchId 正交：
// 一次切换可能触发多次加载（首窗 + 翻页），它们共享 switchId、各自有 loadId。

export type SwitchBoundary =
  | 'frontend.select'
  | 'frontend.command'
  | 'frontend.bodyReady'
  | 'frontend.painted'
  | 'frontend.enhanceStart'
  | 'frontend.enhanceEnd'
  | 'frontend.settled'
  | 'frontend.failed'

export type SwitchMark = {
  switchId: string
  boundary: SwitchBoundary
  key: string
  sinceStartMs: number
  // 可选关联信息：loadId（正文加载）与失败原因。
  loadId?: string
  reason?: string
}

export type SwitchTraceSink = (mark: SwitchMark) => void

let switchSeq = 0
let loadSeq = 0
let sink: SwitchTraceSink | null = null
// 最近一次切换的句柄：绘制侧（painted / enhance* / settled）通过它补边界，
// 不需要把 span 一路透传到渲染树里。
let activeSpan: SwitchSpan | null = null

function now() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
}

export type SwitchSpan = {
  switchId: string
  key: string
  mark: (boundary: SwitchBoundary, detail?: { loadId?: string; reason?: string }) => void
  // fail 记录一次失败并收尾：失败也是一次切换的终态。
  fail: (reason: string) => void
  // settle 只在「可见页追平选中页」时调用一次（由渲染侧在 painted 之后触发）。
  // 命令成功 ≠ 切换结束：正文可能还没就绪、页面还没绘制。
  settle: () => void
  // 正文加载的关联键：同一次切换里的多次加载各自一个 loadId。
  beginLoad: () => string
}

// setSwitchTraceSink 只在观测侧调用（基准收集器 / 开发期控制台）。
// 传 null 即彻底关闭观测。
export function setSwitchTraceSink(next: SwitchTraceSink | null) {
  sink = next
}

// beginSwitchSpan 在用户选中会话的入口调用一次。
// 未挂 sink 时也返回 switchId：它同时是「这次切换」的关联键，会带到后端。
export function beginSwitchSpan(key: unknown): SwitchSpan {
  switchSeq += 1
  const switchId = `sw-${Date.now().toString(36)}-${switchSeq.toString(36)}`
  const normalizedKey = String(key || '').trim()
  const startedAt = now()
  const marked = new Set<SwitchBoundary>()
  const mark = (boundary: SwitchBoundary, detail?: { loadId?: string; reason?: string }) => {
    if (!sink) return
    if (marked.has(boundary)) return
    marked.add(boundary)
    try {
      sink({
        switchId,
        boundary,
        key: normalizedKey,
        sinceStartMs: Math.max(0, now() - startedAt),
        ...(detail?.loadId ? { loadId: detail.loadId } : {}),
        ...(detail?.reason ? { reason: detail.reason } : {}),
      })
    } catch (_) {}
  }
  const beginLoad = () => {
    loadSeq += 1
    return `ld-${Date.now().toString(36)}-${loadSeq.toString(36)}`
  }
  const span: SwitchSpan = {
    switchId,
    key: normalizedKey,
    mark,
    fail: (reason: string) => mark('frontend.failed', { reason }),
    settle: () => mark('frontend.settled'),
    beginLoad,
  }
  activeSpan = span
  return span
}

// currentSwitchSpan 供绘制侧补 painted / enhanceStart / enhanceEnd / settled。
// 返回的是「最近一次 beginSwitchSpan」的句柄；没有进行中的切换时为 null。
export function currentSwitchSpan(): SwitchSpan | null {
  return activeSpan
}

// 绘制侧的统一入口：一次切换的「绘制阶段」只在这里上报。
//
//   markPainted       新页首次提交完成
//   markEnhanceStart  首屏同步解析/装饰开始
//   markEnhanceEnd    首屏同步解析/装饰结束（同时收尾：settled）
//
// 未挂 sink 时全部是空操作。
export function markSwitchPainted() {
  activeSpan?.mark('frontend.painted')
}

export function markSwitchEnhanceStart() {
  activeSpan?.mark('frontend.enhanceStart')
}

export function markSwitchEnhanceEnd() {
  const span = activeSpan
  if (!span) return
  span.mark('frontend.enhanceEnd')
  // enhanceEnd 是「首屏装饰完成」的最后一个同步边界：
  // 到这一刻可见页才真正追平选中页，切换结束。
  span.settle()
}

// 测试用：重置模块级 sink 与序号，避免用例之间互相污染。
export function resetSwitchSpanForTests() {
  sink = null
  switchSeq = 0
  loadSeq = 0
  activeSpan = null
}

// 基准收集器：把 mark 聚合成「一次切换的耗时分解」。
// 这是 P0 量化的落点——没有它，埋点只是散落日志。
export type SwitchSpanSummary = {
  switchId: string
  key: string
  boundaries: Partial<Record<SwitchBoundary, number>>
  totalMs: number
  loadIds: string[]
  failed?: string
}

export function createSwitchSpanCollector() {
  const spans = new Map<string, SwitchSpanSummary>()
  const sinkImpl: SwitchTraceSink = (mark) => {
    let summary = spans.get(mark.switchId)
    if (!summary) {
      summary = { switchId: mark.switchId, key: mark.key, boundaries: {}, totalMs: 0, loadIds: [] }
      spans.set(mark.switchId, summary)
    }
    summary.boundaries[mark.boundary] = mark.sinceStartMs
    if (mark.sinceStartMs > summary.totalMs) summary.totalMs = mark.sinceStartMs
    if (mark.loadId && !summary.loadIds.includes(mark.loadId)) summary.loadIds.push(mark.loadId)
    if (mark.boundary === 'frontend.failed') summary.failed = mark.reason || 'unknown'
  }
  return {
    sink: sinkImpl,
    summaries: () => [...spans.values()],
    take: () => {
      const out = [...spans.values()]
      spans.clear()
      return out
    },
    reset: () => spans.clear(),
  }
}
