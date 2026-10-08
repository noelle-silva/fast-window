import * as React from 'react'
import { select } from 'd3-selection'
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type ForceCollide,
  type ForceManyBody,
  type ForceX,
  type ForceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import { drag } from 'd3-drag'
import { zoom, zoomIdentity } from 'd3-zoom'
import { maxDegreeOf, nodeRadiusForDegree, type GlobalRelationGraph } from '../globalRelationGraph'

// 全局关系图的渲染与交互：d3-force 负责布局，绘制走 <canvas> 2D 上下文，
// 每帧绘制由 requestAnimationFrame 合并调度——仿真 tick 绝不触发 React 重渲染。
// d3-zoom 负责缩放平移，d3-drag 负责单节点拖动；命中判定在画布坐标系内做反变换。

export type GraphNode = SimulationNodeDatum & {
  id: string
  title: string
  degree: number
  radius: number
}

/** 图数据（节点）的入参形态：调和时按 id 匹配既有节点。 */
export type RelationGraphNodeInput = { id: string; title: string; degree: number }

/**
 * 图数据变化时的节点调和：按 id 复用已存在节点对象（其坐标与速度随之保留），只增删节点，不整图重排。
 * 非首帧时新节点落到给定簇心，避免从原点飞入；首帧则交给力布局自行铺开。
 */
export function reconcileGraphNodes(
  previousNodes: readonly GraphNode[],
  incoming: readonly RelationGraphNodeInput[],
  resolveRadius: (degree: number) => number,
  seed: { x: number; y: number },
  isFirstLayout: boolean,
): GraphNode[] {
  const previousById = new Map(previousNodes.map(node => [node.id, node]))
  return incoming.map(node => {
    const existing = previousById.get(node.id)
    if (existing) {
      existing.title = node.title
      existing.degree = node.degree
      existing.radius = resolveRadius(node.degree)
      return existing
    }
    const created: GraphNode = {
      id: node.id,
      title: node.title,
      degree: node.degree,
      radius: resolveRadius(node.degree),
    }
    if (!isFirstLayout) {
      created.x = seed.x
      created.y = seed.y
    }
    return created
  })
}

type GraphLink = SimulationLinkDatum<GraphNode> & {
  /** 是否存在 source → target 的引用：决定在 target 端画箭头。 */
  sourceToTarget: boolean
  /** 是否存在 target → source 的引用：决定在 source 端画箭头。 */
  targetToSource: boolean
}

type PointTransform = { k: number; x: number; y: number }

type DragSubject = { node: GraphNode; x: number; y: number }

const LINK_DISTANCE = 70
const LINK_STRENGTH = 0.4
const DRAG_REHEAT_ALPHA = 0.3
/** 图数据变化（如查看半径切换）时的再加热强度：只温和收敛，避免整图重排瞬移。 */
const GRAPH_UPDATE_ALPHA = 0.3
const HIT_RADIUS_PADDING = 2
const COLLIDE_RADIUS_PADDING = 4
const ARROW_HEAD_LENGTH = 14
const ARROW_HEAD_WIDTH = 10

/**
 * 把一条引用边画成「线体自然收束成箭头」的一体成型形状（单个填充多边形）。
 * 线体保持 shaftWidth 宽，在带头的一端平滑张成 headWidth 并收束到端点，
 * 因此是一支完整箭头，而不是「描一条线 + 贴一个三角形」两块拼接。
 */
