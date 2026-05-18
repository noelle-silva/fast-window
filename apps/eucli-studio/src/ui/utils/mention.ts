export function findAtMentionTrigger(text: string, cursorIndex: number) {
  const t = String(text || '')
  const cursor = Math.max(0, Math.min(t.length, Math.floor(Number(cursorIndex) || 0)))
  if (!cursor) return null

  const at = t.lastIndexOf('@', cursor - 1)
  if (at < 0) return null

  // Avoid matching emails like "a@b" by requiring a boundary before '@'.
  const prev = at > 0 ? t[at - 1] : ''
  if (prev && !/[\s\n\r\t\(\（\[\【\{\《\<“"'、，。！？：；,\.!\?:;]/.test(prev)) return null

  // Completed mention uses "@{...}" – don't reopen.
  const next = t[at + 1] || ''
  if (next === '{') return null

  const between = t.slice(at + 1, cursor)
  if (/[ \t\r\n]/.test(between)) return null

  return { triggerIndex: at, cursorIndex: cursor, query: between }
}
