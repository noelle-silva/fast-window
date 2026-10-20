import { visit } from 'unist-util-visit'

// 图表插件（rehype 层）：把 language-mermaid / flowchart / graph 的代码块
// 标记为「待渲染」，结构与旧引擎保持一致，收尾阶段由既有 Mermaid 支持接手。
//
// 收尾契约：renderMermaidInto 找 pre[data-fw-mermaid-complete="1"] > code，
// 且 code 的 class 需含 language-mermaid。因此这里把标签统一成 language-mermaid。

const LANGS = new Set(['mermaid', 'flowchart', 'graph'])

export function rehypeMermaid() {
  return (tree: any) => {
    visit(tree, 'element', (node: any) => {
      if (node.tagName !== 'pre') return

      const code = (node.children || []).find((c: any) => c.type === 'element' && c.tagName === 'code')
      if (!code) return

      const cls = Array.isArray(code.properties?.className) ? code.properties.className.map(String) : []
      const lang = (cls.find((c: string) => c.startsWith('language-')) || '').slice('language-'.length)
      if (!LANGS.has(lang.toLowerCase())) return

      code.properties = { ...(code.properties || {}), className: ['language-mermaid'] }
      node.properties = { ...(node.properties || {}), 'data-fw-mermaid-complete': '1' }
    })
  }
}
