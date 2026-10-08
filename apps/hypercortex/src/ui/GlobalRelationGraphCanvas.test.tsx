// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { GlobalRelationGraphCanvas, findNodeAtPoint } from './GlobalRelationGraphCanvas'
import { buildGlobalRelationGraph } from '../globalRelationGraph'
import type { NoteMeta } from '../core'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function note(id: string): NoteMeta {
  return { id, title: id.toUpperCase(), description: '', dir: '', createdAtMs: 0, updatedAtMs: 0 }
}

function createContextStub() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
    globalAlpha: 1,
    font: '',
    textBaseline: '',
  }
}

let contextStub: ReturnType<typeof createContextStub>

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverMock
  // jsdom 不做布局：给容器一个确定尺寸，让画布进入构建分支。
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 })
  HTMLCanvasElement.prototype.getContext = (() => contextStub) as unknown as HTMLCanvasElement['getContext']
})

describe('GlobalRelationGraphCanvas', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    contextStub = createContextStub()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('用 canvas 绘制全部节点与引用边，且不依赖每帧重渲染', async () => {
    const graph = buildGlobalRelationGraph([note('a'), note('b'), note('c')], { a: { f1: [{ noteId: 'b' }] } })

    await act(async () => {
      root.render(<GlobalRelationGraphCanvas graph={graph} chargeStrength={-120} centerStrength={0.06} onOpenNode={() => {}} />)
    })

    expect(container.querySelector('canvas')).not.toBeNull()
    // 节点数 = arc 调用次数，边数 = moveTo 调用次数（首帧同步绘制）。
    expect(contextStub.arc).toHaveBeenCalledTimes(3)
    expect(contextStub.moveTo).toHaveBeenCalledTimes(1)
    expect(contextStub.clearRect).toHaveBeenCalled()
  })
})

describe('findNodeAtPoint', () => {
  it('按缩放平移反变换命中节点', () => {
    const nodes = [{ x: 0, y: 0, radius: 10 }]
    expect(findNodeAtPoint(nodes, { k: 1, x: 0, y: 0 }, 0, 0)).toBe(nodes[0])
    expect(findNodeAtPoint(nodes, { k: 2, x: 100, y: 40 }, 100, 40)).toBe(nodes[0])
    expect(findNodeAtPoint(nodes, { k: 1, x: 0, y: 0 }, 50, 50)).toBeNull()
  })
})
