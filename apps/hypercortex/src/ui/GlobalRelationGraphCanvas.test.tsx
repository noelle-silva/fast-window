// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { GlobalRelationGraphCanvas, findNodeAtPoint, reconcileGraphNodes } from './GlobalRelationGraphCanvas'
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
    closePath: vi.fn(),
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

  function renderCanvas(graph: ReturnType<typeof buildGlobalRelationGraph>, showArrows: boolean, highlightNodeId?: string | null, initialScale?: number) {
    return act(async () => {
      root.render(
        <GlobalRelationGraphCanvas
          graph={graph}
          chargeStrength={-120}
          centerStrength={0.06}
          minNodeRadius={7}
          maxNodeRadius={13}
          linkWidth={1.2}
          showArrows={showArrows}
          dimOnHover
          highlightNodeId={highlightNodeId}
          initialScale={initialScale}
          onOpenNode={() => {}}
        />,
      )
    })
  }

  it('用 canvas 绘制全部节点与引用边，且不依赖每帧重渲染', async () => {
    const graph = buildGlobalRelationGraph([note('a'), note('b'), note('c')], { a: { f1: [{ noteId: 'b' }] } })

    await renderCanvas(graph, false)

    expect(container.querySelector('canvas')).not.toBeNull()
    // 节点数 = arc 调用次数，边数 = moveTo 调用次数（首帧同步绘制）。
    expect(contextStub.arc).toHaveBeenCalledTimes(3)
    expect(contextStub.moveTo).toHaveBeenCalledTimes(1)
    expect(contextStub.clearRect).toHaveBeenCalled()
  })

  it('单向引用只画一个箭头，双向引用两端都画箭头', async () => {
    const oneWay = buildGlobalRelationGraph([note('a'), note('b')], { a: { f1: [{ noteId: 'b' }] } })
    await renderCanvas(oneWay, true)
    // 一条连线 + 一个箭头 = 2 次 moveTo。
    expect(contextStub.moveTo).toHaveBeenCalledTimes(2)

    act(() => root.unmount())
    contextStub = createContextStub()
    root = createRoot(container)

    const twoWay = buildGlobalRelationGraph([note('a'), note('b')], { a: { f1: [{ noteId: 'b' }] }, b: { f1: [{ noteId: 'a' }] } })
    await renderCanvas(twoWay, true)
    // 一条连线 + 两端箭头 = 3 次 moveTo。
    expect(contextStub.moveTo).toHaveBeenCalledTimes(3)
  })

  it('关注节点更醒目：更大半径 + 提亮填充，其余节点保持常规', async () => {
    const graph = buildGlobalRelationGraph([note('a'), note('b')], { a: { f1: [{ noteId: 'b' }] } })
    const fills: string[] = []
    const arcs: number[] = []
    contextStub.fill = vi.fn(() => { fills.push(String(contextStub.fillStyle)) })
    contextStub.arc = vi.fn((_x: number, _y: number, r: number) => { arcs.push(r) })

    await renderCanvas(graph, false, 'a')

    // 关注节点叠加白色提亮层（其余节点没有），整体更亮。
    expect(fills).toContain('#ffffff')
    // 关注节点本体半径放大到 13+3=16，外圈光晕到 13+9=22。
    expect(arcs).toContain(16)
    expect(arcs).toContain(22)
  })

  it('未指定关注节点时不做提亮、不放大', async () => {
    const graph = buildGlobalRelationGraph([note('a'), note('b')], { a: { f1: [{ noteId: 'b' }] } })
    const fills: string[] = []
    const arcs: number[] = []
    contextStub.fill = vi.fn(() => { fills.push(String(contextStub.fillStyle)) })
    contextStub.arc = vi.fn((_x: number, _y: number, r: number) => { arcs.push(r) })

    await renderCanvas(graph, false)

    expect(fills).not.toContain('#ffffff')
    expect(arcs).not.toContain(16)
    expect(arcs).not.toContain(22)
  })

  it('按初始缩放拉近绘制', async () => {
    const graph = buildGlobalRelationGraph([note('a'), note('b')], { a: { f1: [{ noteId: 'b' }] } })
    const scales: number[][] = []
    contextStub.scale = vi.fn((k: number, ky: number) => { scales.push([k, ky]) })

    await renderCanvas(graph, false, null, 2)

    expect(scales).toContainEqual([2, 2])
  })

  it('图数据变化时保留视角：缩放与平移不被重置', async () => {
    const graphA = buildGlobalRelationGraph([note('a'), note('b')], { a: { f1: [{ noteId: 'b' }] } })
    const graphB = buildGlobalRelationGraph([note('a'), note('b'), note('c')], { a: { f1: [{ noteId: 'b' }] } })
    const translates: number[][] = []
    const scales: number[][] = []
    contextStub.translate = vi.fn((x: number, y: number) => { translates.push([x, y]) })
    contextStub.scale = vi.fn((k: number, ky: number) => { scales.push([k, ky]) })

    await renderCanvas(graphA, false, null, 2)
    // 初始拉近后视角：k=2，居中平移 =（宽/2·(1-2)，高/2·(1-2)）=（-400，-300）。
    expect(translates[translates.length - 1]).toEqual([-400, -300])
    expect(scales[scales.length - 1]).toEqual([2, 2])

    await renderCanvas(graphB, false, null, 2)
    // 换图后视角保持不动，未被重置为 1。
    expect(translates[translates.length - 1]).toEqual([-400, -300])
    expect(scales[scales.length - 1]).toEqual([2, 2])
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

describe('reconcileGraphNodes', () => {
  it('复用已存在节点对象并保留其坐标与速度，只更新标题/连接数/半径', () => {
    const existing = { id: 'a', title: '旧', degree: 0, radius: 7, x: 10, y: 20, vx: 1, vy: 2 }
    const nodes = reconcileGraphNodes([existing], [{ id: 'a', title: '新', degree: 3 }], () => 9, { x: 100, y: 100 }, false)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toBe(existing)
    expect(nodes[0]).toMatchObject({ title: '新', degree: 3, radius: 9, x: 10, y: 20, vx: 1, vy: 2 })
  })

  it('非首帧时新节点落到给定簇心，避免从原点飞入', () => {
    const existing = { id: 'a', title: 'A', degree: 0, radius: 7, x: 10, y: 20 }
    const nodes = reconcileGraphNodes([existing], [{ id: 'a', title: 'A', degree: 0 }, { id: 'b', title: 'B', degree: 0 }], () => 7, { x: 100, y: 100 }, false)
    expect(nodes.map(node => node.id)).toEqual(['a', 'b'])
    expect(nodes[1]).toMatchObject({ x: 100, y: 100 })
  })

  it('首帧新节点不预设坐标，交给力布局铺开', () => {
    const nodes = reconcileGraphNodes([], [{ id: 'a', title: 'A', degree: 0 }], () => 7, { x: 100, y: 100 }, true)
    expect(nodes[0].x).toBeUndefined()
    expect(nodes[0].y).toBeUndefined()
  })

  it('移除不再存在的节点，只保留入参中的节点', () => {
    const a = { id: 'a', title: 'A', degree: 0, radius: 7, x: 1, y: 2 }
    const b = { id: 'b', title: 'B', degree: 0, radius: 7, x: 3, y: 4 }
    const nodes = reconcileGraphNodes([a, b], [{ id: 'a', title: 'A', degree: 0 }], () => 7, { x: 0, y: 0 }, false)
    expect(nodes.map(node => node.id)).toEqual(['a'])
  })
})
