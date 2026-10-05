// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { useSearchSession, type SearchPage, type SearchSession, type UseSearchSessionOptions } from './quickSearchSession'

/**
 * 行为锁定测试（084 · 拆分期护栏）：
 * useSearchSession 是 React Hook，没有导出的纯函数。按 design-7「不为通过而改被测实现」，
 * 这里不改业务导出，改为用 jsdom + react-dom 的 harness 从外部驱动它，
 * 确定化地观测它返回的会话状态（items/total/loading/error/hasMore）。
 * 时间与数据源均被固定：防抖用假定时器，fetchPage 用受控 Promise。
 */

let latest: SearchSession<number> | null = null

type Holder = { current: UseSearchSessionOptions<number> }

function Harness({ holder, tick }: { holder: Holder; tick: number }) {
  void tick
  latest = useSearchSession<number>(holder.current)
  return null
}

let root: Root | null = null
let holder: Holder

beforeAll(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  if (root) {
    act(() => root!.unmount())
    root = null
  }
  latest = null
  vi.useRealTimers()
  document.body.innerHTML = ''
})

async function render(options: UseSearchSessionOptions<number>): Promise<void> {
  holder = { current: options }
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(React.createElement(Harness, { holder, tick: 0 }))
  })
}

async function rerender(options: UseSearchSessionOptions<number>): Promise<void> {
  holder.current = options
  await act(async () => {
    root!.render(React.createElement(Harness, { holder, tick: Math.random() }))
  })
}

function page(items: number[], total: number): SearchPage<number> {
  return { items, total }
}

async function flushDebounce(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(200)
    await Promise.resolve()
    await Promise.resolve()
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useSearchSession initial load', () => {
  it('enters loading before the debounce elapses', async () => {
    vi.useFakeTimers()
    const fetchPage = vi.fn(async () => page([1], 1))
    await render({ enabled: true, signature: 's', pageSize: 10, fetchPage })
    expect(latest?.loading).toBe(true)
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('fetches the first page after the debounce and reports hasMore', async () => {
    vi.useFakeTimers()
    const fetchPage = vi.fn(async () => page([1, 2], 5))
    await render({ enabled: true, signature: 's', pageSize: 2, fetchPage })
    await flushDebounce()
    expect(fetchPage).toHaveBeenCalledWith(0, 2)
    expect(latest).toMatchObject({ items: [1, 2], total: 5, loading: false, error: null, hasMore: true })
  })

  it('reports hasMore false when everything is loaded', async () => {
    vi.useFakeTimers()
    const fetchPage = vi.fn(async () => page([1, 2], 2))
    await render({ enabled: true, signature: 's', pageSize: 2, fetchPage })
    await flushDebounce()
    expect(latest?.hasMore).toBe(false)
  })

  it('captures the error message and clears results on failure', async () => {
    vi.useFakeTimers()
    const fetchPage = vi.fn(async () => {
      throw new Error('boom')
    })
    await render({ enabled: true, signature: 's', pageSize: 10, fetchPage })
    await flushDebounce()
    expect(latest).toMatchObject({ items: [], total: 0, loading: false, error: 'boom', hasMore: false })
  })

  it('falls back to a generic error message for a non-Error rejection', async () => {
    vi.useFakeTimers()
    const fetchPage = vi.fn(async () => {
      throw 'oops'
    })
    await render({ enabled: true, signature: 's', pageSize: 10, fetchPage })
    await flushDebounce()
    expect(latest?.error).toBe('oops')
  })
})

describe('useSearchSession disabled', () => {
  it('never fetches and clears results when disabled', async () => {
    vi.useFakeTimers()
    const fetchPage = vi.fn(async () => page([1], 1))
    await render({ enabled: false, signature: 's', pageSize: 10, fetchPage })
    await flushDebounce()
    expect(fetchPage).not.toHaveBeenCalled()
    expect(latest).toMatchObject({ items: [], total: 0, loading: false, loadingMore: false, error: null, hasMore: false })
  })

  it('clears a previously loaded result when disabled', async () => {
    vi.useFakeTimers()
    const fetchPage = vi.fn(async () => page([1, 2], 5))
    await render({ enabled: true, signature: 's', pageSize: 2, fetchPage })
    await flushDebounce()
    expect(latest?.items).toEqual([1, 2])
    await rerender({ enabled: false, signature: 's', pageSize: 2, fetchPage })
    await flushDebounce()
    expect(latest).toMatchObject({ items: [], total: 0, error: null })
  })
})

describe('useSearchSession re-search', () => {
  it('re-fetches when the signature changes', async () => {
    vi.useFakeTimers()
    const fetchPage = vi.fn(async () => page([1], 1))
    await render({ enabled: true, signature: 's1', pageSize: 10, fetchPage })
    await flushDebounce()
    fetchPage.mockResolvedValueOnce(page([2], 1))
    await rerender({ enabled: true, signature: 's2', pageSize: 10, fetchPage })
    await flushDebounce()
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(latest?.items).toEqual([2])
  })

  it('ignores a stale response from a superseded signature', async () => {
    vi.useFakeTimers()
    const first = deferred<SearchPage<number>>()
    const fetchPage = vi.fn(() => first.promise)
    await render({ enabled: true, signature: 's1', pageSize: 10, fetchPage })
    await act(async () => {
      vi.advanceTimersByTime(200)
    })

    const second = deferred<SearchPage<number>>()
    fetchPage.mockImplementationOnce(() => second.promise)
    await rerender({ enabled: true, signature: 's2', pageSize: 10, fetchPage })
    await act(async () => {
      vi.advanceTimersByTime(200)
    })

    await act(async () => {
      second.resolve(page([2], 1))
      await Promise.resolve()
    })
    await act(async () => {
      first.resolve(page([1], 9))
      await Promise.resolve()
    })

    expect(latest?.items).toEqual([2])
    expect(latest?.total).toBe(1)
  })
})

describe('useSearchSession loadMore', () => {
  it('appends the next page starting at the current item count', async () => {
    vi.useFakeTimers()
    const fetchPage = vi.fn(async (offset: number) => (offset === 0 ? page([1, 2], 4) : page([3, 4], 4)))
    await render({ enabled: true, signature: 's', pageSize: 2, fetchPage })
    await flushDebounce()
    await act(async () => {
      latest!.loadMore()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchPage).toHaveBeenLastCalledWith(2, 2)
    expect(latest?.items).toEqual([1, 2, 3, 4])
    expect(latest?.hasMore).toBe(false)
  })

  it('is a no-op when everything is already loaded', async () => {
    vi.useFakeTimers()
    const fetchPage = vi.fn(async () => page([1, 2], 2))
    await render({ enabled: true, signature: 's', pageSize: 2, fetchPage })
    await flushDebounce()
    await act(async () => {
      latest!.loadMore()
    })
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('is a no-op while the initial load is in flight', async () => {
    vi.useFakeTimers()
    const fetchPage = vi.fn(async () => page([1], 3))
    await render({ enabled: true, signature: 's', pageSize: 1, fetchPage })
    await act(async () => {
      latest!.loadMore()
    })
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('sets the error message when the next page fails', async () => {
    vi.useFakeTimers()
    const fetchPage = vi.fn(async (offset: number) => {
      if (offset === 0) return page([1], 3)
      throw new Error('more failed')
    })
    await render({ enabled: true, signature: 's', pageSize: 1, fetchPage })
    await flushDebounce()
    await act(async () => {
      latest!.loadMore()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(latest?.error).toBe('more failed')
  })
})
