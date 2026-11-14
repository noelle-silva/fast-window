// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantReasoningPanel } from './AssistantReasoningPanel'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function click(el: Element | null) {
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function typeInto(el: HTMLTextAreaElement | HTMLInputElement | null, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set
  act(() => {
    setter?.call(el, value)
    el?.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

// 思维链块的清洗按钮：只在展开态的内容第一行出现，点开关键词输入弹窗，确认后把关键词交给清洗动作。
describe('AssistantReasoningPanel 清洗思维链', () => {
  let host: HTMLDivElement | null = null
  let root: any = null

  afterEach(() => {
    if (root) {
      act(() => root.unmount())
      root = null
    }
    host?.remove()
    host = null
  })

  function renderPanel(cleanMessageReasoning: any) {
    const controller: any = { actions: { cleanMessageReasoning } }
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => {
      root.render(
        <AssistantReasoningPanel
          controller={controller}
          mid="m1"
          isActive={false}
          displayMode="stay-expanded"
          renderMarkdown={false}
          text="思考内容"
          durationMs={0}
          renderSafetyPolicyKey="original"
          chatRootRef={{ current: null }}
        />,
      )
    })
    return host
  }

  it('收起时没有清洗入口，展开后才出现', async () => {
    const el = renderPanel(vi.fn(async () => true))

    expect(el.querySelector('button[aria-label="清洗思维链"]')).toBeNull()
    click(el.querySelector('[aria-label="展开思考过程"]'))
    await act(async () => {})
    expect(el.querySelector('button[aria-label="清洗思维链"]')).toBeTruthy()
  })

  it('确认后按消息 id 调用清洗动作', async () => {
    const cleanMessageReasoning = vi.fn(async () => true)
    const el = renderPanel(cleanMessageReasoning)

    click(el.querySelector('[aria-label="展开思考过程"]'))
    await act(async () => {})
    click(el.querySelector('button[aria-label="清洗思维链"]'))
    const input = document.querySelector('textarea') as HTMLTextAreaElement | null
    expect(input).toBeTruthy()
    typeInto(input, '甲\n乙')

    const buttons = Array.from(document.querySelectorAll('button'))
    const confirm = buttons.find((b) => b.textContent?.trim() === '清洗') || null
    await act(async () => {
      confirm?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(cleanMessageReasoning).toHaveBeenCalledWith('m1', '甲\n乙')
  })
})

// 思考内容的跟底：贴着底部时输出继续长高就要继续贴住。
// 这里按真实浏览器的事件顺序摆场景：吸附写入 → 内容再长 → 浏览器才派发上一笔的滚动事件。
describe('AssistantReasoningPanel 展开区跟底', () => {
  let host: HTMLDivElement | null = null
  let root: any = null
  let frames = new Map<number, FrameRequestCallback>()
  let nextFrameId = 1

  const flushFrames = () => {
    const pending = Array.from(frames.values())
    frames.clear()
    for (const callback of pending) callback(0)
  }

  // happy-dom 不做布局：几何自己托管，scrollTop 像浏览器那样钳在合法区间。
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

  class FakeResizeObserver {
    constructor(public callback: ResizeObserverCallback) {}
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  const renderPanel = (text: string) => {
    act(() => {
      root.render(
        <AssistantReasoningPanel
          controller={{ actions: {} } as any}
          mid="m1"
          isActive
          displayMode="stay-expanded"
          renderMarkdown={false}
          text={text}
          durationMs={0}
          renderSafetyPolicyKey="original"
          chatRootRef={{ current: null }}
        />,
      )
    })
  }

  const viewportEl = () => host!.querySelector('[data-eucli-scroll-viewport="1"]') as HTMLElement | null

  beforeEach(() => {
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

  it('贴底写入之后内容又长高，迟到的滚动事件不许取消跟随', () => {
    renderPanel('思考内容')
    const el = viewportEl()
    expect(el).toBeTruthy()
    const view = makeScrollable(el!)

    // 内容就位后一次正常渲染，把视口送到最底。
    renderPanel('思考内容 第一段')
    act(() => flushFrames())
    expect(view.read()).toBe(300)

    // 这一次写入的滚动事件此刻才派发：视口确实在底部。
    act(() => {
      el!.dispatchEvent(new Event('scroll'))
    })

    view.growTo(800)
    renderPanel('思考内容 第一段 第二段')
    act(() => flushFrames())
    expect(view.read()).toBe(600)

    // 派发上次写入的滚动事件时，输出又长了一截：量到的离底距离超过阈值。
    view.growTo(900)
    act(() => {
      el!.dispatchEvent(new Event('scroll'))
    })

    // 跟随权还在：下一次增长继续贴住。
    view.growTo(1100)
    renderPanel('思考内容 第一段 第二段 第三段')
    act(() => flushFrames())
    expect(view.read()).toBe(900)
  })

  it('用户上滚让位后，内容增长不再把人拽回底部', () => {
    renderPanel('思考内容')
    const el = viewportEl()
    const view = makeScrollable(el!)

    renderPanel('思考内容 第一段')
    act(() => flushFrames())
    expect(view.read()).toBe(300)

    // 用户把视口往上带走一截。
    view.moveTo(60)
    act(() => {
      el!.dispatchEvent(new Event('scroll'))
    })

    view.growTo(1200)
    renderPanel('思考内容 第一段 第二段')
    act(() => flushFrames())
    expect(view.read()).toBe(60)
  })
})
