// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

/**
 * 行为锁定测试（096 · 思维导图面）：
 * 锁定「容器宽高为 0 时不得实例化导图库、尺寸就绪后再实例化、卸载即销毁」这一运行时语义，
 * 以及「画布容器必须带确定高度」的布局约定（否则 height:100% 在流式宿主里解析为 0）。
 */

const mocks = vi.hoisted(() => {
  const instances: FakeMindMap[] = []
  const observers: FakeResizeObserver[] = []

  const root = { getData: (key: string) => (key === 'uid' ? 'root-uid' : '') }
  const childNode = { getData: (key: string) => (key === 'uid' ? 'node-uid' : '') }

  class FakeMindMap {
    handlers = new Map<string, Array<(...args: any[]) => void>>()
    options: Record<string, unknown>
    view = { setScale: vi.fn() }
    destroy = vi.fn()
    setData = vi.fn()
    setLayout = vi.fn()
    setThemeConfig = vi.fn()
    render = vi.fn()
    execCommand = vi.fn()
    renderer = {
      root,
      findNodeByUid: vi.fn((uid: string) => (uid === 'node-uid' ? childNode : null)),
    }
    static usePlugin = vi.fn()
    on = vi.fn((event: string, handler: (...args: any[]) => void) => {
      const list = this.handlers.get(event) ?? []
      list.push(handler)
      this.handlers.set(event, list)
    })
    constructor(options: { el?: HTMLElement | null }) {
      const el = options?.el
      if (!el || el.clientWidth <= 0 || el.clientHeight <= 0) {
        throw new Error('容器元素el的宽高不能为0')
      }
      this.options = options as unknown as Record<string, unknown>
      instances.push(this)
    }
  }

  class FakeResizeObserver {
    constructor(public callback: ResizeObserverCallback) {
      observers.push(this)
    }
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
    trigger() {
      this.callback([], this as unknown as ResizeObserver)
    }
  }

  return { instances, observers, FakeMindMap, FakeResizeObserver, root, childNode }
})

vi.mock('./mindmapEngine', () => ({ MindMap: mocks.FakeMindMap }))

import { MindmapCanvas } from './MindmapCanvas'

beforeAll(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as any).ResizeObserver = mocks.FakeResizeObserver
  if (!globalThis.requestAnimationFrame) {
    ;(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0)
  }
  if (!globalThis.cancelAnimationFrame) {
    ;(globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id)
  }
})

const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')

function mockSize(w: number, h: number) {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => w })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => h })
}

function restoreSize() {
  if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth)
  else delete (HTMLElement.prototype as any).clientWidth
  if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight)
  else delete (HTMLElement.prototype as any).clientHeight
}

let activeRoot: Root | null = null
let host: HTMLDivElement | null = null

beforeEach(() => {
  mocks.instances.length = 0
  mocks.observers.length = 0
})

afterEach(() => {
  if (activeRoot) {
    act(() => activeRoot!.unmount())
    activeRoot = null
  }
  if (host) {
    host.remove()
    host = null
  }
  restoreSize()
})

function renderCanvas(readonly = true): HTMLDivElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  activeRoot = root
  act(() => {
    root.render(
      React.createElement(MindmapCanvas, { content: '{"data":{"text":"根"},"children":[]}', readonly, layout: 'mindMap', theme: 'default', scale: 1 }),
    )
  })
  return host
}

