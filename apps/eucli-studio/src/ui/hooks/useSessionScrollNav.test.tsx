// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useSessionScrollNav } from './useSessionScrollNav'
import { applySessionScrollIntent, type SessionScrollIntent } from '../scroll/sessionScrollNav'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

// 滚动几何在 happy-dom 里恒为 0，只能自己铺一套可写的度量。
// scrollTo 也接过来：记下用的是哪条滚动通道，并立刻落位，模拟动画走完的那一刻。
type ScrollState = {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
  behavior?: ScrollBehavior
}

function makeScrollBox(state: ScrollState) {
  const el = document.createElement('div')
  Object.defineProperty(el, 'scrollTop', {
    get: () => state.scrollTop,
    set: (value: number) => {
      state.scrollTop = Number(value) || 0
    },
    configurable: true,
  })
  Object.defineProperty(el, 'clientHeight', { get: () => state.clientHeight, configurable: true })
  Object.defineProperty(el, 'scrollHeight', { get: () => state.scrollHeight, configurable: true })
  Object.defineProperty(el, 'scrollTo', {
    value: (options: { top: number; behavior?: ScrollBehavior }) => {
      state.behavior = options.behavior || 'auto'
      state.scrollTop = options.top
    },
    configurable: true,
  })
  return el
}

function Harness(props: {
  enabled: boolean
  target: React.RefObject<HTMLElement | null>
  applied: SessionScrollIntent[]
}) {
  const onIntent = React.useCallback(
    (intent: SessionScrollIntent, el: HTMLElement) => {
      applySessionScrollIntent(el, intent)
      props.applied.push(intent)
    },
    [props.applied],
  )
  useSessionScrollNav({ enabled: props.enabled, scrollRef: props.target, onIntent })
  return null
}

describe('会话消息区的键盘翻页接线', () => {
  let host: HTMLDivElement
  let root: any
  let applied: SessionScrollIntent[]

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    applied = []
  })

  afterEach(() => {
    if (root) {
      act(() => root.unmount())
      root = null as any
    }
    host.remove()
    document.body.innerHTML = ''
  })

  function mount(target: HTMLElement, enabled = true) {
    const ref: React.RefObject<HTMLElement | null> = { current: target }
    act(() => {
      root.render(<Harness enabled={enabled} target={ref} applied={applied} />)
    })
  }

  function press(target: EventTarget, init: KeyboardEventInit) {
    const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    let notCanceled = true
    act(() => {
      notCanceled = target.dispatchEvent(e)
    })
    return notCanceled
  }

  it('光标在输入框里：Ctrl + PageDown 照样滚消息区，并把这个键从输入框手里拿走', () => {
    const state: ScrollState = { scrollTop: 1000, clientHeight: 800, scrollHeight: 4000 }
    const box = makeScrollBox(state)
    document.body.appendChild(box)
    mount(box)

    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    textarea.focus()
    expect(document.activeElement).toBe(textarea)

    const notCanceled = press(textarea, { key: 'PageDown', ctrlKey: true })

    expect(notCanceled).toBe(false)
    expect(state.scrollTop).toBe(1000 + 700)
    expect(state.behavior).toBe('smooth')
    expect(applied).toEqual(['page-down'])
  })

  it('光标在输入框里：Ctrl + End 一步到底，并恢复「追新消息」的落点', () => {
    const state = { scrollTop: 0, clientHeight: 800, scrollHeight: 4000 }
    const box = makeScrollBox(state)
    document.body.appendChild(box)
    mount(box)

    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    textarea.focus()

    press(textarea, { key: 'End', ctrlKey: true })

    expect(state.scrollTop).toBe(3200)
    expect(applied).toEqual(['bottom'])
  })

  it('不带 Ctrl 的 PageDown / End 原样留给输入框', () => {
    const state = { scrollTop: 500, clientHeight: 800, scrollHeight: 4000 }
    const box = makeScrollBox(state)
    document.body.appendChild(box)
    mount(box)

    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    textarea.focus()

    expect(press(textarea, { key: 'PageDown' })).toBe(true)
    expect(press(textarea, { key: 'End' })).toBe(true)
    expect(state.scrollTop).toBe(500)
    expect(applied).toEqual([])
  })

  it('带 Shift 的选字组合不碰', () => {
    const state = { scrollTop: 500, clientHeight: 800, scrollHeight: 4000 }
    const box = makeScrollBox(state)
    document.body.appendChild(box)
    mount(box)

    expect(press(document.body, { key: 'Home', ctrlKey: true, shiftKey: true })).toBe(true)
    expect(state.scrollTop).toBe(500)
    expect(applied).toEqual([])
  })

  it('不在会话页时（enabled 为假）完全不接管', () => {
    const state = { scrollTop: 500, clientHeight: 800, scrollHeight: 4000 }
    const box = makeScrollBox(state)
    document.body.appendChild(box)
    mount(box, false)

    expect(press(document.body, { key: 'PageUp', ctrlKey: true })).toBe(true)
    expect(state.scrollTop).toBe(500)
    expect(applied).toEqual([])
  })

  it('消息不满一屏时不接，键继续走原生', () => {
    const state = { scrollTop: 0, clientHeight: 800, scrollHeight: 500 }
    const box = makeScrollBox(state)
    document.body.appendChild(box)
    mount(box)

    expect(press(document.body, { key: 'End', ctrlKey: true })).toBe(true)
    expect(applied).toEqual([])
  })

  it('输入法组合中的按键不接', () => {
    const state = { scrollTop: 500, clientHeight: 800, scrollHeight: 4000 }
    const box = makeScrollBox(state)
    document.body.appendChild(box)
    mount(box)

    const e = new KeyboardEvent('keydown', { key: 'PageDown', ctrlKey: true, bubbles: true, cancelable: true })
    Object.defineProperty(e, 'isComposing', { get: () => true, configurable: true })
    let notCanceled = true
    act(() => {
      notCanceled = document.body.dispatchEvent(e)
    })

    expect(notCanceled).toBe(true)
    expect(state.scrollTop).toBe(500)
    expect(applied).toEqual([])
  })
})