function drawArrowEdge(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  shaftWidth: number,
  headLength: number,
  headWidth: number,
  headAtStart: boolean,
  headAtEnd: boolean,
): void {
  const dx = endX - startX
  const dy = endY - startY
  const length = Math.hypot(dx, dy)
  if (length < 1e-3) return
  const ux = dx / length
  const uy = dy / length
  const px = -uy
  const py = ux
  const half = shaftWidth / 2
  const wing = headWidth / 2
  const head = Math.min(headLength, length * 0.45)

  const startBaseX = startX + ux * head
  const startBaseY = startY + uy * head
  const endBaseX = endX - ux * head
  const endBaseY = endY - uy * head

  ctx.beginPath()
  if (headAtStart) {
    // 从 start 端箭头尖起笔，张开左翼，再收到线体左沿。
    ctx.moveTo(startX, startY)
    ctx.lineTo(startBaseX + px * wing, startBaseY + py * wing)
    ctx.lineTo(startBaseX + px * half, startBaseY + py * half)
  } else {
    ctx.moveTo(startX + px * half, startY + py * half)
  }
  if (headAtEnd) {
    // 沿线体左沿到 end 端头基，张开左翼，收束到箭头尖，再沿右翼回线体。
    ctx.lineTo(endBaseX + px * half, endBaseY + py * half)
    ctx.lineTo(endBaseX + px * wing, endBaseY + py * wing)
    ctx.lineTo(endX, endY)
    ctx.lineTo(endBaseX - px * wing, endBaseY - py * wing)
    ctx.lineTo(endBaseX - px * half, endBaseY - py * half)
  } else {
    ctx.lineTo(endX + px * half, endY + py * half)
    ctx.lineTo(endX - px * half, endY - py * half)
  }
  if (headAtStart) {
    ctx.lineTo(startBaseX - px * half, startBaseY - py * half)
    ctx.lineTo(startBaseX - px * wing, startBaseY - py * wing)
  } else {
    ctx.lineTo(startX - px * half, startY - py * half)
  }
  ctx.closePath()
  ctx.fill()
}

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
  /** 节点半径最小值：孤立笔记取该值。 */
  minNodeRadius: number
  /** 节点半径最大值：连接数最多的笔记取该值。 */
  maxNodeRadius: number
  /** 连线粗细（画布线宽）。 */
  linkWidth: number
  /** 是否绘制引用方向箭头。 */
  showArrows: boolean
  /** 悬停时是否虚化其余节点：开启只保留该节点及其直接邻居，关闭则悬停不虚化。 */
  dimOnHover: boolean
  /** 需要特别高亮的节点：局部关系图用于标记关注笔记；缺省不高亮任何节点。 */
  highlightNodeId?: string | null
  /** 首次布局的初始缩放：局部关系图用于进入即拉近；缺省 1（不缩放）。 */
  initialScale?: number
  onOpenNode: (id: string) => void
}) {
  const { graph, chargeStrength, centerStrength, minNodeRadius, maxNodeRadius, linkWidth, showArrows, dimOnHover, highlightNodeId = null, initialScale = 1, onOpenNode } = props
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
    collide: ForceCollide<GraphNode>
  } | null>(null)
  const nodesRef = React.useRef<GraphNode[]>([])
  const linksRef = React.useRef<GraphLink[]>([])
  const neighborsRef = React.useRef<Map<string, Set<string>>>(new Map())
  const transformRef = React.useRef<PointTransform>({ k: 1, x: 0, y: 0 })
  const hoverRef = React.useRef<string | null>(null)
  const colorsRef = React.useRef({ primary: '#4b6fae', surface: '#ffffff', text: '#1d2430', edge: '#8a94a6' })
  const frameRef = React.useRef(0)
  // 半径区间与画布外观参数经 ref 传递，使参数调整不进入构建依赖（不重建图）。
  const radiusRef = React.useRef({ min: minNodeRadius, max: maxNodeRadius })
  const maxDegreeRef = React.useRef(0)
  const visualRef = React.useRef({ linkWidth, showArrows, dimOnHover })
  const highlightRef = React.useRef<string | null>(highlightNodeId)
  const scheduleDrawRef = React.useRef<() => void>(() => {})

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
    const { min: radiusMin, max: radiusMax } = radiusRef.current
    const resolveRadius = (degree: number) => nodeRadiusForDegree(degree, maxDegree, radiusMin, radiusMax)
    // 调和节点：复用已存在节点对象（坐标与速度随之保留），只增删节点，不整图重排。
    const previousNodes = nodesRef.current
    const nextIds = new Set(graph.nodes.map(node => node.id))
    const surviving = previousNodes.filter(node => nextIds.has(node.id))
    const isFirstLayout = previousNodes.length === 0
    const seed = surviving.length
      ? {
          x: surviving.reduce((sum, node) => sum + (node.x ?? 0), 0) / surviving.length,
          y: surviving.reduce((sum, node) => sum + (node.y ?? 0), 0) / surviving.length,
        }
      : { x: width / 2, y: height / 2 }
    const nodes = reconcileGraphNodes(previousNodes, graph.nodes, resolveRadius, seed, isFirstLayout)
    const links: GraphLink[] = graph.edges.map(edge => ({
      source: edge.source,
      target: edge.target,
      sourceToTarget: edge.sourceToTarget,
      targetToSource: edge.targetToSource,
    }))
    const neighbors = new Map<string, Set<string>>()
    for (const node of nodes) neighbors.set(node.id, new Set())
    for (const edge of graph.edges) {
      neighbors.get(edge.source)?.add(edge.target)
      neighbors.get(edge.target)?.add(edge.source)
    }
    nodesRef.current = nodes
    linksRef.current = links
    neighborsRef.current = neighbors
    maxDegreeRef.current = maxDegree
    // 视角（缩放与平移）跨图变化保留，不重置。
    hoverRef.current = null

    function draw() {
      const { primary, surface, text, edge } = colorsRef.current
      const { linkWidth, showArrows, dimOnHover } = visualRef.current
      const highlightId = highlightRef.current
      const transform = transformRef.current
      // 虚化开关关闭时，悬停不改变任何透明度；开启时只保留悬停节点与其直接邻居。
      const dimActive = dimOnHover ? hoverRef.current : null
      const activeNeighbors = dimActive ? neighborsRef.current.get(dimActive) : null

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      ctx.save()
      ctx.translate(transform.x, transform.y)
      ctx.scale(transform.k, transform.k)

      ctx.fillStyle = edge
      for (const link of linksRef.current) {
        const source = link.source as GraphNode
        const target = link.target as GraphNode
        const incident = !dimActive || source.id === dimActive || target.id === dimActive
        ctx.globalAlpha = dimActive ? (incident ? 0.9 : 0.06) : 0.5
        const sx = source.x ?? 0
        const sy = source.y ?? 0
        const tx = target.x ?? 0
        const ty = target.y ?? 0
        const dx = tx - sx
        const dy = ty - sy
        const distance = Math.hypot(dx, dy)
        if (distance < 1e-3) continue
        const ux = dx / distance
        const uy = dy / distance
        // 单向引用在目标端收束成箭头；双向引用两端都收束。不带头的一端藏进节点，避免端帽露缝。
        const headAtStart = showArrows && link.targetToSource
        const headAtEnd = showArrows && link.sourceToTarget
        const startX = headAtStart ? sx + ux * source.radius : sx
        const startY = headAtStart ? sy + uy * source.radius : sy
        const endX = headAtEnd ? tx - ux * target.radius : tx
        const endY = headAtEnd ? ty - uy * target.radius : ty
        drawArrowEdge(ctx, startX, startY, endX, endY, linkWidth, ARROW_HEAD_LENGTH, ARROW_HEAD_WIDTH, headAtStart, headAtEnd)
      }

      ctx.textBaseline = 'middle'
      ctx.font = '11px Inter, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif'
      for (const node of nodesRef.current) {
        const active = !dimActive || node.id === dimActive || (activeNeighbors ? activeNeighbors.has(node.id) : false)
        const x = node.x ?? 0
        const y = node.y ?? 0
        const isHighlighted = !!highlightId && node.id === highlightId
        const bodyAlpha = dimActive ? (active ? 1 : 0.15) : 1
        // 关注节点：更强光晕 + 更大 + 深色加重 + 高对比描边，比其余节点更重、更突出。
        if (isHighlighted) {
          ctx.globalAlpha = dimActive ? (active ? 0.45 : 0.08) : 0.38
          ctx.beginPath()
          ctx.arc(x, y, node.radius + 9, 0, Math.PI * 2)
          ctx.fillStyle = primary
          ctx.fill()
        }
        ctx.globalAlpha = bodyAlpha
        ctx.beginPath()
        ctx.arc(x, y, isHighlighted ? node.radius + 3 : node.radius, 0, Math.PI * 2)
        ctx.fillStyle = primary
        ctx.fill()
        if (isHighlighted) {
          // 叠一层深色，把关注节点压得更深、更饱和，明显比其余节点更重。
          ctx.globalAlpha = bodyAlpha * 0.46
          ctx.fillStyle = '#000000'
          ctx.fill()
          ctx.globalAlpha = bodyAlpha
        }
        ctx.lineWidth = isHighlighted ? 3 : 1.5
        ctx.strokeStyle = surface
        ctx.stroke()

        ctx.globalAlpha = dimActive ? (active ? 1 : 0.15) : 0.9
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
    scheduleDrawRef.current = scheduleDraw

    const simulation = forceSimulation<GraphNode>(nodes)
      .force('link', forceLink<GraphNode, GraphLink>(links).id(node => node.id).distance(LINK_DISTANCE).strength(LINK_STRENGTH))
      .force('charge', forceManyBody<GraphNode>().strength(chargeStrength))
      .force('x', forceX<GraphNode>(width / 2).strength(centerStrength))
      .force('y', forceY<GraphNode>(height / 2).strength(centerStrength))
      .force('collide', forceCollide<GraphNode>().radius(node => node.radius + COLLIDE_RADIUS_PADDING))
    // 首帧完整铺开；后续图变化只温和再加热，既有节点位置基本不动。
    if (!isFirstLayout) simulation.alpha(GRAPH_UPDATE_ALPHA)
    simulation.on('tick', scheduleDraw)

    simulationRef.current = simulation
    forcesRef.current = {
      charge: simulation.force('charge') as ForceManyBody<GraphNode>,
      x: simulation.force('x') as ForceX<GraphNode>,
      y: simulation.force('y') as ForceY<GraphNode>,
      collide: simulation.force('collide') as ForceCollide<GraphNode>,
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

    // 首次布局按初始缩放拉近，并同步 d3-zoom 的内部变换，保证后续手势从同一视角继续。
    if (isFirstLayout && initialScale !== 1) {
      const k = initialScale
      const x = (width / 2) * (1 - k)
      const y = (height / 2) * (1 - k)
      transformRef.current = { k, x, y }
      select(canvas).property('__zoom', zoomIdentity.translate(x, y).scale(k))
    }

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
      scheduleDrawRef.current = () => {}
    }
  }, [graph, size.height, size.width])

  // 布局参数只调整力强度与节点半径并重加热，不重建图形，保留缩放与节点位置。
  React.useEffect(() => {
    const forces = forcesRef.current
    const simulation = simulationRef.current
    if (!forces || !simulation) return
    forces.charge.strength(chargeStrength)
    forces.x.strength(centerStrength)
    forces.y.strength(centerStrength)
    radiusRef.current = { min: minNodeRadius, max: maxNodeRadius }
    const maxDegree = maxDegreeRef.current
    for (const node of nodesRef.current) {
      node.radius = nodeRadiusForDegree(node.degree, maxDegree, minNodeRadius, maxNodeRadius)
    }
    forces.collide.radius(node => node.radius + COLLIDE_RADIUS_PADDING)
    simulation.alpha(0.5).restart()
  }, [chargeStrength, centerStrength, minNodeRadius, maxNodeRadius])

  // 外观参数（连线粗细、箭头显示、悬停虚化、关注节点高亮）只改绘制，不触发布局、不重建图形。
  React.useEffect(() => {
    visualRef.current = { linkWidth, showArrows, dimOnHover }
    highlightRef.current = highlightNodeId
    scheduleDrawRef.current()
  }, [dimOnHover, highlightNodeId, linkWidth, showArrows])

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} style={{ display: 'block', cursor: 'grab' }} />
    </div>
  )
}
