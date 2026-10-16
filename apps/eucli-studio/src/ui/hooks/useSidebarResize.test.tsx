// @vitest-environment happy-dom
//
// 侧边栏宽度拖拽的性能契约：
// - 拖动期间不改任何宽度，只移动一条竖线（transform 平移，不触发布局）；
// - 指针事件挂在整窗，指针到哪竖线到哪，快速拖动不丢跟；
// - 松手才按竖线位置换算成宽度、提交一次，且夹在上下限内；
// - 松手后竖线消失；拖动中光标保持左右缩放样式并禁止选中文字。
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material'
import { getColorThemeColors, resolveColorThemePreview } from '../../domain/colorTheme'
import { createStudioMuiTheme } from '../colorThemeStyles'
import { SidebarResizeLine } from '../components/SidebarResizeLine'
import { useSidebarResize } from './useSidebarResize'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function makeRect(left: number, right: number): DOMRect {
  return {
    left,
    right,
    top: 0,
    bottom: 0,
    width: right - left,
    height: 0,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as any
}

function Harness(props: { side: 'left' | 'right'; onCommit: (w: number) => void }) {
  const resize = useSidebarResize({ side: props.side, onCommit: props.onCommit })
  return (
    <>
      <div data-testid="sidebar" ref={resize.sidebarRef as any} />
      <div data-testid="splitter" onPointerDown={resize.onSplitterPointerDown} />
      <SidebarResizeLine lineRef={resize.lineRef} active={resize.resizing} />
    </>
  )
}

describe('useSidebarResize：拖动只移竖线、松手才落宽度', () => {
  let host: HTMLDivElement | null = null
  let root: any = null

  beforeEach(() => {
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
    document.getElementById('fw-sidebar-resize-lock')?.remove()
  })

  function render(side: 'left' | 'right', onCommit: (w: number) => void, rect: DOMRect) {
    const theme = createStudioMuiTheme('light', getColorThemeColors(resolveColorThemePreview(undefined, null)))
    act(() => {
      root.render(
        <ThemeProvider theme={theme}>
          <Harness side={side} onCommit={onCommit} />
        </ThemeProvider>,
      )
    })
    const sidebar = host!.querySelector('[data-testid="sidebar"]') as HTMLElement
    sidebar.getBoundingClientRect = () => rect
    return sidebar
  }

  const splitter = () => host!.querySelector('[data-testid="splitter"]') as HTMLElement
  const line = () => document.querySelector('[data-sidebar-resize-line]') as HTMLElement | null

  function pointerDown(el: HTMLElement, clientX: number, pointerId = 1) {
    act(() => {
      el.dispatchEvent(new PointerEvent('pointerdown', { clientX, pointerId, button: 0, bubbles: true, cancelable: true }))
    })
  }
  function pointerMove(clientX: number, pointerId = 1) {
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX, pointerId, bubbles: true }))
    })
  }
  function pointerUp(clientX: number, pointerId = 1) {
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { clientX, pointerId, bubbles: true }))
    })
  }

  it('左侧栏：拖动期间不改宽度、竖线随光标平移，松手才提交一次', () => {
    const onCommit = vi.fn()
    const sidebar = render('left', onCommit, makeRect(0, 260))

    expect(line()).toBeNull()

    pointerDown(splitter(), 260)
    expect(line()).not.toBeNull()
    expect(line()!.style.transform).toBe('translateX(260px)')
    expect(sidebar.style.width).toBe('')

    // 事件挂在整窗：直接派发到 window 也要跟上，且不动宽度。
    pointerMove(400)
    expect(line()!.style.transform).toBe('translateX(400px)')
    expect(sidebar.style.width).toBe('')
    expect(onCommit).not.toHaveBeenCalled()

    pointerUp(400)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(400)
    expect(line()).toBeNull()
  })

  it('右侧栏：竖线位置按侧别换算成宽度', () => {
    const onCommit = vi.fn()
    render('right', onCommit, makeRect(540, 800))

    pointerDown(splitter(), 540)
    expect(line()!.style.transform).toBe('translateX(540px)')

    pointerMove(500)
    expect(line()!.style.transform).toBe('translateX(500px)')

    pointerUp(500)
    expect(onCommit).toHaveBeenCalledWith(300)
  })

  it('竖线与提交宽度都夹在最小值与最大值之间', () => {
    const onCommit = vi.fn()
    render('left', onCommit, makeRect(0, 260))

    pointerDown(splitter(), 260)
    pointerMove(50)
    expect(line()!.style.transform).toBe('translateX(200px)')

    pointerMove(9999)
    expect(line()!.style.transform).toBe('translateX(560px)')

    pointerUp(9999)
    expect(onCommit).toHaveBeenCalledWith(560)
  })

  it('快速拖动不丢跟：多次移动后以最后一次位置为准', () => {
    const onCommit = vi.fn()
    render('left', onCommit, makeRect(0, 260))

    pointerDown(splitter(), 260)
    pointerMove(300)
    pointerMove(340)
    pointerMove(380)
    pointerMove(420)
    expect(line()!.style.transform).toBe('translateX(420px)')

    pointerUp(420)
    expect(onCommit).toHaveBeenCalledWith(420)
  })

  it('拖动中强制保持左右缩放光标并禁止选中文字，松手后解除', () => {
    const onCommit = vi.fn()
    render('left', onCommit, makeRect(0, 260))

    const lock = () => document.getElementById('fw-sidebar-resize-lock')
    expect(lock()).toBeNull()

    pointerDown(splitter(), 260)
    expect(lock()).not.toBeNull()
    expect(lock()!.textContent).toContain('cursor:col-resize !important')
    expect(lock()!.textContent).toContain('user-select:none !important')

    pointerUp(260)
    expect(lock()).toBeNull()
  })

  it('非主键按下不进入拖拽', () => {
    const onCommit = vi.fn()
    render('left', onCommit, makeRect(0, 260))

    act(() => {
      splitter().dispatchEvent(new PointerEvent('pointerdown', { clientX: 260, pointerId: 1, button: 2, bubbles: true, cancelable: true }))
    })
    expect(line()).toBeNull()

    pointerUp(260)
    expect(onCommit).not.toHaveBeenCalled()
  })
})
