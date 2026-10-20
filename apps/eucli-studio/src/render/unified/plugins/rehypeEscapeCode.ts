import { visit } from 'unist-util-visit'

// 代码内容转义插件（rehype 层）：把 <code> 内的文本按 HTML 实体转义后以 raw 输出。
//
// 为什么需要：
//   1. 与旧引擎保持一致 —— 旧引擎由 Markdown 渲染器统一转义 & < >，产物等价。
//   2. 规避解析器对 "-->" 等序列的处理差异（未转义时部分环境会重复解析内容）。
//
// 只处理纯文本内容（代码块 / 行内代码内不存在元素子节点），不做结构改动。

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function rehypeEscapeCode() {
  return (tree: any) => {
    visit(tree, 'element', (node: any) => {
      if (node.tagName !== 'code') return

      const children = Array.isArray(node.children) ? node.children : []
      if (!children.length) return
      if (!children.every((child: any) => child.type === 'text')) return

      const text = children.map((child: any) => String(child.value || '')).join('')
      if (!text || !/[&<>]/.test(text)) return

      node.children = [{ type: 'raw', value: escapeHtml(text) }]
    })
  }
}
