import { visit } from 'unist-util-visit'
import { MATH_PLACEHOLDER_RE, type MathClaim } from '../mathProtect'

// 公式占位还原插件（rehype 层）：
// 把解析前保护的 @@FWMATH{n}@@ 占位符还原成公式宿主。
//
// 与旧引擎产物一致：<span class="math-inline" data-tex="..."> / <div class="math-block" data-tex="...">，
// KaTeX 真正渲染与复制按钮由既有能力在 decorate 阶段完成。
//
// 因为占位符在解析前就已写入原文，HTML 块内部的公式同样能被还原。

export function rehypeMathPlaceholder(options: { getClaims: () => MathClaim[] }) {
  return (tree: any) => {
    const claims = options.getClaims()
    if (!claims.length) return

    visit(tree, 'text', (node: any, index: any, parent: any) => {
      if (!parent || typeof index !== 'number') return
      if (parent.type === 'element' && (parent.tagName === 'code' || parent.tagName === 'pre')) return

      const value = String(node.value || '')
      if (!value.includes('@@FWMATH')) return

      MATH_PLACEHOLDER_RE.lastIndex = 0
      const out: any[] = []
      let last = 0
      let m: RegExpExecArray | null = null

      while ((m = MATH_PLACEHOLDER_RE.exec(value))) {
        const claim = claims[Number(m[1])]
        if (!claim) continue

        if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) })

        out.push({
          type: 'element',
          tagName: claim.display ? 'div' : 'span',
          properties: {
            className: [claim.display ? 'math-block' : 'math-inline'],
            'data-tex': claim.tex,
          },
          children: [],
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
