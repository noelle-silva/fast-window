// @vitest-environment happy-dom
//
// 回底按钮：视口离底部才出现，点一下把视口送到最底并恢复贴底（按钮随即消失）。
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomScrollArea } from './CustomScrollArea'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []

  constructor(public callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this)
  }

  observe() {}

  unobserve() {}

  disconnect() {}

  emit() {
    this.callback([], this as any)
  }
}

// happy-dom 不做布局：滚动元素的几何与位置自己托管，scrollTop 像浏览器那样钳在合法区间。
function makeScrollable(el: HTMLElement) {
  let top = 0
  let scrollHeight = 500
  const clientHeight = 200
  const clamp = (value: number) => Math.min(Math.max(0, value), Math.max(0, scrollHeight - clientHeight))
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
    read: () => top,
    moveTo: (value: number) => {
      top = clamp(value)
    },
    growTo: (value: number) => {
      scrollHeight = value
      top = clamp(top)
    },
  }
}

function Harness(props: { backToBottom?: boolean; stickToBottom?: boolean }) {
  const { backToBottom, stickToBottom = true } = props
  return (
    <CustomScrollArea axis="y" stickToBottom={stickToBottom} backToBottom={backToBottom}>
      <div />
    </CustomScrollArea>
  )
}

describe('CustomScrollArea 的回底按钮', () => {
  let host: HTMLDivElement | null = null
  let root: any = null
  let frames = new Map<number, FrameRequestCallback>()
  let nextFrameId = 1

  const flushFrames = () => {
    const pending = Array.from(frames.values())
    frames.clear()
    for (const callback of pending) callback(0)
  }

  const mount = (props: { backToBottom?: boolean; stickToBottom?: boolean }) => {
    act(() => root.render(<Harness {...props} />))
    const area = host!.firstElementChild as HTMLElement
    const scroll = area.firstElementChild as HTMLElement
    return { area, scroll, view: makeScrollable(scroll) }
  }

  const button = () => host!.querySelector('button[aria-label="回到最新"]') as HTMLButtonElement | null

  beforeEach(() => {
    FakeResizeObserver.instances = []
    frames = new Map()
    nextFrameId = 1
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

  it('贴底时不显示按钮', () => {
    mount({ backToBottom: true })
    expect(button()).toBeNull()
  })

  it('离底部时浮出按钮，点击回到底部并恢复贴底', () => {
    const { scroll, view } = mount({ backToBottom: true })
    view.moveTo(100)
    act(() => {
      scroll.dispatchEvent(new Event('scroll'))
    })
    expect(button()).toBeTruthy()

    act(() => {
      button()!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(view.read()).toBe(300)
    expect(button()).toBeNull()
  })

  it('没开启就不渲染按钮', () => {
    const { scroll, view } = mount({})
    view.moveTo(100)
    act(() => {
      scroll.dispatchEvent(new Event('scroll'))
    })
    expect(host!.querySelectorAll('button').length).toBe(0)
  })

  it('关掉贴底跟随后按钮也不出现', () => {
    const { scroll, view } = mount({ backToBottom: true, stickToBottom: false })
    view.moveTo(100)
    act(() => {
      scroll.dispatchEvent(new Event('scroll'))
    })
    expect(button()).toBeNull()
  })

  it('回到贴底后新内容增长仍继续跟随', () => {
    const { scroll, view } = mount({ backToBottom: true })
    view.moveTo(100)
    act(() => {
      scroll.dispatchEvent(new Event('scroll'))
    })
    act(() => {
      button()!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(view.read()).toBe(300)

    // 内容变高：观测器回调把视口继续推到底。
    act(() => {
      view.growTo(800)
      const observer = FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1]
      observer?.emit()
    })
    act(() => flushFrames())
    expect(view.read()).toBe(600)
  })
})
