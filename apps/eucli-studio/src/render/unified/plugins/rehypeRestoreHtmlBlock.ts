import { visit } from 'unist-util-visit'
import { HTML_BLOCK_PLACEHOLDER_RE } from '../htmlProtect'

// HTML 块占位还原插件（rehype 层，必须排在 rehype-raw 之前）：
// 把解析前保护的 @@FWHTMLBLOCK{n}@@ 还原成 raw 节点，交给 rehype-raw 重新解析成真节点。
//
// 这样既保住了「整块不被 Markdown 的空行拆坏」，又保住了「块内内容对后续插件可见」。

const WHOLE_PARAGRAPH = /^@@FWHTMLBLOCK(\d+)@@$/

export function rehypeRestoreHtmlBlock(options: { getBlocks: () => string[] }) {
  return (tree: any) => {
    const blocks = options.getBlocks()
    if (!blocks.length) return

    // 情形一：占位符独占一个段落 → 整段替换成 raw HTML
    visit(tree, 'element', (node: any, index: any, parent: any) => {
      if (!parent || typeof index !== 'number') return
      if (node.tagName !== 'p') return

      const kids = Array.isArray(node.children) ? node.children : []
      if (!kids.length || !kids.every((c: any) => c.type === 'text')) return

      const joined = kids.map((c: any) => String(c.value || '')).join('').trim()
      const m = WHOLE_PARAGRAPH.exec(joined)
      if (!m) return

      const raw = blocks[Number(m[1])]
      if (raw == null) return

      parent.children.splice(index, 1, { type: 'raw', value: raw })
      return index + 1
    })

    // 情形二：占位符混在普通文本中 → 就地替换成 raw
    visit(tree, 'text', (node: any, index: any, parent: any) => {
      if (!parent || typeof index !== 'number') return
      if (parent.type === 'element' && (parent.tagName === 'code' || parent.tagName === 'pre')) return

      const value = String(node.value || '')
      if (!value.includes('@@FWHTMLBLOCK')) return

      HTML_BLOCK_PLACEHOLDER_RE.lastIndex = 0
      const out: any[] = []
      let last = 0
      let m: RegExpExecArray | null = null

      while ((m = HTML_BLOCK_PLACEHOLDER_RE.exec(value))) {
        const raw = blocks[Number(m[1])]
        if (raw == null) continue
        if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) })
        out.push({ type: 'raw', value: raw })
        last = m.index + m[0].length
      }

      if (!out.length) return
      if (last < value.length) out.push({ type: 'text', value: value.slice(last) })

      parent.children.splice(index, 1, ...out)
      return index + out.length
    })
  }
}
