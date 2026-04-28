import type { CollectionFolderNode, CollectionItemNode, CollectionNode, CollectionsDoc } from './types'

export function makeId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function ensureCollections(saved: unknown, nowMs = Date.now()): CollectionsDoc {
  const rootId = 'root'
  const empty: CollectionsDoc = {
    version: 1,
    rootId,
    nodes: {
      [rootId]: { id: rootId, type: 'folder', name: '收藏夹', children: [], createdAt: nowMs, updatedAt: nowMs },
    },
  }
  const doc = saved && typeof saved === 'object' ? (saved as CollectionsDoc) : null
  if (!doc || !doc.nodes || typeof doc.nodes !== 'object') return empty
  if (!doc.rootId || !doc.nodes[doc.rootId]) return empty
  const root = doc.nodes[doc.rootId]
  if (!root || root.type !== 'folder' || !Array.isArray(root.children)) return empty
  return { ...empty, ...doc }
}

export function getNode(doc: CollectionsDoc | null | undefined, id: string): CollectionNode | null {
  return doc?.nodes?.[id] || null
}

export function isFolder(doc: CollectionsDoc | null | undefined, id: string): boolean {
  const n = getNode(doc, id)
  return !!n && n.type === 'folder'
}

export function buildParentMap(doc: CollectionsDoc | null | undefined): Map<string, string> {
  const map = new Map<string, string>()
  const nodes = doc?.nodes || {}
  for (const id of Object.keys(nodes)) {
    const n = nodes[id]
    if (!n || n.type !== 'folder' || !Array.isArray(n.children)) continue
    for (const childId of n.children) map.set(childId, id)
  }
  return map
}

export function buildPathIds(doc: CollectionsDoc | null | undefined, folderId: string): string[] {
  const rootId = doc?.rootId || 'root'
  const parent = buildParentMap(doc)
  const path: string[] = []
  let cur = folderId
  while (cur) {
    path.push(cur)
    if (cur === rootId) break
    cur = parent.get(cur) || ''
  }
  return path.reverse()
}

export function folderLabelById(doc: CollectionsDoc | null | undefined, folderId: string): string {
  const path = buildPathIds(doc, folderId)
  const parts = path
    .map((id) => getNode(doc, id))
    .filter(Boolean)
    .map((n) => (n && n.type === 'folder' ? n.name : ''))
    .filter(Boolean)
  return parts.join(' / ') || '收藏夹'
}

export function canMoveInto(doc: CollectionsDoc | null | undefined, targetFolderId: string, movingId: string): boolean {
  if (!isFolder(doc, targetFolderId)) return false
  if (targetFolderId === movingId) return false
  const parent = buildParentMap(doc)
  let cur = targetFolderId
  while (cur) {
    if (cur === movingId) return false
    cur = parent.get(cur) || ''
  }
  return true
}

export function removeChild(doc: CollectionsDoc | null | undefined, parentId: string, childId: string, nowMs = Date.now()): void {
  const p = getNode(doc, parentId)
  if (!p || p.type !== 'folder') return
  p.children = (p.children || []).filter((id) => id !== childId)
  p.updatedAt = nowMs
}

export function insertChild(doc: CollectionsDoc | null | undefined, parentId: string, childId: string, index?: number, nowMs = Date.now()): void {
  const p = getNode(doc, parentId)
  if (!p || p.type !== 'folder') return
  const next = (p.children || []).filter((id) => id !== childId)
  const at = Math.max(0, Math.min(next.length, Number.isFinite(index) ? Number(index) : next.length))
  next.splice(at, 0, childId)
  p.children = next
  p.updatedAt = nowMs
}

export function findParentId(doc: CollectionsDoc | null | undefined, childId: string): string | null {
  return buildParentMap(doc).get(childId) || null
}

export function moveNode(doc: CollectionsDoc | null | undefined, movingId: string, toParentId: string, toIndex?: number): boolean {
  if (!doc) return false
  if (!canMoveInto(doc, toParentId, movingId)) return false
  const fromParentId = findParentId(doc, movingId)
  if (!fromParentId) return false
  removeChild(doc, fromParentId, movingId)
  insertChild(doc, toParentId, movingId, toIndex)
  return true
}

