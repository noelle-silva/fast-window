import { tokenizeFences, splitInlineCodeSpans } from '../fences'
import { findHtmlBlocks } from '../htmlBlocks'

// ============================================================================
// HTML 块解析前保护
//
// 为什么必须在解析前做：
//   Markdown 遇到 HTML 块内部的空行，会认为该块结束，把后续内容当普通段落，
//   包进 <p> 并插入 <br>。对 <svg> 而言这是致命破坏——浏览器会丢弃 SVG 内
//   非法的 <p>，图形随之消失。
//
//   074 已记录该问题，旧引擎通过「整块认领成占位符」解决。
//   unified 的 rehype-raw 虽然能把 HTML 重新解析成节点，但它在 Markdown 解析
//   **之后**才运行——那时块已经被拆坏了，救不回来。
//
// 做法：解析前把整块 HTML 换成占位符，解析后由 rehype 插件还原成 raw 节点，
// 再交给 rehype-raw 重新解析成真节点（块内公式 / 表情包 / 围栏因此仍可见）。
// 未闭合的块由扫描器按空行边界截止，因此占位符不会越界吞掉后续正文。
// 代码围栏内的内容不参与保护。
// ============================================================================

export const HTML_BLOCK_PLACEHOLDER_RE = /@@FWHTMLBLOCK(\d+)@@/g

function replaceHtmlBlocks(text: string, blocks: string[]): string {
  const found = findHtmlBlocks(text)
  if (!found.length) return text

  let out = ''
  let last = 0
  for (const block of found) {
    out += text.slice(last, block.start)
    const index = blocks.length
    blocks.push(block.raw)
    // 前后留空行，确保 Markdown 把它当独立段落，便于整段还原。
    out += `\n\n@@FWHTMLBLOCK${index}@@\n\n`
    last = block.end
  }
  out += text.slice(last)
  return out
}

// protectHtmlBlocks 把整块 HTML 换成占位符，返回替换后的文本与原文清单。
export function protectHtmlBlocks(source: string): { text: string; blocks: string[] } {
  const blocks: string[] = []
  const src = String(source || '')
  if (!src.includes('<')) return { text: src, blocks }

  const out = tokenizeFences(src)
    .map((token) => {
      if (token.kind === 'fence') return token.raw
      // 行内代码里的内容不参与保护（否则 `&lt;div&gt;` 这类示例会被当真渲染）
      return splitInlineCodeSpans(token.text)
        .map((part) => (part.kind === 'code' ? part.value : replaceHtmlBlocks(part.value, blocks)))
        .join('')
    })
    .join('')

  return { text: out, blocks }
}

// demoteOpenFences 把未闭合围栏的语言标记去掉，使其保持草稿态（不进入专用渲染）。
// CommonMark 规定未闭合围栏延续到文末，若不处理会被图表插件误认领。
export function demoteOpenFences(source: string): string {
  const src = String(source || '')
  if (!src.includes('```')) return src

  return tokenizeFences(src)
    .map((token) => {
      if (token.kind === 'text') return token.text
      if (token.closed) return token.raw

      const nl = token.raw.indexOf('\n')
      const firstLine = nl >= 0 ? token.raw.slice(0, nl) : token.raw
      const rest = nl >= 0 ? token.raw.slice(nl) : ''
      return firstLine.replace(/^(\s*`{3,})[\s\S]*$/, '$1') + rest
    })
    .join('')
}
