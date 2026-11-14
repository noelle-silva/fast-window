// @vitest-environment happy-dom
//
// 自滚区域的跟底：贴着底部时内容继续增长就继续贴住；
// 用户主动上滚就交还控制权，滚回底部再恢复跟随。
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStickToBottom } from './useStickToBottom'

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

type ScrollBox = {
  el: HTMLDivElement
  setScrollHeight: (value: number) => void
  setScrollTop: (value: number) => void
  read: () => number
}

// happy-dom 不做布局：几何自己托管，scrollTop 像浏览器那样钳在合法区间。
function makeScrollBox(el: HTMLDivElement): ScrollBox {
  let top = 0
  let clientHeight = 200
  let scrollHeight = 500
  const maxScroll = () => Math.max(0, scrollHeight - clientHeight)
  const clamp = (value: number) => Math.min(Math.max(0, value), maxScroll())
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight })
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = clamp(value)
    },
  })
  return {
    el,
    setScrollHeight: (value) => {
      scrollHeight = value
      top = clamp(top)
    },
    setScrollTop: (value) => {
      top = clamp(value)
    },
    read: () => top,
  }
}

type StickApi = { following: boolean; scrollToBottom: () => void }

function Harness(props: {
  box: React.MutableRefObject<ScrollBox | null>
  api: React.MutableRefObject<StickApi>
  enabled?: boolean
}) {
  const { box, api, enabled = true } = props
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const { following, scrollToBottom } = useStickToBottom({ scrollRef, contentRef, enabled })
  api.current = { following, scrollToBottom }
  return (
    <div
      ref={(el) => {
        if (!el) return
        scrollRef.current = el
        // 内联 ref 每次重渲染都会重跑：假滚动盒只在首次建，否则几何会被重置。
        if (!box.current) box.current = makeScrollBox(el)
      }}
    >
      <div ref={contentRef} />
    </div>
  )
}

