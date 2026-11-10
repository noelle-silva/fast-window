// @vitest-environment happy-dom
//
// 测量合并：ResizeObserver 回调与 scroll 事件都只「安排」一次帧内测量。
// 同一帧里的一串 scroll / 一次 resize 抖动只测量一次，首帧仍同步测量一次。
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCustomScrollbar } from './CustomScrollbar'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []

  callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    FakeResizeObserver.instances.push(this)
  }

  observe() {}

  unobserve() {}

  disconnect() {}

  emit() {
    this.callback([], this as any)
  }
}

function latestObserver(): FakeResizeObserver {
  const instance = FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1]
  if (!instance) throw new Error('resize observer was not created')
  return instance
}

// 固定几何：clientHeight 300 / scrollHeight 1200 表示纵向可滚，度量结果稳定可比。
function prepareScrollable(el: HTMLDivElement) {
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 300 })
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => 400 })
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 1200 })
  Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => 400 })
}

type HarnessApi = { el: HTMLDivElement | null }

function Harness(props: { onMeasure: () => void; api: React.MutableRefObject<HarnessApi> }) {
  const { onMeasure, api } = props
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const setRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      scrollRef.current = el
      api.current = { el }
      if (el) prepareScrollable(el)
    },
    [api],
  )
  useCustomScrollbar({ scrollRef, axis: 'y', onScrollPositionChange: onMeasure })
  return <div ref={setRef} />
}

describe('useCustomScrollbar 的测量合并', () => {
  let host: HTMLDivElement | null = null
  let root: any = null
  let api: React.MutableRefObject<HarnessApi> = { current: { el: null } }
  let frames = new Map<number, FrameRequestCallback>()
  let nextFrameId = 1

  const flushFrames = () => {
    const pending = Array.from(frames.values())
    frames.clear()
    for (const callback of pending) callback(0)
  }

  beforeEach(() => {
    FakeResizeObserver.instances = []
    frames = new Map()
    nextFrameId = 1
    api = { current: { el: null } }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrameId++
      frames.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames.delete(id)
    })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount()
      })
      root = null
    }
    host?.remove()
    host = null
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('首帧同步测量一次，不额外排帧', async () => {
    const onMeasure = vi.fn()
    await act(async () => {
      root.render(<Harness onMeasure={onMeasure} api={api} />)
    })

    expect(onMeasure).toHaveBeenCalledTimes(1)
    expect(frames.size).toBe(0)
  })

  it('同一帧内的一串 scroll 只测量一次', async () => {
    const onMeasure = vi.fn()
    await act(async () => {
      root.render(<Harness onMeasure={onMeasure} api={api} />)
    })
    const el = api.current.el
    if (!el) throw new Error('scroll element was not mounted')

    await act(async () => {
      el.dispatchEvent(new Event('scroll'))
      el.dispatchEvent(new Event('scroll'))
      el.dispatchEvent(new Event('scroll'))
    })
    // 事件只排帧，不测量。
    expect(onMeasure).toHaveBeenCalledTimes(1)

    await act(async () => {
      flushFrames()
    })
    expect(onMeasure).toHaveBeenCalledTimes(2)
  })

  it('ResizeObserver 连续回调也只测量一次', async () => {
    const onMeasure = vi.fn()
    await act(async () => {
      root.render(<Harness onMeasure={onMeasure} api={api} />)
    })
    const observer = latestObserver()

    await act(async () => {
      observer.emit()
      observer.emit()
    })
    expect(onMeasure).toHaveBeenCalledTimes(1)

    await act(async () => {
      flushFrames()
    })
    expect(onMeasure).toHaveBeenCalledTimes(2)
  })

  it('卸载会取消尚未执行的测量帧', async () => {
    const onMeasure = vi.fn()
    await act(async () => {
      root.render(<Harness onMeasure={onMeasure} api={api} />)
    })
    const el = api.current.el
    if (!el) throw new Error('scroll element was not mounted')

    await act(async () => {
      el.dispatchEvent(new Event('scroll'))
    })
    expect(frames.size).toBe(1)

    await act(async () => {
      root.unmount()
    })
    root = null
    expect(frames.size).toBe(0)

    await act(async () => {
      flushFrames()
    })
    expect(onMeasure).toHaveBeenCalledTimes(1)
  })
})
