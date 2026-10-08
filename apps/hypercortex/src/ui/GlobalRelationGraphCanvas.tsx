import * as React from 'react'
import { select } from 'd3-selection'
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type ForceManyBody,
  type ForceX,
  type ForceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import { drag } from 'd3-drag'
import { zoom } from 'd3-zoom'
import { maxDegreeOf, nodeRadiusForDegree, type GlobalRelationGraph } from '../globalRelationGraph'

// 全局关系图的渲染与交互：d3-force 负责布局，绘制走 <canvas> 2D 上下文，
// 每帧绘制由 requestAnimationFrame 合并调度——仿真 tick 绝不触发 React 重渲染。
// d3-zoom 负责缩放平移，d3-drag 负责单节点拖动；命中判定在画布坐标系内做反变换。

type GraphNode = SimulationNodeDatum & {
  id: string
  title: string
  degree: number
  radius: number
}

type GraphLink = SimulationLinkDatum<GraphNode>

type PointTransform = { k: number; x: number; y: number }

type DragSubject = { node: GraphNode; x: number; y: number }

const LINK_DISTANCE = 70
const LINK_STRENGTH = 0.4
const DRAG_REHEAT_ALPHA = 0.3
const HIT_RADIUS_PADDING = 2

/** 画布命中判定：把屏幕坐标经缩放平移反变换回图坐标，返回命中的节点（后画的在上层，故倒序）。 */
export function findNodeAtPoint<T extends { x?: number; y?: number; radius: number }>(
  nodes: readonly T[],
  transform: PointTransform,
  px: number,
  py: number,
): T | null {
  if (!transform.k) return null
  const gx = (px - transform.x) / transform.k
  const gy = (py - transform.y) / transform.k
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    const dx = (node.x ?? 0) - gx
    const dy = (node.y ?? 0) - gy
    const radius = node.radius + HIT_RADIUS_PADDING
    if (dx * dx + dy * dy <= radius * radius) return node
  }
  return null
}

