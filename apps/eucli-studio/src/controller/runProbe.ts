import { getRunState, isTerminalRunStatus, normalizeRunState, type EbRunState } from './ebRoleRun'

// RunProbe 取代 450ms 固定轮询（design-5 第八节）。
//
// 事件对终态是完备的：run_started / run_retrying / 四个终态事件都在，
// 且同一条 run 恰好一条终态事件。因此轮询只在「真的静默」时才发生：
//
//   触发：① 连续 N 秒无事件  ② WS 重连成功  ③ 页面重新可见
//   动作：GET /api/runs/{id} 一次
//   退避：10s → 20s → 40s → 60s（上限）
//   约束：同一 runId 最多 1 个在途探针
//
// 「事件丢失」的代价从「450ms 一条 HTTP」降到「10s 一条，且只在真静默时」。

export const RUN_PROBE_SILENCE_MS = 10_000
export const RUN_PROBE_MAX_BACKOFF_MS = 60_000

type DirectEventSubscription = (listener: (event: any) => void) => () => void

export type RunProbeDeps = {
  netRequest: (req: any) => Promise<any>
  subscribeDirectEvents?: DirectEventSubscription
  // 连接重建成功：探针必须立刻确认一次在途 run 的真实状态。
  onReconnected?: (listener: () => void) => () => void
}

// 终态事件类型与终态状态是两个命名空间：事件是 `run_completed`，
// 状态是 `completed`。两者都必须能触发权威探测。
const TERMINAL_RUN_EVENTS = new Set(['run_completed', 'run_failed', 'run_cancelled', 'run_canceled'])

function isTerminalRunEventType(value: unknown) {
  return TERMINAL_RUN_EVENTS.has(String(value || '').trim())
}

type ProbeEntry = {
  latest: EbRunState
  // 同一 run 可能被多处等待（发送路径 + 启动恢复）：全部在终态一起 resolve。
  waiters: Array<(run: EbRunState) => void>
  onUpdate?: (run: EbRunState) => void
  timer: ReturnType<typeof setTimeout> | null
  inFlight: boolean
  backoffMs: number
  settled: boolean
}

export type RunProbe = {
  // track 返回的 promise 在 run 进入终态时 resolve。
  // onUpdate 在探针拿到更新快照（仍非终态）时回调，用于把卡片同步到最新状态。
  track: (initial: EbRunState, onUpdate?: (run: EbRunState) => void) => Promise<EbRunState>
  noteActivity: (runId: string) => void
  probeNow: (runId: string) => void
  probeAll: () => void
  stop: () => void
  activeCount: () => number
}

