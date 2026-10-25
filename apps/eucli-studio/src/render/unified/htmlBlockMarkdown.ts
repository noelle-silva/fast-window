import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'

import { splitHtmlStructure } from '../htmlBlocks'

// ============================================================================
// HTML 块内子排版
//
// Markdown 解析器不处理 HTML 块内部，块里写的 **加粗**、- 列表、| 表格 |
// 只会以字面留在文本节点里。这里把块内文本片段单独交给 Markdown 解析一次，
// 产出的结构留在原来的标签位置，后续 rehype-raw 照常展开成节点。
//
// 两条边界：
//   - 只认带语法记号的片段；纯文本片段原样保留，避免解析器给它套上段落外壳、
//     改变卡片原有的文字版式；
//   - 代码、脚本、样式容器内的文本属于原样域，一律跳过。
// ============================================================================

// 语法记号：行内记号，或行首的标题 / 列表 / 表格。
const MARKDOWN_HINT =
  /(\*\*|~~|`|\]\(|^[ \t]{0,3}(?:#{1,6}[ \t]|[-*+][ \t]|\d+\.[ \t]|\|))/m

// 单段落去壳：只解析出一个段落时取其内容，让片段按行内结构嵌在原位。
const SOLE_PARAGRAPH = /^<p>([\s\S]*)<\/p>\s*$/
const NESTED_PARAGRAPH = /<p[\s>]|<\/p>/

const fragmentProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkBreaks)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeStringify, { allowDangerousHtml: true })

function renderFragment(text: string): string {
  const html = String(fragmentProcessor.processSync(text))
  const sole = SOLE_PARAGRAPH.exec(html)
  if (sole && !NESTED_PARAGRAPH.test(sole[1])) return sole[1]
  return html
}

// 把一块 HTML 内参与排版的文本域按 Markdown 解析，结构标签原样保留。
export function renderHtmlBlockTextMarkdown(raw: string): string {
  const source = String(raw || '')
  if (!source.includes('<')) return source

  let out = ''
  for (const piece of splitHtmlStructure(source)) {
    if (piece.kind === 'tag' || piece.container || piece.opaque) {
      out += piece.value
      continue
    }
    if (!piece.value.trim() || !MARKDOWN_HINT.test(piece.value)) {
      out += piece.value
      continue
    }
    out += renderFragment(piece.value)
  }
  return out
}
