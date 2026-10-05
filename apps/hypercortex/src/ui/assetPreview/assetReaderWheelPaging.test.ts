// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachAssetReaderWheelPaging } from './assetReaderWheelPaging'

/**
 * 行为锁定测试（084 · 拆分期护栏）：
 * 从外部喂滚轮事件、观察翻页调用与错误回调；异步队列用宏任务冲洗，结果确定。
 */

type SetupOverrides = {
  canPrevious: () => boolean
  canNext: () => boolean
  onPreviousPage: () => Promise<void> | void
  onNextPage: () => Promise<void> | void
  onError: (message: string) => void
  errorMessage: string
}

function setup(overrides: Partial<SetupOverrides> = {}) {
  const surface = document.createElement('div')
  document.body.appendChild(surface)
  const calls: string[] = []
  const onPreviousPage = overrides.onPreviousPage ?? vi.fn(() => { calls.push('previous') })
  const onNextPage = overrides.onNextPage ?? vi.fn(() => { calls.push('next') })
  const onError = overrides.onError ?? vi.fn()
  const handle = attachAssetReaderWheelPaging({
    surface,
    canPrevious: overrides.canPrevious ?? (() => true),
    canNext: overrides.canNext ?? (() => true),
    onPreviousPage,
    onNextPage,
    onError,
    errorMessage: overrides.errorMessage ?? 'fallback',
  })
  return { surface, calls, onPreviousPage, onNextPage, onError, handle }
}

function wheel(surface: HTMLElement, init: WheelEventInit, target?: EventTarget): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
  ;(target ?? surface).dispatchEvent(event)
  return event
}

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

afterEach(() => {
  document.body.innerHTML = ''
})

describe('attachAssetReaderWheelPaging', () => {
  it('turns to the next page for a discrete wheel step', async () => {
    const { surface, onNextPage, onPreviousPage, handle } = setup()
    wheel(surface, { deltaY: 120 })
    await flush()
    expect(onNextPage).toHaveBeenCalledTimes(1)
    expect(onPreviousPage).not.toHaveBeenCalled()
    handle.destroy()
  })

  it('turns to the previous page for a negative discrete wheel step', async () => {
    const { surface, onPreviousPage, onNextPage, handle } = setup()
    wheel(surface, { deltaY: -120 })
    await flush()
    expect(onPreviousPage).toHaveBeenCalledTimes(1)
    expect(onNextPage).not.toHaveBeenCalled()
    handle.destroy()
  })

  it('counts multiple page-mode steps in a single event', async () => {
    const { surface, onNextPage, handle } = setup()
    wheel(surface, { deltaY: 3, deltaMode: 2 })
    await flush()
    expect(onNextPage).toHaveBeenCalledTimes(3)
    handle.destroy()
  })

  it('counts line-mode steps after normalization', async () => {
    const { surface, onNextPage, handle } = setup()
    wheel(surface, { deltaY: 6, deltaMode: 1 })
    await flush()
    expect(onNextPage).toHaveBeenCalledTimes(2)
    handle.destroy()
  })

  it('treats any integer pixel delta of at least 4 as one page step', async () => {
    const { surface, onNextPage, handle } = setup()
    wheel(surface, { deltaY: 4 })
    await flush()
    expect(onNextPage).toHaveBeenCalledTimes(1)
    handle.destroy()
  })

  it('accumulates sub-threshold pixel deltas until a page unit is reached', async () => {
    const { surface, onNextPage, handle } = setup()
    wheel(surface, { deltaY: 60.5 })
    await flush()
    expect(onNextPage).not.toHaveBeenCalled()
    wheel(surface, { deltaY: 60.5 })
    await flush()
    expect(onNextPage).toHaveBeenCalledTimes(1)
    handle.destroy()
  })

  it('resets the remainder when the wheel direction reverses', async () => {
    const { surface, onNextPage, handle } = setup()
    wheel(surface, { deltaY: 60.5 })
    wheel(surface, { deltaY: -60.5 })
    await flush()
    expect(onNextPage).not.toHaveBeenCalled()
    handle.destroy()
  })

  it('does not claim or turn for modifier wheels', async () => {
    const { surface, onNextPage, handle } = setup()
    const event = wheel(surface, { deltaY: 120, ctrlKey: true })
    await flush()
    expect(onNextPage).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    handle.destroy()
  })

  it('ignores wheels originating from interactive targets', async () => {
    const { surface, onNextPage, handle } = setup()
    const input = document.createElement('input')
    surface.appendChild(input)
    wheel(surface, { deltaY: 120 }, input)
    await flush()
    expect(onNextPage).not.toHaveBeenCalled()
    handle.destroy()
  })

  it('claims the wheel event it consumes', async () => {
    const { surface, handle } = setup()
    const event = wheel(surface, { deltaY: 120 })
    await flush()
    expect(event.defaultPrevented).toBe(true)
    handle.destroy()
  })

  it('respects canNext and canPrevious gates', async () => {
    const { surface, onNextPage, onPreviousPage, handle } = setup({ canNext: () => false, canPrevious: () => false })
    wheel(surface, { deltaY: 120 })
    wheel(surface, { deltaY: -120 })
    await flush()
    expect(onNextPage).not.toHaveBeenCalled()
    expect(onPreviousPage).not.toHaveBeenCalled()
    handle.destroy()
  })

  it('runs queued turns in event order', async () => {
    const { surface, calls, handle } = setup()
    wheel(surface, { deltaY: 120 })
    wheel(surface, { deltaY: -120 })
    await flush()
    expect(calls).toEqual(['next', 'previous'])
    handle.destroy()
  })

  it('reports thrown errors through onError', async () => {
    const onError = vi.fn()
    const onNextPage = vi.fn(() => { throw new Error('boom') })
    const { surface, handle } = setup({ onError, onNextPage })
    wheel(surface, { deltaY: 120 })
    await flush()
    expect(onError).toHaveBeenCalledWith('boom')
    handle.destroy()
  })

  it('reports rejected promises through onError', async () => {
    const onError = vi.fn()
    const onNextPage = vi.fn(() => Promise.reject(new Error('rejected')))
    const { surface, handle } = setup({ onError, onNextPage })
    wheel(surface, { deltaY: 120 })
    await flush()
    expect(onError).toHaveBeenCalledWith('rejected')
    handle.destroy()
  })

  it('falls back to the configured error message for falsy errors', async () => {
    const onError = vi.fn()
    const onNextPage = vi.fn(() => { throw null })
    const { surface, handle } = setup({ onError, onNextPage, errorMessage: 'fallback' })
    wheel(surface, { deltaY: 120 })
    await flush()
    expect(onError).toHaveBeenCalledWith('fallback')
    handle.destroy()
  })

  it('stops turning and detaches the listener after destroy', async () => {
    const { surface, onNextPage, handle } = setup()
    handle.destroy()
    wheel(surface, { deltaY: 120 })
    await flush()
    expect(onNextPage).not.toHaveBeenCalled()
  })
})
