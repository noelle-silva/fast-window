// 原始 HTML 块扫描：识别文本中的整块 HTML（含内嵌 SVG），供 HTML 能力整块认领。
//
// 为什么需要它：Markdown 解析器遇到 HTML 块内的空行会结束该块，把后续元素当
// Markdown 段落处理，包进 <p> 并插入 <br>。对 SVG 而言这是致命破坏——浏览器会
// 丢弃 SVG 内非法的 <p>，连带图形一起消失。因此整块 HTML 必须在进入 Markdown
// 之前被认领保护。
//
// 纯字符串扫描，不依赖 DOM，也不改变任何渲染语义。

export type HtmlBlock = {
  // 整块原始文本（含起止标签）。
  raw: string
  // 起始位置（含）。
  start: number
  // 结束位置（不含）。
  end: number
  // 是否已闭合。未闭合的块是流式半成品，由调用方决定是否认领。
  closed: boolean
}

// 顶层块级标签：这些标签在行首出现时开启一个 HTML 块。
const BLOCK_TAGS = new Set([
  'div', 'svg', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav',
  'figure', 'figcaption', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'blockquote', 'pre', 'details', 'summary',
  'video', 'audio', 'picture', 'canvas', 'form', 'fieldset', 'iframe', 'style',
])

// 自闭合 / void 标签：不计入嵌套深度。
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

function readTag(html: string, i: number): { name: string; end: number; closing: boolean; selfClosing: boolean } | null {
  // i 指向 '<'
  if (html[i] !== '<') return null
  const next = html[i + 1]
  if (next === '/' ) {
    const end = html.indexOf('>', i)
    if (end < 0) return null
    const inner = html.slice(i + 2, end).trim()
    const name = (/^([A-Za-z][A-Za-z0-9-]*)/.exec(inner)?.[1] || '').toLowerCase()
    return { name, end: end + 1, closing: true, selfClosing: false }
  }
  if (!/[A-Za-z]/.test(next || '')) return null

  let j = i + 1
  let quote = ''
  while (j < html.length) {
    const c = html[j]
    if (quote) {
      if (c === quote) quote = ''
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === '>') {
      break
    }
    j++
  }
  if (j >= html.length) return null
  const inner = html.slice(i + 1, j)
  const name = (/^([A-Za-z][A-Za-z0-9-]*)/.exec(inner)?.[1] || '').toLowerCase()
  const selfClosing = /\/\s*$/.test(inner) || VOID_TAGS.has(name)
  return { name, end: j + 1, closing: false, selfClosing }
}

// 从 offset 起寻找一个完整 HTML 块。若 offset 处不是块级起始标签，返回 null。
// 返回的 closed=false 表示扫到文本末尾仍未闭合（流式半成品）。
export function scanHtmlBlock(html: string, offset: number): HtmlBlock | null {
  const s = String(html || '')
  if (s[offset] !== '<') return null
  const first = readTag(s, offset)
  if (!first || first.closing || !BLOCK_TAGS.has(first.name)) return null

  if (first.selfClosing) {
    return { raw: s.slice(offset, first.end), start: offset, end: first.end, closed: true }
  }

  let depth = 1
  let i = first.end
  while (i < s.length) {
    if (s[i] !== '<') {
      i++
      continue
    }
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4)
      i = end < 0 ? s.length : end + 3
      continue
    }
    if (s.startsWith('<!', i) || s.startsWith('<?', i)) {
      const end = s.indexOf('>', i)
      i = end < 0 ? s.length : end + 1
      continue
    }
    const tag = readTag(s, i)
    if (!tag) {
      i++
      continue
    }
    if (tag.closing && tag.name === first.name) {
      depth--
      i = tag.end
      if (depth === 0) return { raw: s.slice(offset, tag.end), start: offset, end: tag.end, closed: true }
      continue
    }
    if (!tag.closing && !tag.selfClosing && tag.name === first.name) {
      depth++
    }
    i = tag.end
  }

  // 未闭合：整段剩余内容视为一个未完成块。
  return { raw: s.slice(offset), start: offset, end: s.length, closed: false }
}

// 在文本中找出所有顶层 HTML 块（按出现顺序，互不重叠）。
export function findHtmlBlocks(html: string): HtmlBlock[] {
  const s = String(html || '')
  const out: HtmlBlock[] = []
  let i = 0
  while (i < s.length) {
    if (s[i] !== '<') {
      i++
      continue
    }
    const block = scanHtmlBlock(s, i)
    if (!block) {
      i++
      continue
    }
    out.push(block)
    i = block.end
  }
  return out
}
