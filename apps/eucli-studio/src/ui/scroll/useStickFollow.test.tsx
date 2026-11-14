// @vitest-environment happy-dom
//
// 跟底内核：判定、吸附调度、以及换节点 / 撤帧这些外层消息区依赖的行为。
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStickFollow, type StickFollow } from './useStickFollow'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

type ScrollBox = {
  el: HTMLDivElement
  setScrollHeight: (value: number) => void
  setScrollTop: (value: number) => void
  read: () => number
}

// happy-dom 不做布局：几何自己托管，scrollTop 像浏览器那样钳在合法区间。
function makeScrollBox(el: HTMLDivElement, init: { scrollHeight: number; clientHeight: number }): ScrollBox {
  let top = 0
  let scrollHeight = init.scrollHeight
  const clientHeight = init.clientHeight
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
    setScrollHeight: (value: number) => {
      scrollHeight = value
      top = clamp(top)
    },
    setScrollTop: (value: number) => {
      top = clamp(value)
    },
    read: () => top,
  }
}

function Harness(props: {
  box: React.MutableRefObject<ScrollBox | null>
  api: React.MutableRefObject<StickFollow | null>
  enabled: boolean
  viewportKey: unknown
}) {
  const { box, api, enabled, viewportKey } = props
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const stick = useStickFollow({ scrollRef, enabled, viewportKey })
  api.current = stick
  return (
    <div
      ref={(el) => {
        if (!el) return
        scrollRef.current = el
        if (!box.current) box.current = makeScrollBox(el, { scrollHeight: 500, clientHeight: 200 })
      }}
    />
  )
}

describe('useStickFollow', () => {
  let host: HTMLDivElement | null = null
  let root: any = null
  let box: React.MutableRefObject<ScrollBox | null>
  let api: React.MutableRefObject<StickFollow | null>
  let frames = new Map<number, FrameRequestCallback>()
  let nextFrameId = 1

  const flushFrames = () => {
    const pending = Array.from(frames.values())
    frames.clear()
    for (const callback of pending) callback(0)
  }

  beforeEach(() => {
    frames = new Map()
    nextFrameId = 1
    box = { current: null }
    api = { current: null }
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

  const mount = (enabled = true, viewportKey: unknown = 'page-a') => {
    act(() => root.render(<Harness box={box} api={api} enabled={enabled} viewportKey={viewportKey} />))
    if (!box.current) throw new Error('滚动容器没挂上')
    return box.current
  }

  it('停用时既不判定也不写 scrollTop', () => {
    const view = mount(false)
    view.setScrollTop(100) // 离底很远
    act(() => {
      view.el.dispatchEvent(new Event('scroll'))
    })
    expect(api.current?.following).toBe(true)

    act(() => {
      api.current?.schedulePin()
    })
    expect(frames.size).toBe(0)
    act(() => flushFrames())
    expect(view.read()).toBe(100)
  })

  it('撤掉排队帧之后不再写 scrollTop，重新调度仍能贴底', () => {
    const view = mount()
    act(() => {
      api.current?.schedulePin()
    })
    expect(frames.size).toBe(1)

    act(() => {
      api.current?.cancelPin()
    })
    act(() => flushFrames())
    expect(view.read()).toBe(0)

    act(() => {
      api.current?.schedulePin()
    })
    act(() => flushFrames())
    expect(view.read()).toBe(300)
  })

  it('换滚动节点后用新节点的几何当基准，不会把第一下误判成用户上滚', () => {
    const view = mount(true, 'page-a')
    view.setScrollTop(300)
    act(() => {
      view.el.dispatchEvent(new Event('scroll'))
    })
    expect(api.current?.following).toBe(true)

    // 新页面：内容更长、视口停在中间。
    view.setScrollHeight(900)
    view.setScrollTop(100)
    act(() => root.render(<Harness box={box} api={api} enabled viewportKey="page-b" />))

    act(() => {
      view.el.dispatchEvent(new Event('scroll'))
    })
    // 旧基准是 300，不重置就会被当成往上带了 200px，跟随即被误判成让位。
    expect(api.current?.following).toBe(true)
  })

  it('别人推进过 scrollTop 时，滚动事件不抢着补位', () => {
    const view = mount()
    act(() => {
      api.current?.schedulePin()
    })
    act(() => flushFrames())
    expect(view.read()).toBe(300)

    // 平滑推进器把视口往底部推了一小段，内容同时长高：
    // 视口已经不在我们贴的那一格，补位不该插手。
    view.setScrollHeight(900)
    view.setScrollTop(400)
    act(() => {
      view.el.dispatchEvent(new Event('scroll'))
    })
    act(() => flushFrames())
    expect(view.read()).toBe(400)
  })

  it('吸附帧排队期间被滚轮动过，这一帧整帧放弃，一下都不吞', () => {
    const view = mount()
    act(() => {
      api.current?.schedulePin()
    })
    act(() => flushFrames())
    expect(view.read()).toBe(300)

    // 内容长高 → 吸附排队；排队还没执行，滚轮把视口往上带走（滚动事件尚未派发）。
    view.setScrollHeight(900)
    act(() => {
      api.current?.schedulePin()
    })
    view.setScrollTop(200)
    act(() => flushFrames())
    expect(view.read()).toBe(200)

    // 事件随后派发：这一下就是用户上滚，直接让位。
    act(() => {
      view.el.dispatchEvent(new Event('scroll'))
    })
    expect(api.current?.following).toBe(false)
  })

  it('放弃一帧之后，滚回底部仍能恢复跟随并继续贴底', () => {
    const view = mount()
    act(() => {
      api.current?.schedulePin()
    })
    act(() => flushFrames())
    expect(view.read()).toBe(300)

    view.setScrollHeight(900)
    act(() => {
      api.current?.schedulePin()
    })
    view.setScrollTop(200)
    act(() => flushFrames())
    act(() => {
      view.el.dispatchEvent(new Event('scroll'))
    })
    expect(api.current?.following).toBe(false)

    // 用户自己滚回最底：恢复跟随。
    view.setScrollTop(700)
    act(() => {
      view.el.dispatchEvent(new Event('scroll'))
    })
    expect(api.current?.following).toBe(true)

    // 内容继续增长，吸附照常写到底。
    view.setScrollHeight(1200)
    act(() => {
      api.current?.schedulePin()
    })
    act(() => flushFrames())
    expect(view.read()).toBe(1000)
  })

  it('用户上滚超出阈值才交还控制权，滚回底部恢复跟随时再写到底', () => {
    const view = mount()
    view.setScrollTop(300)
    act(() => {
      view.el.dispatchEvent(new Event('scroll'))
    })
    expect(api.current?.following).toBe(true)

    view.setScrollTop(60)
    act(() => {
      view.el.dispatchEvent(new Event('scroll'))
    })
    expect(api.current?.following).toBe(false)

    act(() => {
      api.current?.schedulePin()
    })
    act(() => flushFrames())
    expect(view.read()).toBe(60)

    act(() => {
      api.current?.setFollowing(true)
      view.setScrollTop(300)
      view.el.dispatchEvent(new Event('scroll'))
    })
    expect(api.current?.following).toBe(true)
  })
})
