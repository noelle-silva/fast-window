export function prettyJsonText(value: unknown) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  try {
    const text = JSON.stringify(value, null, 2)
    return typeof text === 'string' ? text : String(value)
  } catch {
    return String(value)
  }
}

export function snippetText(raw: any, maxLen = 26) {
  const s0 = typeof raw === 'string' ? raw : String(raw ?? '')
  const s1 = s0.replace(/\r/g, '').trim()
  if (!s1) return '（空）'
  const firstLine = (s1.split('\n').find((x) => String(x || '').trim()) || '').trim()
  const s = firstLine || s1.split('\n')[0] || s1
  const one = s.replace(/\s+/g, ' ').trim()
  if (one.length <= maxLen) return one
  return one.slice(0, Math.max(0, maxLen - 1)).trimEnd() + '…'
}

// 列表实时过滤的唯一匹配口径：空关键词一律视为命中，由调用方决定「没有匹配」怎么显示。
// fields 只收条目上真正看得见的文字——命中看不见的字段会让人猜不出这行为什么还在。
export function matchesSearchQuery(queryText: string, fields: ReadonlyArray<unknown>) {
  const q = String(queryText || '').trim().toLowerCase()
  if (!q) return true
  return fields.some((field) => String(field ?? '').toLowerCase().includes(q))
}

export function chatHistoryMatchesSearch(chat: any, fallbackTitle: string, queryText: string) {
  if (!String(queryText || '').trim()) return true
  if (!chat) return false
  return matchesSearchQuery(queryText, [chat?.title || fallbackTitle, chat?.lastMessagePreview])
}
