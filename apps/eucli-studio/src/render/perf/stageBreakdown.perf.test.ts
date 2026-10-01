// @vitest-environment happy-dom
//
// 渲染阶段分解诊断：把「一次流式重渲染」拆成 Markdown 解析 / 消毒 / KaTeX 生成 /
// 整树 DOM 重建 几个阶段分别计时，定位真正的成本大头。
// 用 PERF_PROFILE=smoke|stress|brutal 控制素材规模。
import { beforeAll, describe, it } from 'vitest'
import { installRenderGlobals, createBenchCapabilities } from './benchmark'
import { buildFormulaHeavyFixture } from './streamFixture'
import { createDefaultAssistantRenderEngine } from '../assistantEngineDefault'
import { createMarkdownRenderer } from '../markdown'
import { createHtmlSanitizer } from '../sanitize'
import type { BoolRef } from '../types'

const PROFILE = String(process.env.PERF_PROFILE || 'stress').trim() || 'stress'
const PROFILES = {
  smoke: { formulaCount: 20, prosePerFormula: 1 },
  stress: { formulaCount: 120, prosePerFormula: 2 },
  brutal: { formulaCount: 400, prosePerFormula: 3 },
} as const

function fmt(n: number) {
  return n.toFixed(2)
}

// 多次测量取平均，降低噪声。
function timeIt(times: number, fn: () => void): number {
  fn()
  const t0 = performance.now()
  for (let i = 0; i < times; i++) fn()
  return (performance.now() - t0) / times
}

describe('渲染阶段分解诊断', () => {
  beforeAll(async () => {
    await installRenderGlobals()
  }, 120000)

  it('定位各阶段耗时占比', { timeout: 300000 }, async () => {
    const profile = PROFILES[(PROFILE in PROFILES ? PROFILE : 'stress') as keyof typeof PROFILES]
    const text = buildFormulaHeavyFixture({ formulaCount: profile.formulaCount, prosePerFormula: profile.prosePerFormula, seed: 20261002 })

    const markedConfigured: BoolRef = { value: false }
    const markdownRenderer = createMarkdownRenderer(markedConfigured)
    const domPurifyHooked: BoolRef = { value: false }
    const sanitizer = createHtmlSanitizer(domPurifyHooked)

    // 阶段 1：Markdown -> HTML
    const mdMs = timeIt(5, () => markdownRenderer.renderMarkdownSource(text))
    const mdHtml = markdownRenderer.renderMarkdownSource(text)

    // 阶段 2：HTML -> 消毒 HTML
    const sanitizeMs = timeIt(5, () => sanitizer.sanitizeHtml(mdHtml, 'original'))
    const safeHtml = sanitizer.sanitizeHtml(mdHtml, 'original')

    // 阶段 3：消毒后 HTML -> 浏览器 DOM 解析（整树重建）
    const host = document.createElement('div')
    const parseMs = timeIt(5, () => {
      host.innerHTML = safeHtml
    })

    // 阶段 4：完整引擎渲染（含公式填充与增强）
    const engine = createDefaultAssistantRenderEngine(createBenchCapabilities())
    const engineHost = document.createElement('div')
    const engineMs = timeIt(5, () => engine.renderAssistantInto(engineHost, text))

    const total = mdMs + sanitizeMs + parseMs
    // eslint-disable-next-line no-console
    console.log(
      `\n[stage:${PROFILE}] text=${text.length} chars\n` +
        `  markdown   = ${fmt(mdMs)}ms\n` +
        `  sanitize   = ${fmt(sanitizeMs)}ms\n` +
        `  dom parse  = ${fmt(parseMs)}ms  (innerHTML 整树重建)\n` +
        `  sum(m/s/d) = ${fmt(total)}ms\n` +
        `  full engine= ${fmt(engineMs)}ms  (warm math cache)\n` +
        `  overhead   = ${fmt(engineMs - total)}ms`,
    )
  })
})
