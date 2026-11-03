import {
  createFrameLengthEstimator,
  runFrameBudgetTasks,
  yieldToMain as defaultYieldToMain,
  type FrameBudgetEndReason,
  type YieldHandle,
  type YieldToMain,
} from './frameBudget'

// 把「一条条任务」切成「一片片渲染单元」交给调用方：
// - 时间预算来自实测帧长 × 比例；
// - 条数上限保证即使单条极快也会让出，避免一整帧被无数小任务填满；
// - 每一片先交给 onSlice 完成真实渲染工作，再走统一让出原语，然后才继续下一片。
// - 取消会同时中断任务队列、rAF 等待与让出等待，不遗留任何定时器。

export type SliceTiming = {
  // 等待下一帧；返回 false 表示推进已被取消。
  nextFrame: () => Promise<boolean>
  // 统一让出原语（原生优先、自动回退）。
  yieldToMain: () => Promise<void>
  isCancelled: () => boolean
}

export type FrameSlicedQueueOptions<T> = {
  items: readonly T[]
  maxItemsPerSlice: number
  ratio?: number
  frameLengthMs?: number | (() => number)
  now?: () => number
  yieldToMain?: YieldToMain
  onSlice: (items: readonly T[], timing: SliceTiming) => Promise<void> | void
}

export type FrameSlicedQueueRun = {
  cancel: () => void
  done: Promise<FrameBudgetEndReason>
}

export function runFrameSlicedQueue<T>(options: FrameSlicedQueueOptions<T>): FrameSlicedQueueRun {
  const estimator = createFrameLengthEstimator()
  const waitForMain = options.yieldToMain ?? defaultYieldToMain

  let cancelled = false
  let buffer: T[] = []
  let pendingFrameCancel: (() => void) | null = null
  let pendingYield: YieldHandle | null = null

  const timing: SliceTiming = {
    nextFrame: () => new Promise<boolean>((resolve) => {
      if (cancelled) {
        resolve(false)
        return
      }
      const frame = requestAnimationFrame((timestamp) => {
        pendingFrameCancel = null
        estimator.sample(timestamp)
        resolve(!cancelled)
      })
      pendingFrameCancel = () => {
        cancelAnimationFrame(frame)
        pendingFrameCancel = null
        resolve(false)
      }
    }),
    yieldToMain: () => new Promise<void>((resolve) => {
      if (cancelled) {
        resolve()
        return
      }
      const handle = waitForMain()
      pendingYield = handle
      const settle = () => {
        if (pendingYield === handle) pendingYield = null
        resolve()
      }
      handle.promise.then(settle, settle)
    }),
    isCancelled: () => cancelled,
  }

  function cancel(): void {
    if (cancelled) return
    cancelled = true
    buffer = []
    pendingFrameCancel?.()
    pendingFrameCancel = null
    pendingYield?.cancel()
    pendingYield = null
  }

  function scheduleSlice(): YieldHandle {
    const slice = buffer
    buffer = []
    const promise = (async () => {
      if (slice.length && !cancelled) await options.onSlice(slice, timing)
      if (!cancelled) await timing.yieldToMain()
    })()
    return { promise, cancel }
  }

  const run = runFrameBudgetTasks(
    options.items,
    (item) => {
      buffer.push(item)
    },
    {
      maxTasksPerSlice: Math.max(1, Math.floor(options.maxItemsPerSlice)),
      ratio: options.ratio,
      frameLengthMs: options.frameLengthMs ?? (() => estimator.estimate()),
      now: options.now,
      yieldToMain: scheduleSlice,
    },
  )

  const done = run.done.then(
    async (reason) => {
      if (reason === 'completed') {
        const remainder = buffer
        buffer = []
        if (remainder.length && !cancelled) {
          await options.onSlice(remainder, timing)
          if (!cancelled) await timing.yieldToMain()
        }
      } else {
        buffer = []
      }
      return cancelled ? 'cancelled' : reason
    },
    async (error: unknown) => {
      cancel()
      throw error
    },
  )

  return {
    cancel: () => {
      run.cancel()
      cancel()
    },
    done,
  }
}
