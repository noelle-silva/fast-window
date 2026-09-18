import { chatMessageMaterialKind, isSystemControlMessage } from '../../domain/message'
import { messageVisibleText } from '../../domain/chatMessageDisplay'
import { snippetText } from '../utils/text'

export type ChatTreeNodeRole = 'user' | 'assistant' | 'system'

export function normalizeChatTreeNodeRole(role: unknown): ChatTreeNodeRole {
  const value = String(role || '').trim()
  if (value === 'assistant') return 'assistant'
  if (value === 'system') return 'system'
  return 'user'
}

export function svgSafeId(raw: any) {
  const s0 = typeof raw === 'string' ? raw : String(raw ?? '')
  const s = s0.trim()
  if (!s) return 'x'
  return s.replace(/[^a-zA-Z0-9\-_:.]/g, '_').slice(0, 80) || 'x'
}

export function buildChatTreeLayout(messagesRaw: any[], opts?: { maxNodes?: number }) {
  const maxNodes = Math.max(50, Math.min(2000, Math.floor(Number(opts?.maxNodes ?? 600))))
  const msgs = Array.isArray(messagesRaw) ? messagesRaw : []
  const items0 = msgs
    .map((m: any) => {
      const id = String(m?.id || '').trim()
      if (!id) return null
      const materialKind = chatMessageMaterialKind(m)
      const isAssistantSide = materialKind === 'assistant' || materialKind === 'async_tool_result'
      const role: ChatTreeNodeRole = isSystemControlMessage(m) || materialKind === 'system' ? 'system' : isAssistantSide ? 'assistant' : 'user'
      const controlKind = String(m?.control?.kind || '').trim()
      const content = role === 'system'
        ? controlKind === 'compression_summary'
          ? '上下文摘要'
          : controlKind === 'compression_boundary'
            ? '压缩边界'
            : messageVisibleText(m) || '系统记录'
        : messageVisibleText(m)
      const parentMid = String((m as any)?.parentMid || '').trim()
      const createdAt = Number(m?.createdAt || 0)
      const branchId = String((m as any)?.branchId || '').trim()
      const groupRole = String((m as any)?.groupRole || '').trim()
      if (groupRole === 'attachment') return null
      return { id, role, content, parentMid, createdAt, branchId, groupRole }
    })
    .filter(Boolean) as any[]

  if (items0.length > maxNodes) {
    items0.sort((a: any, b: any) => {
      const da = Number(a?.createdAt || 0)
      const db = Number(b?.createdAt || 0)
      if (da !== db) return da - db
      return String(a?.id || '').localeCompare(String(b?.id || ''))
    })
    items0.splice(0, Math.max(0, items0.length - maxNodes))
  }

  const byId = new Map<string, any>()
  for (const it of items0) byId.set(String(it.id), it)

  const nodes = items0.map((it: any) => {
    const pid = String(it.parentMid || '').trim()
    const parentId = pid && byId.has(pid) ? pid : ''
    return {
      id: String(it.id),
      parentId,
      role: it.role,
      branchId: String(it.branchId || ''),
      createdAt: Number(it.createdAt || 0),
      text: snippetText(it.content, 16),
      kind: 'message',
    }
  })

  const children = new Map<string, string[]>()
  for (const n of nodes) {
    if (!n.parentId) continue
    const list = children.get(n.parentId) || []
    list.push(n.id)
    children.set(n.parentId, list)
  }

  const sortIds = (ids: string[]) =>
    ids.sort((a: string, b: string) => {
      const na = byId.get(a)
      const nb = byId.get(b)
      const da = Number(na?.createdAt || 0)
      const db = Number(nb?.createdAt || 0)
      if (da !== db) return da - db
      return String(a).localeCompare(String(b))
    })

  for (const [k, list] of children.entries()) children.set(k, sortIds(list))

  const roots = nodes
    .filter((n) => !n.parentId)
    .map((n) => n.id)
    .sort((a: string, b: string) => {
      const na = byId.get(a)
      const nb = byId.get(b)
      const da = Number(na?.createdAt || 0)
      const db = Number(nb?.createdAt || 0)
      if (da !== db) return da - db
      return String(a).localeCompare(String(b))
    })

  const pos = new Map<string, { depth: number; y: number }>()
  const seen = new Set<string>()
  let nextY = 0

  const layout = (id: string, depth: number) => {
    if (!id) return
    if (seen.has(id)) return
    seen.add(id)
    const kids = children.get(id) || []
    for (const c of kids) layout(c, depth + 1)
    if (!kids.length) {
      pos.set(id, { depth, y: nextY })
      nextY += 1
      return
    }
    const ys = kids.map((c) => pos.get(c)?.y).filter((x: any) => typeof x === 'number') as number[]
    if (!ys.length) {
      pos.set(id, { depth, y: nextY })
      nextY += 1
      return
    }
    const y = (ys[0] + ys[ys.length - 1]) / 2
    pos.set(id, { depth, y })
  }

  for (const r of roots) {
    layout(r, 0)
    nextY += 0.8
  }

  const nodeW = 168
  const nodeH = 44
  const gapX = 120
  const gapY = 70
  const pad = 22

  const laidNodes = nodes
    .map((n) => {
      const p = pos.get(n.id)
      if (!p) return null
      return { ...n, depth: Number(p.depth || 0), lane: Number(p.y || 0) }
    })
    .filter(Boolean) as any[]

  let maxDepth = 0
  let maxLane = 0
  for (const n of laidNodes) {
    maxDepth = Math.max(maxDepth, Math.floor(Number(n.depth || 0)))
    maxLane = Math.max(maxLane, Number(n.lane || 0))
  }

  const edges = laidNodes
    .filter((n) => !!n.parentId && pos.has(n.parentId))
    .map((n) => ({ from: n.parentId, to: n.id }))

  return { nodes: laidNodes, edges, byId, roots, nodeW, nodeH, gapX, gapY, pad, maxDepth, maxLane }
}
