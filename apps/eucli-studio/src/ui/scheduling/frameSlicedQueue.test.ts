import { afterEach, describe, expect, it, vi } from 'vitest'
import { runFrameSlicedQueue } from './frameSlicedQueue'
import type { YieldHandle, YieldToMain } from './frameBudget'

function immediateYield(onYield: () => void): YieldToMain {
  return () => {
    onYield()
    return { promise: Promise.resolve(), cancel: () => {} }
  }
}

function collect(items: readonly number[], options: {
  maxItemsPerSlice: number
  now: () => number
  frameLengthMs?: number
  ratio?: number
}) {
  const batches: number[][] = []
  let yields = 0
  const run = runFrameSlicedQueue<number>({
    items,
    maxItemsPerSlice: options.maxItemsPerSlice,
    now: options.now,
    frameLengthMs: options.frameLengthMs,
    ratio: options.ratio,
    yieldToMain: immediateYield(() => {
      yields += 1
    }),
    onSlice: (slice) => {
      batches.push([...slice])
    },
  })
  return { run, batches, yields: () => yields }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('runFrameSlicedQueue', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('条数到上限即让出：即使任务极快也按片切分', async () => {
    const { run, batches, yields } = collect([1, 2, 3, 4, 5, 6, 7, 8], {
      maxItemsPerSlice: 3,
      now: () => 0,
    })

    await expect(run.done).resolves.toBe('completed')
    expect(batches).toEqual([[1, 2, 3], [4, 5, 6], [7, 8]])
    expect(yields()).toBe(3)
  })

  it('预算到点即让出：帧长 × 比例先到也切分', async () => {
    let current = 0
    const now = () => {
      const value = current
      current += 6
      return value
    }

    const { run, batches, yields } = collect([1, 2, 3, 4, 5, 6, 7, 8], {
      maxItemsPerSlice: 100,
      now,
      frameLengthMs: 20,
      ratio: 0.5,
    })

    await expect(run.done).resolves.toBe('completed')
    expect(batches).toEqual([[1, 2], [3, 4], [5, 6], [7, 8]])
    expect(yields()).toBe(4)
  })

  it('两个上限谁先触发就按谁切分', async () => {
    let current = 0
    const budgetFirst = collect([1, 2, 3, 4, 5, 6], {
      maxItemsPerSlice: 100,
      now: () => {
        const value = current
        current += 6
        return value
      },
      frameLengthMs: 20,
      ratio: 0.5,
    })
    await budgetFirst.run.done
    expect(budgetFirst.batches).toEqual([[1, 2], [3, 4], [5, 6]])

    const countFirst = collect([1, 2, 3, 4, 5, 6], {
      maxItemsPerSlice: 2,
      now: () => 0,
    })
    await countFirst.run.done
    expect(countFirst.batches).toEqual([[1, 2], [3, 4], [5, 6]])
  })

  it('取消后不再推进，并取消进行中的让出等待', async () => {
    const batches: number[][] = []
    const cancelYield = vi.fn()
    let releaseYield: (() => void) | null = null
    const yieldToMain: YieldToMain = () => {
      const promise = new Promise<void>((resolve) => {
        releaseYield = resolve
      })
      return {
        promise,
        cancel: () => {
          cancelYield()
          releaseYield?.()
        },
      }
    }

    const run = runFrameSlicedQueue<number>({
      items: [1, 2, 3, 4, 5, 6, 7, 8],
      maxItemsPerSlice: 2,
      now: () => 0,
      yieldToMain,
      onSlice: (slice) => {
        batches.push([...slice])
      },
    })

    expect(batches).toEqual([[1, 2]])
    await flushMicrotasks()
    run.cancel()

    await expect(run.done).resolves.toBe('cancelled')
    expect(cancelYield).toHaveBeenCalledTimes(1)
    await flushMicrotasks()
    expect(batches).toEqual([[1, 2]])
  })

  it('取消会中断进行中的帧等待，并清理 rAF', async () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    const cancelAnimationFrame = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame)

    const batches: number[][] = []
    const run = runFrameSlicedQueue<number>({
      items: [1],
      maxItemsPerSlice: 1,
      now: () => 0,
      yieldToMain: immediateYield(() => {}),
      onSlice: async (slice, timing) => {
        batches.push([...slice])
        await timing.nextFrame()
      },
    })

    await flushMicrotasks()
    expect(batches).toEqual([[1]])

    run.cancel()
    await expect(run.done).resolves.toBe('cancelled')
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1)
  })

  it('让出原语的取消句柄会被透传', async () => {
    let settle: () => void = () => {}
    const cancel = vi.fn(() => settle())
    const pending: YieldHandle = {
      promise: new Promise<void>((resolve) => {
        settle = resolve
      }),
      cancel,
    }
    const yieldToMain = vi.fn(() => pending)
    const run = runFrameSlicedQueue<number>({
      items: [1, 2, 3, 4],
      maxItemsPerSlice: 2,
      now: () => 0,
      yieldToMain,
      onSlice: () => {},
    })

    await flushMicrotasks()
    run.cancel()
    await run.done
    expect(yieldToMain).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})
