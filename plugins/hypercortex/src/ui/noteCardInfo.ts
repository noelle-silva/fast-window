import type { NoteMeta } from '../core'
import { isDraftNoteId } from '../drafts'

export type NoteCardInfo = {
  tags: string[]
  faceLabels: string[]
}

export function noteContainsLabel(info: NoteCardInfo | null | undefined): string {
  if (!info) return ''
  return Array.from(new Set((info.faceLabels || []).map(v => String(v || '').trim()).filter(Boolean))).join(' · ')
}

export function shouldShowNoteContains(meta: NoteMeta): boolean {
  const note = meta as any
  const id = String(note?.id || '').trim()
  if (!id) return false
  if (isDraftNoteId(id)) return false
  return !!String(note?.dir || '').trim()
}
