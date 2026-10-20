import { visit } from 'unist-util-visit'

// 块内围栏插件（rehype 层）：
//
// Markdown 解析器不会解析 HTML 块内部的 Markdown 语法，所以在 <div> 里写的
// ```mermaid / ```js 会以纯文本形式留在文本节点里，图表插件找不到它。
//
// 本插件在 rehype 层把这些围栏还原成标准的 pre > code 结构，
// 之后交给图表插件（打标）与代码块装饰（复制按钮）统一处理。
//
// 只认「已闭合」的围栏；未闭合的保持原文（草稿态）。

const FENCE = /(`{3,})[ \t]*([^\n`]*)\n([\s\S]*?)\n[ \t]*\1[ \t]*(?=\n|$)/g

export function rehypeFence() {
  return (tree: any) => {
    visit(tree, 'text', (node: any, index: any, parent: any) => {
      if (!parent || typeof index !== 'number') return
      // 代码内不再处理（避免代码块里的 ``` 被二次解析）
      if (parent.type === 'element' && (parent.tagName === 'code' || parent.tagName === 'pre')) return

      const value = String(node.value || '')
      if (!value.includes('```')) return

      FENCE.lastIndex = 0
      const out: any[] = []
      let last = 0
      let m: RegExpExecArray | null = null

      while ((m = FENCE.exec(value))) {
        const lang = String(m[2] || '').trim().split(/\s+/)[0] || ''
        const content = String(m[3] || '')

        if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) })

        out.push({
          type: 'element',
          tagName: 'pre',
          properties: {},
          children: [
            {
              type: 'element',
              tagName: 'code',
              properties: lang ? { className: [`language-${lang}`] } : {},
              children: [{ type: 'text', value: content }],
            },
          ],
        })

        last = m.index + m[0].length
      }

      if (!out.length) return
      if (last < value.length) out.push({ type: 'text', value: value.slice(last) })

      parent.children.splice(index, 1, ...out)
      return index + out.length
    })
  }
}
