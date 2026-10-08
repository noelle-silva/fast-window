import type { NoteMeta } from './core'
import type { NoteRefIndex } from './noteRefs'

// 全局关系图的数据构建：节点取自笔记索引（全部笔记，含无引用的孤立笔记），
// 边取自引用索引（笔记之间的引用关系）。纯数据推导，不依赖 React 与渲染层。

export type GlobalGraphNode = {
  id: string
  title: string
  /** 连接数：与该笔记直接相连的邻居数量，决定节点大小。 */
  degree: number
}

export type GlobalGraphEdge = {
  source: string
  target: string
}

export type GlobalRelationGraph = {
  nodes: GlobalGraphNode[]
  edges: GlobalGraphEdge[]
}

const MIN_NODE_RADIUS = 6
const MAX_NODE_RADIUS = 22

/**
 * 由笔记索引与引用索引推导全局关系图。
 * - 节点：笔记索引中的全部笔记（含没有任何引用的孤立笔记）。
 * - 边：引用索引展开后的无向关系，按笔记对去重；自引用与指向不存在笔记的引用一律忽略。
 */
export function buildGlobalRelationGraph(
  notes: NoteMeta[] | null | undefined,
  refIndex: NoteRefIndex | null | undefined,
): GlobalRelationGraph {
  const nodes: GlobalGraphNode[] = []
  const nodeIds = new Set<string>()
  for (const note of notes || []) {
    const id = String(note?.id || '').trim()
    if (!id || nodeIds.has(id)) continue
    nodeIds.add(id)
    nodes.push({ id, title: String(note?.title || '').trim() || id, degree: 0 })
  }

  const adjacency = new Map<string, Set<string>>()
  for (const id of nodeIds) adjacency.set(id, new Set())

  const edges: GlobalGraphEdge[] = []
  const edgeKeys = new Set<string>()
  for (const [sourceRaw, faces] of Object.entries(refIndex || {})) {
    const source = String(sourceRaw || '').trim()
    if (!nodeIds.has(source)) continue
    for (const refs of Object.values(faces || {})) {
      for (const ref of refs || []) {
        const target = String(ref?.noteId || '').trim()
        if (!target || target === source || !nodeIds.has(target)) continue
        const key = source < target ? `${source}\u0000${target}` : `${target}\u0000${source}`
        if (edgeKeys.has(key)) continue
        edgeKeys.add(key)
        edges.push({ source, target })
        adjacency.get(source)!.add(target)
        adjacency.get(target)!.add(source)
      }
    }
  }

  for (const node of nodes) node.degree = adjacency.get(node.id)?.size || 0
  return { nodes, edges }
}

/** 图的最高连接数，供节点大小归一化。 */
export function maxDegreeOf(graph: GlobalRelationGraph): number {
  return graph.nodes.reduce((max, node) => Math.max(max, node.degree), 0)
}

/** 连接数映射到节点半径：面积感缩放（开方），孤立笔记保留最小半径。 */
export function nodeRadiusForDegree(degree: number, maxDegree: number): number {
  if (maxDegree <= 0) return MIN_NODE_RADIUS
  const ratio = Math.max(0, Math.min(1, degree / maxDegree))
  return MIN_NODE_RADIUS + (MAX_NODE_RADIUS - MIN_NODE_RADIUS) * Math.sqrt(ratio)
}
