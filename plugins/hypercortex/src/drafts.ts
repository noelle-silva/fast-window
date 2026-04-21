export function isDraftNoteId(noteId: string): boolean {
  return String(noteId || '').startsWith('draft_')
}

