import type { NoteMeta } from './core'

export function sortNotesByUpdatedAtDesc(list: NoteMeta[]): NoteMeta[] {
  return (Array.isArray(list) ? list : []).slice().sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0))
}
