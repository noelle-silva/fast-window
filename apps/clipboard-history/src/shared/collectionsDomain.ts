import type { CollectionFolderNode, CollectionImageContent, CollectionItemContent, CollectionItemNode, CollectionNode, CollectionsDoc } from './types'

export function makeId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function ensureCollections(saved: unknown, nowMs = Date.now()): CollectionsDoc {
  const rootId = 'root'
  const empty: CollectionsDoc = {
    version: 2,
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
  return normalizeCollectionsDoc({ ...empty, ...doc }, nowMs)
}

function normalizeCollectionsDoc(doc: CollectionsDoc, nowMs = Date.now()): CollectionsDoc {
  const nodes: Record<string, CollectionNode> = {}
  for (const [id, node] of Object.entries(doc.nodes || {})) {
    if (!node || typeof node !== 'object') continue
    if (node.type === 'folder') {
      nodes[id] = {
        id: String(node.id || id),
        type: 'folder',
        name: String(node.name || '').trim() || '未命名收藏夹',
        children: Array.isArray(node.children) ? node.children.filter((childId): childId is string => typeof childId === 'string') : [],
        createdAt: normalizeTime(node.createdAt, nowMs),
        updatedAt: normalizeTime(node.updatedAt, nowMs),
      }
      continue
    }
    if (node.type === 'item') {
      const content = normalizeItemContent((node as any).content)
      if (!content) continue
      nodes[id] = {
        id: String(node.id || id),
        type: 'item',
        title: String((node as any).title || '').trim() || itemTitleSource(content).slice(0, 24) || '未命名条目',
        content,
        createdAt: normalizeTime((node as any).createdAt, nowMs),
        updatedAt: normalizeTime((node as any).updatedAt, nowMs),
      }
    }
  }
  return { version: 2, rootId: doc.rootId || 'root', nodes }
}

function normalizeTime(raw: unknown, fallback: number): number {
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

export function normalizeItemContent(raw: unknown): CollectionItemContent | null {
  if (typeof raw === 'string') {
    const text = raw.trim()
    return text ? { type: 'text', text } : null
  }
  const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
  if (!obj) return null
  if (obj.type === 'image') {
    const reference = String(obj.reference || '').trim()
    const path = String(obj.path || '').trim()
    const width = Math.max(0, Math.floor(Number(obj.width) || 0))
    const height = Math.max(0, Math.floor(Number(obj.height) || 0))
    if ((!reference && !path) || width <= 0 || height <= 0) return null
    const sourceName = String(obj.sourceName || '').trim()
    return {
      type: 'image',
      reference,
      path,
      mime: String(obj.mime || '').trim().startsWith('image/') ? String(obj.mime).trim() : 'image/png',
      width,
      height,
      ...(sourceName ? { sourceName } : null),
    }
  }
  const text = String(obj.text || '').trim()
  return text ? { type: 'text', text } : null
}

export function isImageContent(content: CollectionItemContent | null | undefined): content is CollectionImageContent {
  return !!content && content.type === 'image'
}

export function itemText(content: CollectionItemContent | null | undefined): string {
  if (!content) return ''
  return content.type === 'text' ? content.text : content.sourceName || '图片收藏'
}

export function itemTitleSource(content: CollectionItemContent | null | undefined): string {
  if (!content) return ''
  return content.type === 'text' ? content.text : content.sourceName || '图片收藏'
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

export function createItem(doc: CollectionsDoc | null | undefined, parentId: string, title: string, content: CollectionItemContent, nowMs = Date.now()): string {
  if (!doc || !isFolder(doc, parentId)) return ''
  const safeContent = normalizeItemContent(content)
  if (!safeContent) return ''
  const itemId = makeId()
  const safeTitle = (title || '').trim() || itemTitleSource(safeContent).split(/\r?\n/)[0].slice(0, 24) || '未命名条目'
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

export function updateItem(doc: CollectionsDoc | null | undefined, itemId: string, title: string, content: CollectionItemContent, nowMs = Date.now()): boolean {
  const it = getNode(doc, itemId)
  if (!it || it.type !== 'item') return false
  const safeContent = normalizeItemContent(content)
  if (!safeContent) return false
  it.title = (title || '').trim() || itemTitleSource(safeContent).split(/\r?\n/)[0].slice(0, 24) || '未命名条目'
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
    const c = itemText(it.content).toLowerCase()
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
