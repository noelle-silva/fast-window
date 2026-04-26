import type { Api, NoteMeta, VaultScope } from '../core'
import { isDraftNoteId } from '../drafts'
import { tryReadNoteManifest } from '../notePackage'
import { labelForFaceKind } from '../noteFaces'
import type { NoteCardInfo } from './noteCardInfo'

export async function loadNoteCardInfo(api: Api, scope: VaultScope, meta: NoteMeta): Promise<NoteCardInfo | null> {
  const nid = String(meta?.id || '').trim()
  if (!nid) return null
  if (isDraftNoteId(nid) || !String(meta?.dir || '').trim()) return null

  const manifest = await tryReadNoteManifest(api, scope, meta.dir)
  if (!manifest) return null

  return {
    tags: Array.isArray(manifest.tags) ? manifest.tags.map(v => String(v || '').trim()).filter(Boolean) : [],
    faceLabels: (manifest.faceOrder || Object.keys(manifest.faces || {}))
      .map(faceId => manifest.faces?.[faceId])
      .filter(Boolean)
      .map(face => String(face.title || '').trim() || labelForFaceKind(face.kind)),
  }
}

export function startPrefetchNoteCardInfo(params: {
  notes: NoteMeta[]
  getInfoById: (noteId: string) => NoteCardInfo | undefined
  refresh: (meta: NoteMeta) => Promise<void>
  maxWorkers?: number
}): { cancel: () => void } {
  const list = Array.isArray(params.notes) ? params.notes.slice() : []
  const getInfoById = params.getInfoById
  const refresh = params.refresh

  const queue = list.filter(n => {
    const nid = String(n?.id || '').trim()
    if (!nid) return false
    if (isDraftNoteId(nid) || !String(n?.dir || '').trim()) return false
    return !getInfoById(nid)
  })

  if (!queue.length) return { cancel: () => {} }

  let cancelled = false
  let cursor = 0
  const workers = Math.min(Math.max(1, Math.floor(Number(params.maxWorkers ?? 6) || 6)), queue.length)

  void (async () => {
    const runOne = async () => {
      while (!cancelled && cursor < queue.length) {
        const note = queue[cursor++]
        await refresh(note).catch(() => {})
      }
    }
    await Promise.all(Array.from({ length: workers }, runOne))
  })()

  return { cancel: () => (cancelled = true) }
}
