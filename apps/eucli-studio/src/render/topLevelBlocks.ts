// 顶层块切分：把渲染输出（HTML 字符串）切成「顶层块」序列。
//
// 用途：流式渲染时，内容只会增长，已渲染的顶层块除最后一块外都不会变化。
// 以顶层块为粒度，可以保留未变块对应的 DOM 节点，只重解析变化的尾部，
// 从而把每帧成本从「随全文增长」降到「只与新增内容有关」。
//
// 纯字符串扫描，不依赖 DOM，也不改变任何渲染语义。

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

// splitTopLevelBlocks 把 HTML 切成顶层块。拼接所有块可还原原文。
// 顶层元素（含 void）各自成块；元素之间的文本（空白等）也各自成块。
export function splitTopLevelBlocks(html: string): string[] {
  const s = String(html || '')
  const n = s.length
  const blocks: string[] = []
  let depth = 0
  let segStart = 0
  let i = 0

  const flushText = (end: number) => {
    if (end > segStart) blocks.push(s.slice(segStart, end))
  }

  while (i < n) {
    if (s[i] !== '<') {
      i++
      continue
    }
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4)
      i = end < 0 ? n : end + 3
      continue
    }
    if (s.startsWith('<!', i) || s.startsWith('<?', i)) {
      const end = s.indexOf('>', i)
      i = end < 0 ? n : end + 1
      continue
    }
    if (s[i + 1] === '/') {
      const end = s.indexOf('>', i)
      if (end < 0) break
      if (depth > 0) depth--
      i = end + 1
      if (depth === 0) {
        blocks.push(s.slice(segStart, i))
        segStart = i
      }
      continue
    }

    // 起始标签：扫到标签结束（跳过属性引号）。
    let j = i + 1
    let quote = ''
    while (j < n) {
      const c = s[j]
      if (quote) {
        if (c === quote) quote = ''
      } else if (c === '"' || c === "'") {
        quote = c
      } else if (c === '>') {
        break
      }
      j++
    }
    const tagEnd = j < n ? j + 1 : n
    const tagText = s.slice(i + 1, j)
    const nameMatch = /^([A-Za-z][A-Za-z0-9-]*)/.exec(tagText)
    const name = nameMatch ? nameMatch[1].toLowerCase() : ''
    const selfClosing = /\/\s*$/.test(tagText) || VOID_TAGS.has(name)

    if (depth === 0) {
      flushText(i)
      segStart = i
      if (selfClosing) {
        blocks.push(s.slice(segStart, tagEnd))
        segStart = tagEnd
      } else {
        depth++
      }
    } else if (!selfClosing) {
      depth++
    }
    i = tagEnd
  }

  if (segStart < n) blocks.push(s.slice(segStart, n))
  return blocks
}

// commonPrefixLength 返回两个块序列从头开始连续相等的块数。
export function commonBlockPrefix(a: string[], b: string[]): number {
  const limit = Math.min(a.length, b.length)
  let i = 0
  while (i < limit && a[i] === b[i]) i++
  return i
}
