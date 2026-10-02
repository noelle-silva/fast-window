// 围栏与行内代码切分：渲染内容形态层的基础扫描。
//
// 纯字符串处理，不依赖 DOM，也不改变任何渲染语义。tokenizeFences 把原始文本
// 切成「文本」与「围栏」两类 token；splitInlineCodeSpans 把一段文本切成
// 「行内代码」与「普通文本」两类片段，供能力只在普通文本上认领内容。

export type FenceToken =
  | { kind: 'text'; text: string }
  | { kind: 'fence'; raw: string; lang: string; content: string; closed: boolean }

export function tokenizeFences(input: string): FenceToken[] {
  const src = String(input || '')
  const lines = src.split('\n')

  const out: FenceToken[] = []
  const textBuf: string[] = []

  const flushText = () => {
    if (!textBuf.length) return
    out.push({ kind: 'text', text: textBuf.join('') })
    textBuf.length = 0
  }

  let inFence = false
  let fenceMarker = ''
  let fenceInfo = ''
  let openLineRaw = ''
  const fenceLinesRaw: string[] = []

  const openRe = /^(\s*)(`{3,})(.*)$/
  const closeRe = /^(\s*)(`{3,})\s*$/
  let fenceIndent = ''

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]
    const withNl = idx < lines.length - 1 ? line + '\n' : line
    if (!inFence) {
      const m = openRe.exec(line)
      if (!m) {
        textBuf.push(withNl)
        continue
      }

      flushText()
      inFence = true
      fenceIndent = String(m[1] || '')
      fenceMarker = String(m[2] || '```')
      fenceInfo = String(m[3] || '').trim()
      openLineRaw = withNl
      fenceLinesRaw.length = 0
      continue
    }

    const m2 = closeRe.exec(line)
    if (m2 && String(m2[1] || '') === fenceIndent && String(m2[2] || '') === fenceMarker) {
      const content = fenceLinesRaw.join('')
      const raw = `${openLineRaw}${content}${withNl}`
      const lang = fenceInfo.split(/\s+/g)[0] || ''
      out.push({ kind: 'fence', raw, lang, content, closed: true })
      inFence = false
      fenceMarker = ''
      fenceIndent = ''
      fenceInfo = ''
      openLineRaw = ''
      fenceLinesRaw.length = 0
      continue
    }

    fenceLinesRaw.push(withNl)
  }

  if (inFence) {
    const content = fenceLinesRaw.join('')
    const raw = openLineRaw + content
    const lang = fenceInfo.split(/\s+/g)[0] || ''
    out.push({ kind: 'fence', raw, lang, content, closed: false })
    inFence = false
  }

  flushText()
  return out
}

export function splitInlineCodeSpans(input: string): Array<{ kind: 'text' | 'code'; value: string }> {
  const s = String(input || '')
  const out: Array<{ kind: 'text' | 'code'; value: string }> = []
  let i = 0
  let last = 0

  while (i < s.length) {
    if (s[i] !== '`') {
      i++
      continue
    }

    let n = 1
    while (i + n < s.length && s[i + n] === '`') n++
    const marker = '`'.repeat(n)
    const start = i
    const end = s.indexOf(marker, i + n)
    if (end < 0) break

    if (start > last) out.push({ kind: 'text', value: s.slice(last, start) })
    out.push({ kind: 'code', value: s.slice(start, end + n) })
    i = end + n
    last = i
  }

  if (last < s.length) out.push({ kind: 'text', value: s.slice(last) })
  return out
}
