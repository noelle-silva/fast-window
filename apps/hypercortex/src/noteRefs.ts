import { parseNotePlaceholderBody } from './notePlaceholder'

const NOTE_PLACEHOLDER_PATTERN = /\[\[([^\]\n]+?)\]\]/g

export type NoteRef = {
  noteId: string
  faceId?: string
}

export type NoteRefIndex = Record<string, Record<string, NoteRef[]>>

export type NoteRefEntryMap = Record<string, NoteRef[]>

export type NoteBacklinkRef = {
  noteId: string
  faceId?: string
  fromFaceId?: string
}

// 引用关系查询（refs.queryRelations）的请求方向与结果类型，与后端结构对齐。
export type NoteRefRelationDirection = 'both' | 'outgoing' | 'incoming'

export type NoteRefRelationNode = {
  noteId: string
  distance: number
}

export type NoteRefRelationEdge = {
  fromNoteId: string
  fromFaceId?: string
  toNoteId: string
  toFaceId?: string
}

export type NoteRefRelationResult = {
  nodes: NoteRefRelationNode[]
  edges: NoteRefRelationEdge[]
}

/**
 * 纯语法解析：从文本提取系统引用占位符（按 noteId+faceId 去重）。
 * 不感知任何面语言的代码区域；代码区域遮蔽由各面插件的 extractRefs 实现自行完成。
 */
export function extractRefsFromText(body: string): NoteRef[] {
  const byKey = new Map<string, NoteRef>()
  for (const match of String(body || '').matchAll(NOTE_PLACEHOLDER_PATTERN)) {
    const inner = String(match?.[1] || '').trim()
    const parsed = parseNotePlaceholderBody(inner)
    if (!parsed) continue
    const noteId = String(parsed.noteId || '').trim()
    if (!noteId) continue
    const faceId = String(parsed.face || '').trim() || undefined
    byKey.set(`${noteId}\u0000${faceId || ''}`, { noteId, faceId })
  }
  return Array.from(byKey.values())
}

// 反向引用视图：全部由后端关系查询结果（引用边）推导，前端不再自算全表。

/**
 * 把关系查询返回的真实引用边还原为引用索引（来源笔记 → 来源面 → 目标引用），
 * 供关系图等消费方复用与全局关系图同源的图构建逻辑。
 */
export function refIndexFromRelations(edges: NoteRefRelationEdge[] | null | undefined): NoteRefIndex {
  const index: NoteRefIndex = {}
  for (const edge of edges || []) {
    const from = String(edge?.fromNoteId || '').trim()
    const to = String(edge?.toNoteId || '').trim()
    if (!from || !to) continue
    const fromFace = String(edge?.fromFaceId || '').trim()
    const faces = index[from] ?? (index[from] = {})
    const refs = faces[fromFace] ?? (faces[fromFace] = [])
    refs.push({ noteId: to, faceId: String(edge?.toFaceId || '').trim() || undefined })
  }
  return index
}

export function backlinksFromRelations(edges: NoteRefRelationEdge[], noteId: string): NoteBacklinkRef[] {
  const id = String(noteId || '').trim()
  if (!id) return []

  const byFrom = new Map<string, NoteBacklinkRef>()
  for (const edge of edges || []) {
    const from = String(edge?.fromNoteId || '').trim()
    if (!from || String(edge?.toNoteId || '').trim() !== id) continue
    const existing = byFrom.get(from)
    if (existing && !existing.faceId) continue
    const fromFaceId = String(edge?.fromFaceId || '').trim() || undefined
    const toFaceId = String(edge?.toFaceId || '').trim()
    if (!toFaceId) {
      byFrom.set(from, { noteId: from, fromFaceId })
      continue
    }
    if (!existing) byFrom.set(from, { noteId: from, faceId: toFaceId, fromFaceId })
  }
  return Array.from(byFrom.values())
}

export function faceBacklinksFromRelations(edges: NoteRefRelationEdge[], noteId: string, faceId: string): NoteBacklinkRef[] {
  const id = String(noteId || '').trim()
  const targetFace = String(faceId || '').trim()
  if (!id || !targetFace) return []

  const byFrom = new Map<string, NoteBacklinkRef>()
  for (const edge of edges || []) {
    const from = String(edge?.fromNoteId || '').trim()
    if (!from || String(edge?.toNoteId || '').trim() !== id) continue
    if (String(edge?.toFaceId || '').trim() !== targetFace) continue
    byFrom.set(from, { noteId: from, faceId: targetFace, fromFaceId: String(edge?.fromFaceId || '').trim() || undefined })
  }
  return Array.from(byFrom.values())
}

export function isBacklinkStaleFromRelations(
  edges: NoteRefRelationEdge[],
  targetNoteId: string,
  fromNoteId: string,
  faceExists: (faceId: string) => boolean,
): boolean {
  const targetId = String(targetNoteId || '').trim()
  const from = String(fromNoteId || '').trim()
  if (!targetId || !from) return false

  let matchedAny = false
  for (const edge of edges || []) {
    if (String(edge?.fromNoteId || '').trim() !== from) continue
    if (String(edge?.toNoteId || '').trim() !== targetId) continue
    matchedAny = true
    const toFaceId = String(edge?.toFaceId || '').trim()
    if (!toFaceId || faceExists(toFaceId)) return false
  }
  return matchedAny
}
