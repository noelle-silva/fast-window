import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createFrameLengthEstimator,
  runFrameBudgetTasks,
  yieldToMain,
} from './frameBudget'

function createClock() {
  let current = 0
  return {
    now: () => current,
    advance: (delta: number) => {
      current += delta
    },
  }
}

function immediateYield(onYield: () => void) {
  return () => {
    onYield()
    return { promise: Promise.resolve(), cancel: () => {} }
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

async function collectSlices(options: {
  perTaskMs: number
  maxTasksPerSlice: number
  taskCount?: number
}) {
  const clock = createClock()
  const processed: number[] = []
  const slices: number[] = []
  const tasks = Array.from({ length: options.taskCount ?? 5 }, (_, index) => index + 1)
  const run = runFrameBudgetTasks(
    tasks,
    (task) => {
      processed.push(task)
      clock.advance(options.perTaskMs)
    },
    {
      now: clock.now,
      frameLengthMs: 20,
      ratio: 0.5,
      maxTasksPerSlice: options.maxTasksPerSlice,
      yieldToMain: immediateYield(() => slices.push(processed.length)),
    },
  )
  await run.done
  return { processed, slices }
}

describe('runFrameBudgetTasks', () => {
  it('超过时间预算即让出', async () => {
    const { processed, slices } = await collectSlices({ perTaskMs: 6, maxTasksPerSlice: 100 })

    expect(processed).toEqual([1, 2, 3, 4, 5])
    expect(slices).toEqual([2, 4])
  })

  it('条数上限生效：单条很快也会按条数让出', async () => {
    const { processed, slices } = await collectSlices({
      perTaskMs: 0,
      maxTasksPerSlice: 3,
      taskCount: 8,
    })

    expect(processed).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(slices).toEqual([3, 6])
  })

  it('两个上限谁先触发就按谁让出', async () => {
    const budgetFirst = await collectSlices({ perTaskMs: 6, maxTasksPerSlice: 100, taskCount: 8 })
    expect(budgetFirst.slices).toEqual([2, 4, 6])

    const countFirst = await collectSlices({ perTaskMs: 0, maxTasksPerSlice: 3, taskCount: 8 })
    expect(countFirst.slices).toEqual([3, 6])
  })

  it('取消后立即停止，后续任务不再执行', async () => {
    const processed: number[] = []
    let resumeYield: (() => void) | null = null
    const cancelYield = vi.fn(() => {
      resumeYield?.()
    })
    const yieldToMainMock = vi.fn(() => {
      const promise = new Promise<void>((resolve) => {
        resumeYield = resolve
      })
      return { promise, cancel: cancelYield }
    })

    const run = runFrameBudgetTasks(
      [1, 2, 3, 4, 5],
      (task) => {
        processed.push(task)
      },
      {
        now: () => 0,
        frameLengthMs: 20,
        ratio: 0.5,
        maxTasksPerSlice: 2,
        yieldToMain: yieldToMainMock,
      },
    )

    expect(processed).toEqual([1, 2])
    expect(yieldToMainMock).toHaveBeenCalledTimes(1)

    run.cancel()
    expect(cancelYield).toHaveBeenCalledTimes(1)
    await expect(run.done).resolves.toBe('cancelled')
    await flushMicrotasks()

    expect(processed).toEqual([1, 2])
    expect(yieldToMainMock).toHaveBeenCalledTimes(1)
  })

  it('严格按输入顺序处理任务', async () => {
    const clock = createClock()
    const tasks = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const processed: string[] = []
    const run = runFrameBudgetTasks(
      tasks,
      (task) => {
        processed.push(task)
        clock.advance(4)
      },
      {
        now: clock.now,
        frameLengthMs: 20,
        ratio: 0.5,
        maxTasksPerSlice: 2,
        yieldToMain: immediateYield(() => {}),
      },
    )

    await expect(run.done).resolves.toBe('completed')
    expect(processed).toEqual(tasks)
  })

  it('空列表直接完成且不让出', async () => {
    const yieldToMainMock = vi.fn(immediateYield(() => {}))
    const run = runFrameBudgetTasks(
      [],
      () => {
        throw new Error('空列表不应执行任何任务')
      },
      { yieldToMain: yieldToMainMock },
    )

    await expect(run.done).resolves.toBe('completed')
    expect(yieldToMainMock).not.toHaveBeenCalled()
  })

  it('时钟不前进也不会无限循环：条数上限保证推进', async () => {
    const processed: number[] = []
    const slices: number[] = []
    const tasks = Array.from({ length: 50 }, (_, index) => index)
    const run = runFrameBudgetTasks(
      tasks,
      (task) => {
        processed.push(task)
      },
      {
        now: () => 0,
        frameLengthMs: 1,
        ratio: 0.5,
        maxTasksPerSlice: 4,
        yieldToMain: immediateYield(() => slices.push(processed.length)),
      },
    )

    await expect(run.done).resolves.toBe('completed')
    expect(processed).toEqual(tasks)
    expect(slices).toEqual([4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48])
  })
})

describe('createFrameLengthEstimator', () => {
  it('样本不足时使用默认值，样本够了才采用均值', () => {
    const estimator = createFrameLengthEstimator({
      defaultFrameMs: 16,
      minFrameMs: 4,
      maxFrameMs: 50,
      minSamples: 3,
      sampleWindow: 4,
    })

    expect(estimator.estimate()).toBe(16)

    estimator.sample(0)
    estimator.sample(16)
    estimator.sample(32)
    expect(estimator.estimate()).toBe(16)

    estimator.sample(48)
    expect(estimator.estimate()).toBe(16)
  })

  it('默认值与单个样本都夹取在上下限内', () => {
    const high = createFrameLengthEstimator({
      defaultFrameMs: 999,
      minFrameMs: 4,
      maxFrameMs: 50,
      minSamples: 1,
    })
    expect(high.estimate()).toBe(50)

    high.sample(0)
    high.sample(1)
    expect(high.estimate()).toBe(4)

    high.sample(1001)
    expect(high.estimate()).toBe(27)

    const low = createFrameLengthEstimator({ defaultFrameMs: 1, minFrameMs: 4, maxFrameMs: 50 })
    expect(low.estimate()).toBe(4)
  })

  it('只保留窗口内的样本，旧样本会被淘汰', () => {
    const estimator = createFrameLengthEstimator({
      defaultFrameMs: 10,
      minFrameMs: 4,
      maxFrameMs: 100,
      minSamples: 1,
      sampleWindow: 2,
    })

    estimator.sample(0)
    estimator.sample(10)
    expect(estimator.estimate()).toBe(10)

    estimator.sample(20)
    expect(estimator.estimate()).toBe(10)

    estimator.sample(40)
    expect(estimator.estimate()).toBe(15)

    estimator.sample(60)
    expect(estimator.estimate()).toBe(20)
  })
})

describe('yieldToMain', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('优先使用原生 scheduler.yield', async () => {
    const nativeYield = vi.fn(() => Promise.resolve())
    vi.stubGlobal('scheduler', { yield: nativeYield })

    const handle = yieldToMain()
    await handle.promise

    expect(nativeYield).toHaveBeenCalledTimes(1)
    handle.cancel()
  })

  it('没有原生能力时回退到 setTimeout(0)，取消会清掉定时器', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('scheduler', {})

    let firstFinished = false
    const first = yieldToMain()
    first.promise.then(() => {
      firstFinished = true
    })

    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(firstFinished).toBe(true)
    expect(vi.getTimerCount()).toBe(0)

    const second = yieldToMain()
    expect(vi.getTimerCount()).toBe(1)
    second.cancel()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(0)
  })
})
