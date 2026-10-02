// @vitest-environment happy-dom
//
// 细粒度诊断：走真实预处理管线（preprocess -> marked -> sanitize -> 占位回填），
// 分别计量「公式宿主创建」「KaTeX 解析」「KaTeX HTML 注入 DOM」「复制按钮」等步骤，
// 以区分瓶颈到底在解析还是 DOM 构建。
import { beforeAll, describe, it } from 'vitest'
import { installRenderGlobals } from './benchmark'
import { buildFormulaHeavyFixture } from './streamFixture'
import { createMarkdownRenderer } from '../markdown'
import { createHtmlSanitizer } from '../sanitize'
import { createMathRenderer } from '../mathRender'
import { preprocessAssistantContent } from '../preprocess'
import type { BoolRef } from '../types'

const PROFILE = String(process.env.PERF_PROFILE || 'smoke').trim() || 'smoke'
const PROFILES = {
  smoke: { formulaCount: 20, prosePerFormula: 1 },
  stress: { formulaCount: 100, prosePerFormula: 2 },
} as const

function fmt(n: number) {
  return n.toFixed(2)
}

function timeIt(times: number, fn: () => void): number {
  fn()
  const t0 = performance.now()
  for (let i = 0; i < times; i++) fn()
  return (performance.now() - t0) / times
}

function esc(s: unknown) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c])
}

describe('增强阶段细粒度诊断', () => {
  beforeAll(async () => {
    await installRenderGlobals()
  }, 120000)

  it('定位公式解析 vs DOM 注入 vs 增强项耗时', { timeout: 300000 }, async () => {
    const profile = PROFILES[(PROFILE in PROFILES ? PROFILE : 'smoke') as keyof typeof PROFILES]
    const text = buildFormulaHeavyFixture({ formulaCount: profile.formulaCount, prosePerFormula: profile.prosePerFormula, seed: 20261002 })

    const markdownRenderer = createMarkdownRenderer({ value: false } as BoolRef)
    const sanitizer = createHtmlSanitizer({ value: false } as BoolRef)

    // 真实管线：preprocess -> marked -> sanitize -> 占位回填
    const pre = preprocessAssistantContent(text, {})
    const md = markdownRenderer.renderMarkdownSource(pre.text)
    let safe = sanitizer.sanitizeHtml(md, 'original')
    safe = safe.replace(/@@MATH_(INLINE|BLOCK)_(\d+)@@/g, (_m: string, kind: string, id: string) => {
      const it = pre.math[Number(id)]
      const tex = it ? String(it.tex || '') : ''
      if (kind === 'INLINE') return `<span class="math-inline" data-tex="${esc(tex)}"></span>`
      return `<div class="math-block" data-tex="${esc(tex)}"></div>`
    })

    const buildHost = () => {
      const host = document.createElement('div')
      host.innerHTML = safe
      return host
    }

    const counts = {
      blocks: buildHost().querySelectorAll('.math-block[data-tex]').length,
      inlines: buildHost().querySelectorAll('.math-inline[data-tex]').length,
      total: pre.math.length,
    }

    const mathRenderer = createMathRenderer()
    const katex = (globalThis as any).katex

    // 阶段 A：仅 KaTeX 解析（缓存已暖）
    const parseMs = timeIt(5, () => {
      for (const it of pre.math) katex.renderToString(it.tex, { displayMode: !!it.display, throwOnError: false })
    })

    // 阶段 B：解析结果注入 DOM（每次新建宿主）
    const injectMs = timeIt(5, () => {
      const host = buildHost()
      const nodes = Array.from(host.querySelectorAll('.math-block[data-tex], .math-inline[data-tex]'))
      for (const n of nodes) {
        const isBlock = (n as HTMLElement).classList.contains('math-block')
        mathRenderer.renderMathInto(n as HTMLElement, (n as HTMLElement).getAttribute('data-tex') || '', isBlock)
      }
    })

    // 阶段 C：整树 innerHTML 解析（不含公式）
    const domParseMs = timeIt(5, () => {
      const host = document.createElement('div')
      host.innerHTML = safe
    })

    const copyBtnMs = timeIt(5, () => {
      const host = buildHost()
      const nodes = Array.from(host.querySelectorAll('.math-block[data-tex], .math-inline[data-tex]'))
      for (const n of nodes) {
        n.setAttribute('data-fw-math', '1')
        n.classList.add('fw-math-host')
        const btn = document.createElement('button')
        btn.className = 'fw-math-copy'
        btn.textContent = '⧉'
        n.appendChild(btn)
      }
    })

    // 阶段 E：字符串层内联公式 HTML，整树只提交一次 innerHTML
    const inlineMs = timeIt(5, () => {
      const htmlWithMath = safe.replace(/<div class="math-block" data-tex="([^"]*)"><\/div>/g, (_m: string, tex: string) => {
        const decoded = String(tex).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        return `<div class="math-block" data-tex="${tex}">${katex.renderToString(decoded, { displayMode: true, throwOnError: false })}</div>`
      }).replace(/<span class="math-inline" data-tex="([^"]*)"><\/span>/g, (_m: string, tex: string) => {
        const decoded = String(tex).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        return `<span class="math-inline" data-tex="${tex}">${katex.renderToString(decoded, { displayMode: false, throwOnError: false })}</span>`
      })
      const host = document.createElement('div')
      host.innerHTML = htmlWithMath
    })

    // eslint-disable-next-line no-console
    console.log(
      `\n[fine:${PROFILE}] text=${text.length}\n` +
        `  counts: mathHost=${counts.total} block=${counts.blocks} inline=${counts.inlines}\n` +
        `  A katex renderToString (warm) = ${fmt(parseMs)}ms\n` +
        `  B inject into DOM            = ${fmt(injectMs)}ms\n` +
        `  C whole-tree innerHTML       = ${fmt(domParseMs)}ms\n` +
        `  D copy buttons               = ${fmt(copyBtnMs)}ms\n` +
        `  E inline math in string      = ${fmt(inlineMs)}ms  (single innerHTML)`,
    )
  })
})