export function GlobalRelationGraphCanvas(props: {
  graph: GlobalRelationGraph
  /** 斥力（力导向负电荷强度，越负越散）。 */
  chargeStrength: number
  /** 往中心收的紧凑度（向心力的强度，越大越紧凑）。 */
  centerStrength: number
  onOpenNode: (id: string) => void
}) {
  const { graph, chargeStrength, centerStrength, onOpenNode } = props
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const [size, setSize] = React.useState({ width: 0, height: 0 })

  const onOpenNodeRef = React.useRef(onOpenNode)
  React.useEffect(() => {
    onOpenNodeRef.current = onOpenNode
  }, [onOpenNode])

  const simulationRef = React.useRef<Simulation<GraphNode, GraphLink> | null>(null)
  const forcesRef = React.useRef<{
    charge: ForceManyBody<GraphNode>
    x: ForceX<GraphNode>
    y: ForceY<GraphNode>
  } | null>(null)
  const nodesRef = React.useRef<GraphNode[]>([])
  const linksRef = React.useRef<GraphLink[]>([])
  const neighborsRef = React.useRef<Map<string, Set<string>>>(new Map())
  const transformRef = React.useRef<PointTransform>({ k: 1, x: 0, y: 0 })
  const hoverRef = React.useRef<string | null>(null)
  const colorsRef = React.useRef({ primary: '#4b6fae', surface: '#ffffff', text: '#1d2430', edge: '#8a94a6' })
  const frameRef = React.useRef(0)

  React.useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // 构建仿真与画布：仅在数据或画布尺寸变化时重建。力强度不进入依赖（见下方独立副作用）。
  React.useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas || size.width <= 0 || size.height <= 0) return
    const width = size.width
    const height = size.height
    const dpr = window.devicePixelRatio || 1

    canvas.width = Math.max(1, Math.round(width * dpr))
    canvas.height = Math.max(1, Math.round(height * dpr))
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const canvasContext = canvas.getContext('2d')
    if (!canvasContext) return
    const ctx: CanvasRenderingContext2D = canvasContext

    const computed = getComputedStyle(container)
    colorsRef.current = {
      primary: computed.getPropertyValue('--hc-primary').trim() || '#4b6fae',
      surface: computed.getPropertyValue('--hc-surface').trim() || '#ffffff',
      text: computed.getPropertyValue('--hc-text').trim() || '#1d2430',
      edge: computed.getPropertyValue('--hc-text-subtle').trim() || '#8a94a6',
    }

    const maxDegree = maxDegreeOf(graph)
    const nodes: GraphNode[] = graph.nodes.map(node => ({
      id: node.id,
      title: node.title,
      degree: node.degree,
      radius: nodeRadiusForDegree(node.degree, maxDegree),
    }))
    const links: GraphLink[] = graph.edges.map(edge => ({ source: edge.source, target: edge.target }))
    const neighbors = new Map<string, Set<string>>()
    for (const node of nodes) neighbors.set(node.id, new Set())
    for (const edge of graph.edges) {
      neighbors.get(edge.source)?.add(edge.target)
      neighbors.get(edge.target)?.add(edge.source)
    }
    nodesRef.current = nodes
    linksRef.current = links
    neighborsRef.current = neighbors
    transformRef.current = { k: 1, x: 0, y: 0 }
    hoverRef.current = null

    function draw() {
      const { primary, surface, text, edge } = colorsRef.current
      const transform = transformRef.current
      const hoverId = hoverRef.current
      const activeNeighbors = hoverId ? neighborsRef.current.get(hoverId) : null

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      ctx.save()
      ctx.translate(transform.x, transform.y)
      ctx.scale(transform.k, transform.k)

      ctx.lineWidth = 1.2
      ctx.strokeStyle = edge
      for (const link of linksRef.current) {
        const source = link.source as GraphNode
        const target = link.target as GraphNode
        const incident = !hoverId || source.id === hoverId || target.id === hoverId
        ctx.globalAlpha = hoverId ? (incident ? 0.9 : 0.06) : 0.5
        ctx.beginPath()
        ctx.moveTo(source.x ?? 0, source.y ?? 0)
        ctx.lineTo(target.x ?? 0, target.y ?? 0)
        ctx.stroke()
      }

      ctx.textBaseline = 'middle'
      ctx.font = '11px Inter, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif'
      for (const node of nodesRef.current) {
        const active = !hoverId || node.id === hoverId || (activeNeighbors ? activeNeighbors.has(node.id) : false)
        const x = node.x ?? 0
        const y = node.y ?? 0
        ctx.globalAlpha = hoverId ? (active ? 1 : 0.15) : 1
        ctx.beginPath()
        ctx.arc(x, y, node.radius, 0, Math.PI * 2)
        ctx.fillStyle = primary
        ctx.fill()
        ctx.lineWidth = 1.5
        ctx.strokeStyle = surface
        ctx.stroke()

        ctx.globalAlpha = hoverId ? (active ? 1 : 0.15) : 0.9
        ctx.fillStyle = text
        ctx.fillText(node.title, x + node.radius + 4, y)
      }

      ctx.globalAlpha = 1
      ctx.restore()
    }

    function scheduleDraw() {
      if (frameRef.current) return
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = 0
        draw()
      })
    }

    const simulation = forceSimulation<GraphNode>(nodes)
      .force('link', forceLink<GraphNode, GraphLink>(links).id(node => node.id).distance(LINK_DISTANCE).strength(LINK_STRENGTH))
      .force('charge', forceManyBody<GraphNode>().strength(chargeStrength))
      .force('x', forceX<GraphNode>(width / 2).strength(centerStrength))
      .force('y', forceY<GraphNode>(height / 2).strength(centerStrength))
      .force('collide', forceCollide<GraphNode>().radius(node => node.radius + 4))
    simulation.on('tick', scheduleDraw)

    simulationRef.current = simulation
    forcesRef.current = {
      charge: simulation.force('charge') as ForceManyBody<GraphNode>,
      x: simulation.force('x') as ForceX<GraphNode>,
      y: simulation.force('y') as ForceY<GraphNode>,
    }

    // 命中判定用画布内坐标；指针坐标相对画布左上角（与缩放平移无关的屏幕像素）。
    const pointAt = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect()
      return { x: clientX - rect.left, y: clientY - rect.top }
    }
    const findAt = (px: number, py: number) => findNodeAtPoint(nodesRef.current, transformRef.current, px, py)

    // 拖动期间与缩放平移期间不更新悬停高亮，避免手感抖动。
    let gestureActive = 0
    let dragged = false

    const dragBehavior = drag<HTMLCanvasElement, unknown, DragSubject | null>()
      .container(() => canvas)
      .subject(event => {
        const node = findAt(event.x, event.y)
        if (!node) return null
        const transform = transformRef.current
        return { node, x: (node.x ?? 0) * transform.k + transform.x, y: (node.y ?? 0) * transform.k + transform.y }
      })
      .on('start', event => {
        const subject = event.subject
        if (!subject) return
        gestureActive += 1
        const node = subject.node
        if (!event.active) simulation.alphaTarget(DRAG_REHEAT_ALPHA).restart()
        node.fx = node.x
        node.fy = node.y
      })
      .on('drag', event => {
        const subject = event.subject
        if (!subject) return
        const node = subject.node
        dragged = true
        const transform = transformRef.current
        node.fx = (event.x - transform.x) / transform.k
        node.fy = (event.y - transform.y) / transform.k
        scheduleDraw()
      })
      .on('end', event => {
        const subject = event.subject
        if (!subject) return
        gestureActive = Math.max(0, gestureActive - 1)
        const node = subject.node
        if (!event.active) simulation.alphaTarget(0)
        node.fx = null
        node.fy = null
        window.setTimeout(() => {
          dragged = false
        }, 0)
      })
    select(canvas).call(dragBehavior)

    const zoomBehavior = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 8])
      .on('start', () => {
        gestureActive += 1
      })
      .on('zoom', event => {
        transformRef.current = { k: event.transform.k, x: event.transform.x, y: event.transform.y }
        scheduleDraw()
      })
      .on('end', () => {
        gestureActive = Math.max(0, gestureActive - 1)
      })
    select(canvas).call(zoomBehavior)

    const handleMove = (event: MouseEvent) => {
      if (gestureActive > 0) return
      const point = pointAt(event.clientX, event.clientY)
      const nextId = findAt(point.x, point.y)?.id ?? null
      if (nextId === hoverRef.current) return
      hoverRef.current = nextId
      canvas.style.cursor = nextId ? 'pointer' : 'grab'
      scheduleDraw()
    }
    const handleLeave = () => {
      if (!hoverRef.current) return
      hoverRef.current = null
      scheduleDraw()
    }
    const handleClick = (event: MouseEvent) => {
      if (dragged) return
      const point = pointAt(event.clientX, event.clientY)
      const node = findAt(point.x, point.y)
      if (node) onOpenNodeRef.current(node.id)
    }
    canvas.addEventListener('mousemove', handleMove)
    canvas.addEventListener('mouseleave', handleLeave)
    canvas.addEventListener('click', handleClick)

    draw()

    return () => {
      simulation.stop()
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = 0
      }
      canvas.removeEventListener('mousemove', handleMove)
      canvas.removeEventListener('mouseleave', handleLeave)
      canvas.removeEventListener('click', handleClick)
      select(canvas).on('.drag', null).on('.zoom', null)
      simulationRef.current = null
      forcesRef.current = null
    }
  }, [graph, size.height, size.width])

  // 布局参数只调整力强度并重加热，不重建图形，保留缩放与节点位置。
  React.useEffect(() => {
    const forces = forcesRef.current
    const simulation = simulationRef.current
    if (!forces || !simulation) return
    forces.charge.strength(chargeStrength)
    forces.x.strength(centerStrength)
    forces.y.strength(centerStrength)
    simulation.alpha(0.5).restart()
  }, [chargeStrength, centerStrength])

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} style={{ display: 'block', cursor: 'grab' }} />
    </div>
  )
}
