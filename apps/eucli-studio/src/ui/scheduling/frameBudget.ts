// 设计说明：
// 1. 时间预算用「实测帧长 × 比例」而不是固定毫秒：固定值在快机器上纯属空转，
//    在慢机器上又可能一帧塞进过多工作。比例让预算随显示器刷新率自动伸缩。
// 2. 预算之外还必须限制每片条数：单条任务极快时，光看时间会让一整帧被无数小
//    任务填满，浏览器仍然得不到绘制机会。时间与条数谁先到，谁触发让出。
// 3. 执行器必须有明确终点：任务耗尽或调用方取消时立刻收束，不再排下一片，
//    不保留常驻 rAF、定时器或轮询，否则一次打开会话就会留下永久后台节拍。

export const DEFAULT_FRAME_LENGTH_MS = 1000 / 60
export const MIN_FRAME_LENGTH_MS = 4
export const MAX_FRAME_LENGTH_MS = 50
export const DEFAULT_FRAME_BUDGET_RATIO = 0.5
export const DEFAULT_MAX_TASKS_PER_SLICE = 10

const MIN_FRAME_BUDGET_RATIO = 0.1
const MAX_FRAME_BUDGET_RATIO = 1
const DEFAULT_MIN_FRAME_SAMPLES = 3
const DEFAULT_FRAME_SAMPLE_WINDOW = 8

type SchedulerHost = {
  scheduler?: {
    yield?: () => Promise<void>
  }
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export type FrameLengthEstimatorOptions = {
  defaultFrameMs?: number
  minFrameMs?: number
  maxFrameMs?: number
  minSamples?: number
  sampleWindow?: number
}

export type FrameLengthEstimator = {
  sample: (timestampMs: number) => void
  estimate: () => number
}

export function createFrameLengthEstimator(options: FrameLengthEstimatorOptions = {}): FrameLengthEstimator {
  const minFrameMs = positiveNumber(options.minFrameMs, MIN_FRAME_LENGTH_MS)
  const maxFrameMs = Math.max(minFrameMs, positiveNumber(options.maxFrameMs, MAX_FRAME_LENGTH_MS))
  const defaultFrameMs = clampNumber(
    positiveNumber(options.defaultFrameMs, DEFAULT_FRAME_LENGTH_MS),
    minFrameMs,
    maxFrameMs,
  )
  const minSamples = Math.max(1, Math.floor(positiveNumber(options.minSamples, DEFAULT_MIN_FRAME_SAMPLES)))
  const sampleWindow = Math.max(
    minSamples,
    Math.floor(positiveNumber(options.sampleWindow, DEFAULT_FRAME_SAMPLE_WINDOW)),
  )

  const samples: number[] = []
  let previousTimestamp: number | null = null

  function sample(timestampMs: number): void {
    if (!Number.isFinite(timestampMs)) return
    if (previousTimestamp === null) {
      previousTimestamp = timestampMs
      return
    }
    if (timestampMs <= previousTimestamp) return
    const delta = timestampMs - previousTimestamp
    previousTimestamp = timestampMs
    samples.push(clampNumber(delta, minFrameMs, maxFrameMs))
    if (samples.length > sampleWindow) samples.shift()
  }

  function estimate(): number {
    if (samples.length < minSamples) return defaultFrameMs
    let total = 0
    for (const value of samples) total += value
    return clampNumber(total / samples.length, minFrameMs, maxFrameMs)
  }

  return { sample, estimate }
}

export type YieldHandle = {
  promise: Promise<void>
  cancel: () => void
}

export type YieldToMain = () => YieldHandle

export function yieldToMain(): YieldHandle {
  const scheduler = (globalThis as typeof globalThis & SchedulerHost).scheduler
  if (scheduler && typeof scheduler.yield === 'function') {
    return { promise: scheduler.yield(), cancel: () => {} }
  }

  let cancelTimer = () => {}
  const promise = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 0)
    cancelTimer = () => {
      clearTimeout(timer)
      resolve()
    }
  })
  return { promise, cancel: () => cancelTimer() }
}

export type FrameBudgetEndReason = 'completed' | 'cancelled'

export type FrameBudgetOptions = {
  ratio?: number
  maxTasksPerSlice?: number
  frameLengthMs?: number | (() => number)
  now?: () => number
  yieldToMain?: YieldToMain
}

export type FrameBudgetRun = {
  cancel: () => void
  done: Promise<FrameBudgetEndReason>
}

function defaultNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now()
  return Date.now()
}

export function runFrameBudgetTasks<T>(
  tasks: readonly T[],
  processTask: (task: T, index: number) => void,
  options: FrameBudgetOptions = {},
): FrameBudgetRun {
  const now = options.now ?? defaultNow
  const waitForNextSlice = options.yieldToMain ?? yieldToMain
  const ratio = clampNumber(
    positiveNumber(options.ratio, DEFAULT_FRAME_BUDGET_RATIO),
    MIN_FRAME_BUDGET_RATIO,
    MAX_FRAME_BUDGET_RATIO,
  )
  const maxTasksPerSlice = Math.max(
    1,
    Math.floor(positiveNumber(options.maxTasksPerSlice, DEFAULT_MAX_TASKS_PER_SLICE)),
  )
  const frameLengthSetting = options.frameLengthMs ?? DEFAULT_FRAME_LENGTH_MS

  let cursor = 0
  let cancelled = false
  let settled = false
  let pendingYield: YieldHandle | null = null
  let resolveDone: (reason: FrameBudgetEndReason) => void = () => {}
  let rejectDone: (error: unknown) => void = () => {}
  const done = new Promise<FrameBudgetEndReason>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })

  function currentFrameLength(): number {
    const value = typeof frameLengthSetting === 'function' ? frameLengthSetting() : frameLengthSetting
    return positiveNumber(value, DEFAULT_FRAME_LENGTH_MS)
  }

  function settle(reason: FrameBudgetEndReason): void {
    if (settled) return
    settled = true
    resolveDone(reason)
  }

  function fail(error: unknown): void {
    if (settled) return
    settled = true
    cancelled = true
    rejectDone(error)
  }

  function scheduleNextSlice(): void {
    const handle = waitForNextSlice()
    pendingYield = handle
    handle.promise.then(
      () => {
        if (pendingYield === handle) pendingYield = null
        if (cancelled) return
        runSlice()
      },
      (error: unknown) => {
        if (pendingYield === handle) pendingYield = null
        fail(error)
      },
    )
  }

  function runSlice(): void {
    if (cancelled) return
    if (cursor >= tasks.length) {
      settle('completed')
      return
    }

    const budgetMs = currentFrameLength() * ratio
    const sliceStart = now()
    let handled = 0

    while (cursor < tasks.length && !cancelled) {
      try {
        processTask(tasks[cursor], cursor)
      } catch (error) {
        fail(error)
        return
      }
      cursor += 1
      handled += 1
      if (handled >= maxTasksPerSlice) break
      if (now() - sliceStart >= budgetMs) break
    }

    if (cancelled) return
    if (cursor >= tasks.length) {
      settle('completed')
      return
    }
    scheduleNextSlice()
  }

  runSlice()

  return {
    cancel: () => {
      if (cancelled || settled) return
      cancelled = true
      settle('cancelled')
      const handle = pendingYield
      pendingYield = null
      handle?.cancel()
    },
    done,
  }
}
