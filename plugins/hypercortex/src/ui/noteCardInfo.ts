import type { NoteMeta } from '../core'
import { isDraftNoteId } from '../drafts'

export type NoteCardInfo = {
  tags: string[]
  hasTextFace: boolean
  hasHtmlFace: boolean
}

export function noteContainsLabel(info: NoteCardInfo | null | undefined): string {
  if (!info) return ''
  const hasText = info.hasTextFace
  const hasHtml = info.hasHtmlFace
  if (hasText && hasHtml) return '文本 · HTML'
  if (hasText) return '文本'
  if (hasHtml) return 'HTML'
  return ''
}

export function shouldShowNoteContains(meta: NoteMeta): boolean {
  const note = meta as any
  const id = String(note?.id || '').trim()
  if (!id) return false
  if (isDraftNoteId(id)) return false
  return !!String(note?.dir || '').trim()
}
