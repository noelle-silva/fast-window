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

function maskFencedCodeBlocks(body: string): string {
  const src = String(body || '')
  const chars = src.split('')
  const openRe = /(^|\n)[ \t]{0,3}```/g

  while (true) {
    const m = openRe.exec(src)
    if (!m) break

    const openAt = m.index + m[1].length
    const closeRe = /(^|\n)[ \t]{0,3}```/g
    closeRe.lastIndex = openAt + 3
    const close = closeRe.exec(src)

    let end = src.length
    if (close) {
      const closeAt = close.index + close[1].length
      const lineEnd = src.indexOf('\n', closeAt + 3)
      end = lineEnd >= 0 ? lineEnd + 1 : src.length
    }

    for (let i = openAt; i < end; i++) chars[i] = ' '
    openRe.lastIndex = end
  }

  return chars.join('')
}

function maskInlineCodeSpans(body: string): string {
  const src = String(body || '')
  const chars = src.split('')

  let i = 0
  while (i < src.length) {
    if (src[i] !== '`') {
      i++
      continue
    }
    let j = i
    while (j < src.length && src[j] === '`') j++
    const fence = src.slice(i, j)
    const closeAt = src.indexOf(fence, j)
    if (closeAt < 0) {
      i = j
      continue
    }
    const end = closeAt + fence.length
    for (let p = i; p < end; p++) chars[p] = ' '
    i = end
  }

  return chars.join('')
}

function maskCode(body: string): string {
  return maskInlineCodeSpans(maskFencedCodeBlocks(body))
}

function parseNoteRefsFromText(body: string): NoteRef[] {
  const text = maskCode(body)
  const byKey = new Map<string, NoteRef>()

  for (const match of text.matchAll(NOTE_PLACEHOLDER_PATTERN)) {
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

export function extractNoteRefs(body: string): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const ref of parseNoteRefsFromText(body)) {
    if (seen.has(ref.noteId)) continue
    seen.add(ref.noteId)
    ids.push(ref.noteId)
  }
  return ids
}

function* traverseBacklinkSources(
  index: NoteRefIndex,
  match: (ref: NoteRef) => boolean,
): Generator<{ from: string; fromFaceId?: string; ref: NoteRef }> {
  for (const [from, faces] of Object.entries(index || {})) {
    if (!faces || typeof faces !== 'object') continue
    for (const [fromFace, refs] of Object.entries(faces)) {
      if (!Array.isArray(refs)) continue
      for (const ref of refs) {
        if (!ref || !match(ref)) continue
        yield { from, fromFaceId: String(fromFace || '').trim() || undefined, ref }
      }
    }
  }
}

export function getBacklinksFor(index: NoteRefIndex, noteId: string): NoteBacklinkRef[] {
  const id = String(noteId || '').trim()
  if (!id) return []

  const byFrom = new Map<string, NoteBacklinkRef>()
  for (const { from, fromFaceId, ref } of traverseBacklinkSources(index, ref => String(ref.noteId || '').trim() === id)) {
    const existing = byFrom.get(from)
    if (existing && !existing.faceId) continue
    const refFace = String(ref.faceId || '').trim()
    if (!refFace) {
      byFrom.set(from, { noteId: from, fromFaceId })
      continue
    }
    if (!existing) byFrom.set(from, { noteId: from, faceId: refFace, fromFaceId })
  }
  return Array.from(byFrom.values())
}

export function getFaceBacklinksFor(index: NoteRefIndex, noteId: string, faceId: string): NoteBacklinkRef[] {
  const id = String(noteId || '').trim()
  const targetFace = String(faceId || '').trim()
  if (!id || !targetFace) return []

  const byFrom = new Map<string, NoteBacklinkRef>()
  for (const { from, fromFaceId } of traverseBacklinkSources(
    index,
    ref => String(ref.noteId || '').trim() === id && String(ref.faceId || '').trim() === targetFace,
  )) {
    byFrom.set(from, { noteId: from, faceId: targetFace, fromFaceId })
  }
  return Array.from(byFrom.values())
}

export function isBacklinkStaleFor(
  index: NoteRefIndex,
  targetNoteId: string,
  fromNoteId: string,
  faceExists: (faceId: string) => boolean,
): boolean {
  const targetId = String(targetNoteId || '').trim()
  const from = String(fromNoteId || '').trim()
  if (!targetId || !from) return false
  const faces = index?.[from]
  if (!faces || typeof faces !== 'object') return false

  let matchedAny = false
  for (const refs of Object.values(faces)) {
    if (!Array.isArray(refs)) continue
    for (const ref of refs) {
      if (!ref || String(ref.noteId || '').trim() !== targetId) continue
      matchedAny = true
      const refFace = String(ref.faceId || '').trim()
      if (!refFace || faceExists(refFace)) return false
    }
  }
  return matchedAny
}