describe('useStickToBottom', () => {
  let host: HTMLDivElement | null = null
  let root: any = null
  let box: React.MutableRefObject<ScrollBox | null>
  let api: React.MutableRefObject<StickApi>
  let frames = new Map<number, FrameRequestCallback>()
  let nextFrameId = 1

  const flushFrames = () => {
    const pending = Array.from(frames.values())
    frames.clear()
    for (const callback of pending) callback(0)
  }

  const latestObserver = () => {
    const instance = FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1]
    if (!instance) throw new Error('resize observer was not created')
    return instance
  }

  beforeEach(() => {
    FakeResizeObserver.instances = []
    frames = new Map()
    nextFrameId = 1
    box = { current: null }
    api = { current: { following: true, scrollToBottom: () => {} } }
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

  afterEach(() => {
    if (root) {
      act(() => root.unmount())
      root = null
    }
    host?.remove()
    host = null
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const mount = (enabled = true) => {
    act(() => root.render(<Harness box={box} api={api} enabled={enabled} />))
    if (!box.current) throw new Error('滚动容器没挂上')
    return box.current
  }

  it('贴底时内容增高会继续贴住底部', () => {
    const view = mount()
    view.setScrollTop(300) // 先滚到底
    act(() => {
      view.el.dispatchEvent(new Event('scroll'))
      view.setScrollHeight(800)
      latestObserver().emit()
    })
    act(() => flushFrames())
    expect(view.read()).toBe(600)
  })

  it('用户上滚后不再跟随', () => {
    const view = mount()
    view.setScrollTop(100)
    act(() => {
      view.el.dispatchEvent(new Event('scroll'))
      view.setScrollHeight(800)
      latestObserver().emit()
    })
    act(() => flushFrames())
    expect(view.read()).toBe(100)
  })

  it('滚回底部后恢复跟随', () => {
    const view = mount()
    view.setScrollTop(100)
    act(() => {
      view.el.dispatchEvent(new Event('scroll'))
    })
    // 用户把滚动条拖回底部。
    view.setScrollTop(300)
    act(() => {
      view.el.dispatchEvent(new Event('scroll'))
      view.setScrollHeight(800)
      latestObserver().emit()
    })
    act(() => flushFrames())
    expect(view.read()).toBe(600)
  })

  it('同一帧里的多次增高只写一次', () => {
    const view = mount()
    view.setScrollTop(300)
    act(() => {
      view.el.dispatchEvent(new Event('scroll'))
      view.setScrollHeight(700)
      latestObserver().emit()
      view.setScrollHeight(800)
      latestObserver().emit()
    })
    expect(frames.size).toBe(1)
    act(() => flushFrames())
    expect(view.read()).toBe(600)
  })

  it('关闭开关后完全不介入', () => {
    const view = mount(false)
    view.setScrollTop(300)
    act(() => {
      view.el.dispatchEvent(new Event('scroll'))
      view.setScrollHeight(800)
    })
    // 没开就不该建观测器。
    expect(FakeResizeObserver.instances.length).toBe(0)
    act(() => flushFrames())
    expect(view.read()).toBe(300)
  })

  it('卸载会取消尚未执行的吸附帧', () => {
    const view = mount()
    view.setScrollTop(300)
    act(() => {
      view.el.dispatchEvent(new Event('scroll'))
      view.setScrollHeight(800)
      latestObserver().emit()
    })
    expect(frames.size).toBe(1)
    act(() => root.unmount())
    root = null
    expect(frames.size).toBe(0)
  })

  it('上滚后报告不在底部，回底命令把视口送回底部并恢复跟随', () => {
    const view = mount()
    expect(api.current.following).toBe(true)

    view.setScrollTop(100)
    act(() => {
      view.el.dispatchEvent(new Event('scroll'))
    })
    expect(api.current.following).toBe(false)

    act(() => {
      api.current.scrollToBottom()
    })
    expect(view.read()).toBe(300)
    expect(api.current.following).toBe(true)

    // 恢复跟随后，内容再增长仍然贴住。
    act(() => {
      view.setScrollHeight(800)
      latestObserver().emit()
    })
    act(() => flushFrames())
    expect(view.read()).toBe(600)
  })

  // 下面这条对应实机上「输出着输出着就不贴底了」：
  // 程序性贴底写进去之后，内容还在长，浏览器派发这次滚动的 scroll 事件时
  // 量到的离底距离已经超过阈值 —— 它不是用户上滚，不能把跟随判丢。
  it('贴底写入之后内容又长高，迟到的滚动事件不许取消跟随', () => {
    const view = mount()
    view.setScrollTop(300)
    act(() => {
      view.el.dispatchEvent(new Event('scroll'))
    })

    // 内容长高 → 观测器把吸附排到下一帧，写入后视口贴在底部。
    view.setScrollHeight(700)
    act(() => {
      latestObserver().emit()
    })
    act(() => flushFrames())
    expect(view.read()).toBe(500)

    // 派发这次写入的滚动事件时，流式输出又长高了一截：量到离底 60px。
    view.setScrollHeight(760)
    act(() => {
      view.el.dispatchEvent(new Event('scroll'))
    })

    // 跟随权还在：下一次增高继续贴住。
    view.setScrollHeight(900)
    act(() => {
      latestObserver().emit()
    })
    act(() => flushFrames())
    expect(view.read()).toBe(700)
  })

  it('连续多帧高速输出，每一帧的滚动事件都不夺走跟随', () => {
    const view = mount()
    view.setScrollTop(300)
    act(() => {
      view.el.dispatchEvent(new Event('scroll'))
    })

    for (let step = 1; step <= 6; step++) {
      // 一帧之内：内容先长高，观测器排好吸附，浏览器随后派发上一笔写入的滚动事件，
      // 最后才轮到这一帧的吸附执行。
      view.setScrollHeight(500 + step * 120)
      act(() => {
        latestObserver().emit()
        view.el.dispatchEvent(new Event('scroll'))
      })
      act(() => flushFrames())
    }

    view.setScrollHeight(1600)
    act(() => {
      latestObserver().emit()
    })
    act(() => flushFrames())
    expect(view.read()).toBe(1400)
  })

  it('跟随中量到离底时，滚动事件当场把视口补回底部', () => {
    const view = mount()
    view.setScrollTop(300)
    act(() => {
      view.el.dispatchEvent(new Event('scroll'))
    })

    // 高度变化没落到观测目标上：只剩滚动事件这一条通道，也要把视口补回去。
    view.setScrollHeight(740)
    act(() => {
      view.el.dispatchEvent(new Event('scroll'))
    })
    act(() => flushFrames())
    expect(view.read()).toBe(540)
  })

  it('内容收缩把视口夹小，不算用户上滚', () => {
    const view = mount()
    view.setScrollTop(300)
    act(() => {
      view.el.dispatchEvent(new Event('scroll'))
    })

    view.setScrollHeight(900)
    act(() => {
      latestObserver().emit()
    })
    act(() => flushFrames())
    expect(view.read()).toBe(700)

    // 上方内容收缩 200：scrollHeight 900 → 700，浏览器把 scrollTop 夹回 500。
    view.setScrollHeight(700)
    view.setScrollTop(500)
    act(() => {
      view.el.dispatchEvent(new Event('scroll'))
    })
    expect(api.current.following).toBe(true)

    // 收缩之后继续输出，仍然贴着底部走。
    view.setScrollHeight(1000)
    act(() => {
      latestObserver().emit()
    })
    act(() => flushFrames())
    expect(view.read()).toBe(800)
  })
})
