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
  // 是否已闭合。未闭合的块范围按空行边界截止（见 scanHtmlBlock）。
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

// 空行边界（不含空行本身）。
// CommonMark 的 type-6 HTML block 以空行结束；未闭合的块无法确定自身终点，
// 只能交出这条标准边界，否则会在模型漏写闭合标签时把后续正文一并吞进块内。
const BLANK_LINE_RE = /\r?\n[ \t]*\r?\n/g

function findBlankLineBoundary(html: string, from: number): number {
  BLANK_LINE_RE.lastIndex = from
  const m = BLANK_LINE_RE.exec(html)
  return m ? m.index : html.length
}

// 从 offset 起寻找一个完整 HTML 块。若 offset 处不是块级起始标签，返回 null。
// 返回的 closed=false 表示块未闭合：范围截止到第一个空行（标准边界），
// 其后的内容仍按普通文本参与 Markdown 解析。
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

  // 未闭合：范围截止到第一个空行。不取到文末，避免漏写闭合标签时把后续
  // 标题、表格、围栏一并当成 HTML 原文，令整篇 Markdown 失去解析机会。
  const until = findBlankLineBoundary(s, first.end)
  return { raw: s.slice(offset, until), start: offset, end: until, closed: false }
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

// 把一块 HTML 拆成「结构标签」与「文本域」。
//
// 结构标签：位于行首的块级标签，与 CommonMark 的 HTML block 起始条件一致。
// 文本域：两个结构标签之间的连续内容，其中的行内标签（span、b、img…）留在
//   文本里一起交给解析器。按标签边界逐个切开会把表格、列表这类跨行结构
//   切成半截，切点必须落在结构层，不能落在行内成员上。
export type HtmlPiece = {
  kind: 'tag' | 'text'
  value: string
  // 文本域所在的原样容器（pre / code / script / style / textarea），否则为 null。
  container: string | null
  // 文本域内出现过原样容器：整域不参与子排版，避免把代码内容当排版语法。
  opaque: boolean
}

// 原样文本容器：这些标签内部的内容不参与子排版。
const RAW_TEXT_CONTAINERS = new Set(['pre', 'code', 'script', 'style', 'textarea'])

// 结构标签：可在行首独立成段的块级元素。段落与标题同样会中断行内 Markdown，
// 与扫描用的块级集合一起参与结构切分。
const STRUCTURE_TAGS = new Set([
  ...BLOCK_TAGS,
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
])

export function splitHtmlStructure(raw: string): HtmlPiece[] {
  const s = String(raw || '')
  const out: HtmlPiece[] = []
  const stack: string[] = []
  let cursor = 0
  let i = 0
  let lineStart = 0
  let sawOpaque = false

  const currentContainer = (): string | null => {
    for (let k = stack.length - 1; k >= 0; k--) {
      if (RAW_TEXT_CONTAINERS.has(stack[k])) return stack[k]
    }
    return null
  }

  const flushText = (end: number) => {
    if (end <= cursor) return
    const container = currentContainer()
    out.push({
      kind: 'text',
      value: s.slice(cursor, end),
      container,
      opaque: sawOpaque || container !== null,
    })
    sawOpaque = false
  }

  const trackTag = (tagText: string) => {
    const m = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)/.exec(tagText)
    if (!m) return
    const name = m[2].toLowerCase()
    if (m[1] === '/') {
      const at = stack.lastIndexOf(name)
      if (at >= 0) stack.length = at
      return
    }
    if (/\/\s*>$/.test(tagText) || VOID_TAGS.has(name)) return
    stack.push(name)
  }

  const atLineStart = (pos: number) => {
    for (let k = lineStart; k < pos; k++) {
      const c = s[k]
      if (c !== ' ' && c !== '\t') return false
    }
    return true
  }

  const pushStructure = (start: number, end: number) => {
    flushText(start)
    const tagText = s.slice(start, end)
    trackTag(tagText)
    out.push({ kind: 'tag', value: tagText, container: null, opaque: false })
    cursor = end
  }

  while (i < s.length) {
    const c = s[i]
    if (c === '\n') {
      lineStart = i + 1
      i++
      continue
    }
    if (c !== '<') {
      i++
      continue
    }
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4)
      const stop = end < 0 ? s.length : end + 3
      pushStructure(i, stop)
      i = stop
      continue
    }
    if (s.startsWith('<!', i) || s.startsWith('<?', i)) {
      const end = s.indexOf('>', i)
      const stop = end < 0 ? s.length : end + 1
      pushStructure(i, stop)
      i = stop
      continue
    }

    const tag = readTag(s, i)
    if (!tag) {
      i++
      continue
    }

    // 行首的块级标签才算结构；其余标签属于文本域内的行内成员。
    if (!(STRUCTURE_TAGS.has(tag.name) && atLineStart(i))) {
      if (!tag.closing && !tag.selfClosing && RAW_TEXT_CONTAINERS.has(tag.name)) sawOpaque = true
      trackTag(s.slice(i, tag.end))
      i = tag.end
      continue
    }

    pushStructure(i, tag.end)
    i = tag.end
  }

  flushText(s.length)
  return out
}
