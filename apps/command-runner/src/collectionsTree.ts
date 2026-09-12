import type { CollectionNode } from './types'

export type CollectionNodes = Record<string, CollectionNode>

export function collectionParentId(nodes: CollectionNodes, nodeId: string): string | null {
  for (const node of Object.values(nodes)) {
    if (node.children.includes(nodeId)) return node.id
  }
  return null
}

// collectionSubtreeFolderIds 返回以 folderId 为根的子树内全部收藏夹 id（含自身）。
export function collectionSubtreeFolderIds(nodes: CollectionNodes, folderId: string): Set<string> {
  const result = new Set<string>()
  const stack = [folderId]
  while (stack.length > 0) {
    const current = stack.pop() as string
    if (result.has(current)) continue
    const node = nodes[current]
    if (!node) continue
    result.add(current)
    for (const childId of node.children) {
      if (nodes[childId]) stack.push(childId)
    }
  }
  return result
}

// moveCollectionNode 与后端同语义：先把节点从原位置移除，再插入目标数组的 index 位置（index < 0 = 末尾）。
export function moveCollectionNode(
  nodes: CollectionNodes,
  nodeId: string,
  targetFolderId: string,
  index: number,
): CollectionNodes {
  const sourceId = collectionParentId(nodes, nodeId)
  if (!sourceId) return nodes
  const source = nodes[sourceId]
  const target = nodes[targetFolderId]
  if (!source || !target) return nodes
  if (nodes[nodeId] && collectionSubtreeFolderIds(nodes, nodeId).has(targetFolderId)) return nodes

  const sourceChildren = source.children.filter(id => id !== nodeId)
  const targetBase = sourceId === targetFolderId ? sourceChildren : target.children.filter(id => id !== nodeId)
  const at = index < 0 || index > targetBase.length ? targetBase.length : index
  const targetChildren = [...targetBase.slice(0, at), nodeId, ...targetBase.slice(at)]

  const next: CollectionNodes = { ...nodes }
  if (sourceId !== targetFolderId) {
    next[sourceId] = { ...source, children: sourceChildren }
  }
  next[targetFolderId] = { ...target, children: targetChildren }
  return next
}

// selectRepoCollections 取出属于某仓库的收藏夹节点（含其隐式根节点）。
export function selectRepoCollections(nodes: CollectionNodes, repoId: string): CollectionNodes {
  const result: CollectionNodes = {}
  for (const node of Object.values(nodes)) {
    if (node.repoId === repoId) result[node.id] = node
  }
  return result
}

// collectionPathIds 返回从仓库根到 folderId 的路径链（含两端）；数据异常时截止到可达的最上层。
export function collectionPathIds(nodes: CollectionNodes, rootId: string, folderId: string): string[] {
  const path: string[] = []
  const seen = new Set<string>()
  let current = folderId
  while (current && !seen.has(current)) {
    seen.add(current)
    path.push(current)
    if (current === rootId) break
    current = collectionParentId(nodes, current) || ''
  }
  if (path[path.length - 1] !== rootId && nodes[rootId]) path.push(rootId)
  return path.reverse()
}
