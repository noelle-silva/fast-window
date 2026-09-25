import type { NoteMeta, VaultScope } from '../core'
import { isDraftNoteId } from '../drafts'
import { resolveNoteFaceOrder } from '../facePreferences'
import { resolveFaceKindLabel } from '../facePlugins'
import type { NotesService } from '../gateway/types'
import type { NoteCardInfo } from './noteCardInfo'

export async function loadNoteCardInfo(
  notes: NotesService,
  scope: VaultScope,
  meta: NoteMeta,
  globalKindOrder?: readonly string[],
): Promise<NoteCardInfo | null> {
  const nid = String(meta?.id || '').trim()
  if (!nid) return null
  if (isDraftNoteId(nid) || !String(meta?.dir || '').trim()) return null

  const manifest = await notes.tryReadNoteManifest(scope, meta.dir)
  if (!manifest) return null

  const faceOrder = resolveNoteFaceOrder({ faceOrder: manifest.faceOrder, faces: manifest.faces, globalKindOrder })

  return {
    tags: Array.isArray(manifest.tags) ? manifest.tags.map(v => String(v || '').trim()).filter(Boolean) : [],
    faceLabels: faceOrder
      .map(faceId => manifest.faces?.[faceId])
      .filter(Boolean)
      .map(face => String(face.title || '').trim() || resolveFaceKindLabel(face.kind)),
    faceIds: faceOrder,
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
