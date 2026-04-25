import { type HyperCortexFavoritesDocV1, type FavoriteItemRef } from './favorites'

export type FolderRefEdge = {
  from: string
  to: string
}

function isFolderRef(ref: FavoriteItemRef): ref is FavoriteItemRef & { kind: 'folder' } {
  return ref.kind === 'folder'
}

function buildAdjacency(edges: FolderRefEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>()

  for (const edge of edges) {
    const list = adj.get(edge.from)
    if (list) list.push(edge.to)
    else adj.set(edge.from, [edge.to])
  }

  return adj
}

function isReachableInAdj(adjacency: Map<string, string[]>, fromId: string, toId: string): boolean {
  if (fromId === toId) return true

  const visited = new Set<string>()
  const stack: string[] = [fromId]

  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === toId) return true
    if (visited.has(current)) continue
    visited.add(current)

    const nexts = adjacency.get(current)
    if (!nexts) continue
    for (const next of nexts) {
      if (!visited.has(next)) stack.push(next)
    }
  }

  return false
}

export function collectFolderRefEdges(doc: HyperCortexFavoritesDocV1): FolderRefEdge[] {
  const edges: FolderRefEdge[] = []

  for (const [folderId, refs] of Object.entries(doc.refsByFolderId)) {
    for (const ref of refs) {
      if (!isFolderRef(ref)) continue
      const from = ref.folderId ?? folderId
      const to = ref.targetId
      if (!from || !to) continue
      edges.push({ from, to })
    }
  }

  return edges
}

export function detectCycle(edges: FolderRefEdge[], fromId: string, toId: string): boolean {
  if (fromId === toId) return true

  const adjacency = buildAdjacency(edges)
  const list = adjacency.get(fromId)
  if (list) list.push(toId)
  else adjacency.set(fromId, [toId])

  return isReachableInAdj(adjacency, toId, fromId)
}

export function isReachable(edges: FolderRefEdge[], fromId: string, toId: string): boolean {
  const adjacency = buildAdjacency(edges)
  return isReachableInAdj(adjacency, fromId, toId)
}

