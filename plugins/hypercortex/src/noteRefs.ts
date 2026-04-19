import { REFS_INDEX_FILE, type Api, type VaultScope } from './core'

export const NOTE_REF_PATTERN = /\[\[([^\]|]+?)(?:\|([^\]]*?))?\]\]/g

export type NoteRefIndex = Record<string, string[]>

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

export function extractNoteRefs(body: string): string[] {
  const text = maskCode(body)
  const ids = new Set<string>()

  for (const match of text.matchAll(NOTE_REF_PATTERN)) {
    const id = String(match?.[1] || '').trim()
    if (!id) continue
    ids.add(id)
  }

  return Array.from(ids)
}

export async function loadRefIndex(api: Api, scope: VaultScope): Promise<NoteRefIndex> {
  try {
    const raw = await api.files.readText({ scope, path: REFS_INDEX_FILE })
    const parsed = JSON.parse(raw || 'null')
    if (!parsed || typeof parsed !== 'object') return {}

    const entries = Object.entries(parsed as Record<string, unknown>).map(([noteId, value]) => {
      const refs = Array.isArray(value) ? value.map(v => String(v || '').trim()).filter(Boolean) : []
      return [String(noteId || '').trim(), Array.from(new Set(refs))] as const
    })

    return Object.fromEntries(entries.filter(([k]) => !!k))
  } catch {
    return {}
  }
}

export async function saveRefIndex(api: Api, scope: VaultScope, index: NoteRefIndex): Promise<void> {
  await api.files.writeText({ scope, path: REFS_INDEX_FILE, text: JSON.stringify(index, null, 2), overwrite: true })
}

export async function updateRefsForNote(api: Api, scope: VaultScope, noteId: string, body: string): Promise<void> {
  const id = String(noteId || '').trim()
  if (!id) return

  const refs = extractNoteRefs(body)
  const index = await loadRefIndex(api, scope)

  if (refs.length > 0) index[id] = refs
  else delete index[id]

  await saveRefIndex(api, scope, index)
}

export async function removeNoteFromRefIndex(api: Api, scope: VaultScope, noteId: string): Promise<void> {
  const id = String(noteId || '').trim()
  if (!id) return

  const index = await loadRefIndex(api, scope)
  delete index[id]
  await saveRefIndex(api, scope, index)
}

export function getBacklinksFor(index: NoteRefIndex, noteId: string): string[] {
  const id = String(noteId || '').trim()
  if (!id) return []

  const backlinks: string[] = []
  for (const [from, refs] of Object.entries(index || {})) {
    if (!Array.isArray(refs)) continue
    if (refs.includes(id)) backlinks.push(from)
  }
  return backlinks
}