export function createRunProbe(deps: RunProbeDeps): RunProbe {
  const entries = new Map<string, ProbeEntry>()
  const cleanups: Array<() => void> = []

  function clearTimer(entry: ProbeEntry) {
    if (entry.timer) {
      clearTimeout(entry.timer)
      entry.timer = null
    }
  }

  function settle(entry: ProbeEntry, run: EbRunState) {
    if (entry.settled) return
    entry.settled = true
    clearTimer(entry)
    // run 收尾后立刻摘除登记：探针表只持有「在途 run」，不积累历史。
    for (const [runId, current] of entries) {
      if (current === entry) {
        entries.delete(runId)
        break
      }
    }
    const waiters = entry.waiters
    entry.waiters = []
    for (const resolve of waiters) resolve(run)
  }

  function schedule(entry: ProbeEntry, runId: string) {
    if (entry.settled) return
    clearTimer(entry)
    entry.timer = setTimeout(() => {
      entry.timer = null
      void probe(runId)
    }, entry.backoffMs)
  }

  // probe 是唯一发 HTTP 的地方：同一 runId 最多 1 个在途探针。
  async function probe(runId: string) {
    const entry = entries.get(runId)
    if (!entry || entry.settled || entry.inFlight) return
    entry.inFlight = true
    try {
      const run = await getRunState(deps.netRequest, runId)
      if (entry.settled) return
      entry.latest = run
      if (isTerminalRunStatus(run.status)) {
        settle(entry, run)
        return
      }
      entry.onUpdate?.(run)
      entry.backoffMs = Math.min(entry.backoffMs * 2, RUN_PROBE_MAX_BACKOFF_MS)
      schedule(entry, runId)
    } catch {
      if (entry.settled) return
      // 探针失败不等于 run 失败：保留最后一次已知状态，继续按退避节奏确认。
      entry.backoffMs = Math.min(entry.backoffMs * 2, RUN_PROBE_MAX_BACKOFF_MS)
      schedule(entry, runId)
    } finally {
      entry.inFlight = false
    }
  }

  function noteActivity(runId: string) {
    const entry = entries.get(runId)
    if (!entry || entry.settled) return
    // 有事件到达说明事件通道还活着：静默计时重置，退避也回到起点。
    entry.backoffMs = RUN_PROBE_SILENCE_MS
    schedule(entry, runId)
  }

  function probeNow(runId: string) {
    const entry = entries.get(runId)
    if (!entry || entry.settled) return
    clearTimer(entry)
    void probe(runId)
  }

  function probeAll() {
    for (const runId of entries.keys()) probeNow(runId)
  }

  function track(initial: EbRunState, onUpdate?: (run: EbRunState) => void): Promise<EbRunState> {
    const runId = String(initial?.id || '').trim()
    if (!runId) return Promise.reject(new Error('run id 无效'))
    if (isTerminalRunStatus(initial.status)) return Promise.resolve(initial)
    const existing = entries.get(runId)
    if (existing) {
      // 同一 run 被多处等待：共用同一个探针，收尾时一起 resolve。
      if (onUpdate && !existing.onUpdate) existing.onUpdate = onUpdate
      return new Promise<EbRunState>((resolve) => {
        if (existing.settled) resolve(existing.latest)
        else existing.waiters.push(resolve)
      })
    }
    return new Promise<EbRunState>((resolve) => {
      const entry: ProbeEntry = {
        latest: initial,
        waiters: [resolve],
        onUpdate,
        timer: null,
        inFlight: false,
        backoffMs: RUN_PROBE_SILENCE_MS,
        settled: false,
      }
      entries.set(runId, entry)
      schedule(entry, runId)
    })
  }

  // applyEvent 只消费 box 运行事件信封 `{type, runId, payload}`：
  // 终态判定看信封的 type，状态合并看 payload。
  function applyEvent(event: any) {
    const name = String(event?.name || '').trim()
    if (name !== 'eucliBox.run.event') return
    const envelope = event?.payload
    if (!envelope || typeof envelope !== 'object') return
    const runId = String((envelope as any).runId || (envelope as any).payload?.runId || '').trim()
    if (!runId || !entries.has(runId)) return
    const entry = entries.get(runId)!
    const eventType = String((envelope as any).type || '').trim()
    // 终态事件是权威收尾信号：立刻探一次，拿到权威快照再 settle。
    if (isTerminalRunEventType(eventType) || isTerminalRunStatus((envelope as any).payload?.status)) {
      probeNow(runId)
      return
    }
    const snapshot = (envelope as any).payload
    if (snapshot && typeof snapshot === 'object') {
      entry.latest = normalizeRunState({ ...entry.latest, ...snapshot })
      entry.onUpdate?.(entry.latest)
    }
    noteActivity(runId)
  }

  if (deps.subscribeDirectEvents) {
    cleanups.push(deps.subscribeDirectEvents(applyEvent))
  }
  if (deps.onReconnected) {
    cleanups.push(deps.onReconnected(() => probeAll()))
  }
  const onVisible = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') probeAll()
  }
  const onOnline = () => probeAll()
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline)

  function stop() {
    for (const cleanup of cleanups) cleanup()
    cleanups.length = 0
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
    if (typeof window !== 'undefined') window.removeEventListener('online', onOnline)
    // 停止探针既不 resolve 也不 reject：controller 正在销毁，
    // 唤醒等待方只会让已废弃的页面继续跑收尾逻辑（多余重读 / 错误提示）。
    // 悬挂的 promise 随 controller 一起被回收。
    for (const entry of entries.values()) {
      clearTimer(entry)
      entry.settled = true
    }
    entries.clear()
  }

  return {
    track,
    noteActivity,
    probeNow,
    probeAll,
    stop,
    activeCount: () => entries.size,
  }
}
