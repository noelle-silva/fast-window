export type NotePlaceholder = {
  noteId: string
  title?: string
  remarks?: string
}

function sanitizePlaceholderValue(value: string): string {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, ' ')
    .replaceAll('|', '｜')
    .replaceAll(']]', '］］')
    .trim()
}

export function parseNotePlaceholderBody(body: string): NotePlaceholder | null {
  const raw = String(body || '').trim()
  if (!raw) return null

  let noteId = ''
  let title: string | undefined
  let remarks: string | undefined

  for (const part of raw.split('|')) {
    const seg = String(part || '').trim()
    if (!seg) continue
    const eq = seg.indexOf('=')
    if (eq < 0) continue
    const key = seg.slice(0, eq).trim()
    const value = seg.slice(eq + 1)
    if (key === 'note_id') noteId = String(value || '').trim()
    else if (key === 'title') title = String(value || '')
    else if (key === 'remarks') remarks = String(value || '')
  }

  if (!noteId) return null
  const out: NotePlaceholder = { noteId }
  if (typeof title === 'string') out.title = title
  if (typeof remarks === 'string') out.remarks = remarks
  return out
}

export function buildNotePlaceholderForCopy(noteId: string, noteTitleAtCopy: string): string {
  const id = String(noteId || '').trim()
  const remarks = sanitizePlaceholderValue(noteTitleAtCopy)
  return `[[note_id=${id}|title=|remarks=${remarks}]]`
}

