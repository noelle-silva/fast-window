import { esc } from '../../core/utils'
import { decorateMathHost, ensureMathCopyHandler } from '../mathCopy'
import type { ClaimSink, RenderCapability, RenderContext } from '../contract'
import type { createMathRenderer } from '../mathRender'

type MathClaim = { tex: string; display: boolean }

// 行内 $...$ 的防误判：内容必须像公式（含字母、反斜杠或上下标）。
const INLINE_MATH_GUARD = /[A-Za-z\\]|[_^]/

// 公式能力：认领 $...$ / $$...$$ / \(...\) / \[...\] 公式，产出公式宿主，
// 并用 KaTeX 备忘录渲染、挂复制按钮。渲染结果复用由 mathRenderer 承担。
export function createMathCapability(deps: { mathRenderer: ReturnType<typeof createMathRenderer> }): RenderCapability {
  const { mathRenderer } = deps
  return {
    id: 'math',
    claimText(text: string, _ctx: RenderContext, claim: ClaimSink): string {
      let s = String(text || '')
      const stash = (tex: string, display: boolean) => claim.push({ tex: String(tex || ''), display })

      // display: $$...$$
      s = s.replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_m, tex) => stash(String(tex || '').trim(), true))
      // display: \[...\]
      s = s.replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_m, tex) => stash(String(tex || '').trim(), true))
      // inline: \(...\)
      s = s.replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, (_m, tex) => stash(String(tex || '').trim(), false))
      // inline: $...$
      s = s.replace(/\$([^\$\n]+?)\$/g, (m, tex) => {
        const t = String(tex || '').trim()
        if (!t) return m
        if (!INLINE_MATH_GUARD.test(t)) return m
        return stash(t, false)
      })
      return s
    },
    placeholder(data: unknown): string {
      const it = data as MathClaim
      const tex = esc(String(it?.tex || ''))
      if (it?.display) return `<div class="math-block" data-tex="${tex}"></div>`
      return `<span class="math-inline" data-tex="${tex}"></span>`
    },
    decorate(fragment: DocumentFragment) {
      const katex = (window as any).katex
      if (!katex || typeof katex.renderToString !== 'function') return

      const blocks = Array.from(fragment.querySelectorAll?.('.math-block[data-tex]') || [])
      for (const b of blocks) {
        if (!(b instanceof HTMLElement)) continue
        mathRenderer.renderMathInto(b, b.getAttribute('data-tex') || '', true)
        decorateMathHost(b)
      }
      const inlines = Array.from(fragment.querySelectorAll?.('.math-inline[data-tex]') || [])
      for (const s of inlines) {
        if (!(s instanceof HTMLElement)) continue
        mathRenderer.renderMathInto(s, s.getAttribute('data-tex') || '', false)
        decorateMathHost(s)
      }
    },
    bind(host, ctx) {
      ensureMathCopyHandler(host, ctx.capabilities)
    },
    permissions: ['clipboard.writeText', 'ui.showToast'],
  }
}