describe('MindmapCanvas 尺寸语义', () => {
  it('容器宽高为 0 时不实例化导图库，也不抛错', () => {
    mockSize(0, 0)
    expect(() => renderCanvas()).not.toThrow()
    expect(mocks.instances).toHaveLength(0)
    expect(mocks.observers.length).toBeGreaterThan(0)
  })

  it('尺寸就绪后（ResizeObserver 触发）实例化一次', () => {
    mockSize(0, 0)
    renderCanvas()
    expect(mocks.instances).toHaveLength(0)

    mockSize(800, 600)
    act(() => {
      for (const observer of mocks.observers) observer.trigger()
    })
    expect(mocks.instances).toHaveLength(1)
  })

  it('尺寸已就绪时挂载即实例化', () => {
    mockSize(800, 600)
    renderCanvas()
    expect(mocks.instances).toHaveLength(1)
  })

  it('卸载时销毁导图实例', () => {
    mockSize(800, 600)
    renderCanvas()
    expect(mocks.instances).toHaveLength(1)
    const instance = mocks.instances[0]
    act(() => activeRoot!.unmount())
    activeRoot = null
    expect(instance.destroy).toHaveBeenCalledTimes(1)
  })

  it('画布容器带确定高度，避免 height:100% 在流式宿主中解析为 0', () => {
    mockSize(800, 600)
    const root = renderCanvas()
    const canvas = root.firstElementChild as HTMLElement | null
    expect(canvas).not.toBeNull()
    expect(Number.parseInt(canvas!.style.minHeight || '0', 10)).toBeGreaterThan(0)
  })
})

function findAddChildButton(root: HTMLElement): HTMLButtonElement | null {
  return root.querySelector('button[aria-label="添加子节点"]')
}

function getCanvasContainer(root: HTMLElement): HTMLElement {
  return (root.firstElementChild as HTMLElement).firstElementChild as HTMLElement
}

function dispatchNodeActive(instance: InstanceType<typeof mocks.FakeMindMap>, list: unknown[]): void {
  act(() => {
    for (const handler of instance.handlers.get('node_active') ?? []) handler(null, list)
  })
}

function dispatchBlankDblclick(root: HTMLElement): void {
  act(() => {
    getCanvasContainer(root).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  })
}

describe('MindmapCanvas 引擎装配与交互配置', () => {
  it('左键选择/拖节点、右键拖画布：组装选项传给导图库', () => {
    mockSize(800, 600)
    renderCanvas(false)
    expect(mocks.instances[0].options.useLeftKeySelectionRightKeyDrag).toBe(true)
  })
})

describe('MindmapCanvas 添加节点交互', () => {
  it('编辑态：无选中时「添加子节点」置灰，选中后可用并调用插入命令', () => {
    mockSize(800, 600)
    const host = renderCanvas(false)
    const instance = mocks.instances[0]

    expect(findAddChildButton(host)!.disabled).toBe(true)

    dispatchNodeActive(instance, [mocks.childNode])
    const button = findAddChildButton(host)!
    expect(button.disabled).toBe(false)

    act(() => button.click())
    expect(instance.execCommand).toHaveBeenCalledWith('INSERT_CHILD_NODE')
  })

  it('编辑态：双击空白处在最近选中的节点下新增子节点', () => {
    mockSize(800, 600)
    const host = renderCanvas(false)
    const instance = mocks.instances[0]

    dispatchNodeActive(instance, [mocks.childNode])
    dispatchNodeActive(instance, [])
    dispatchBlankDblclick(host)

    expect(instance.renderer.findNodeByUid).toHaveBeenCalledWith('node-uid')
    expect(instance.execCommand).toHaveBeenCalledWith('INSERT_CHILD_NODE', true, [mocks.childNode])
  })

  it('编辑态：从未选中过节点时，双击空白处新增到根节点', () => {
    mockSize(800, 600)
    const host = renderCanvas(false)
    const instance = mocks.instances[0]

    dispatchBlankDblclick(host)

    expect(instance.execCommand).toHaveBeenCalledWith('INSERT_CHILD_NODE', true, [mocks.root])
  })

  it('阅读态：不显示「添加子节点」，双击空白处不插入', () => {
    mockSize(800, 600)
    const host = renderCanvas(true)
    const instance = mocks.instances[0]

    expect(findAddChildButton(host)).toBeNull()
    dispatchBlankDblclick(host)

    expect(instance.execCommand).not.toHaveBeenCalled()
  })
})