export function deleteNodeRecursive(doc: CollectionsDoc | null | undefined, nodeId: string): void {
  const n = getNode(doc, nodeId)
  if (!n || !doc) return
  if (n.type === 'folder') {
    for (const childId of [...(n.children || [])]) deleteNodeRecursive(doc, childId)
  }
  delete doc.nodes[nodeId]
}

export function deleteNode(doc: CollectionsDoc | null | undefined, nodeId: string): boolean {
  if (!doc || !nodeId || nodeId === doc.rootId) return false
  const parentId = findParentId(doc, nodeId)
  if (parentId) removeChild(doc, parentId, nodeId)
  deleteNodeRecursive(doc, nodeId)
  return true
}

export function createFolder(doc: CollectionsDoc | null | undefined, parentId: string, name: string, nowMs = Date.now()): string {
  if (!doc || !isFolder(doc, parentId)) return ''
  const folderId = makeId()
  const safeName = (name || '').trim() || '未命名收藏夹'
  doc.nodes[folderId] = { id: folderId, type: 'folder', name: safeName, children: [], createdAt: nowMs, updatedAt: nowMs }
  insertChild(doc, parentId, folderId, undefined, nowMs)
  return folderId
}

export function createItem(doc: CollectionsDoc | null | undefined, parentId: string, title: string, content: string, nowMs = Date.now()): string {
  if (!doc || !isFolder(doc, parentId)) return ''
  const safeContent = (content || '').trim()
  if (!safeContent) return ''
  const itemId = makeId()
  const safeTitle = (title || '').trim() || safeContent.split(/\r?\n/)[0].slice(0, 24) || '未命名条目'
  doc.nodes[itemId] = { id: itemId, type: 'item', title: safeTitle, content: safeContent, createdAt: nowMs, updatedAt: nowMs }
  insertChild(doc, parentId, itemId, undefined, nowMs)
  return itemId
}

export function updateFolderName(doc: CollectionsDoc | null | undefined, folderId: string, name: string, nowMs = Date.now()): boolean {
  const f = getNode(doc, folderId)
  if (!f || f.type !== 'folder') return false
  f.name = (name || '').trim() || '未命名收藏夹'
  f.updatedAt = nowMs
  return true
}

export function updateItem(doc: CollectionsDoc | null | undefined, itemId: string, title: string, content: string, nowMs = Date.now()): boolean {
  const it = getNode(doc, itemId)
  if (!it || it.type !== 'item') return false
  const safeContent = (content || '').trim()
  if (!safeContent) return false
  it.title = (title || '').trim() || safeContent.split(/\r?\n/)[0].slice(0, 24) || '未命名条目'
  it.content = safeContent
  it.updatedAt = nowMs
  return true
}

export function listChildren(doc: CollectionsDoc | null | undefined, folderId: string): CollectionNode[] {
  const f = getNode(doc, folderId)
  if (!f || f.type !== 'folder') return []
  return (f.children || []).map((id) => getNode(doc, id)).filter(Boolean) as CollectionNode[]
}

export function traverseItemsUnder(doc: CollectionsDoc | null | undefined, folderId: string): CollectionItemNode[] {
  const res: CollectionItemNode[] = []
  const stack = [folderId]
  while (stack.length) {
    const id = stack.pop() || ''
    const n = getNode(doc, id)
    if (!n) continue
    if (n.type === 'item') {
      res.push(n)
      continue
    }
    if (n.type === 'folder') {
      for (const childId of [...(n.children || [])].reverse()) stack.push(childId)
    }
  }
  return res
}

export function searchItems(doc: CollectionsDoc | null | undefined, query: string, scope: string, currentFolderId: string) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return []
  const parent = buildParentMap(doc)
  const baseId = scope === 'global' ? doc?.rootId || 'root' : currentFolderId
  const items = traverseItemsUnder(doc, baseId).filter((it) => {
    const c = String(it.content || '').toLowerCase()
    const t = String(it.title || '').toLowerCase()
    return c.includes(q) || t.includes(q)
  })
  return items.map((item) => {
    const folderId = parent.get(item.id) || doc?.rootId || 'root'
    const path = buildPathIds(doc, folderId)
      .map((id) => getNode(doc, id))
      .filter(Boolean)
      .map((n) => (n && n.type === 'folder' ? n.name : ''))
      .filter(Boolean)
      .join(' / ')
    return { item, folderId, path }
  })
}
