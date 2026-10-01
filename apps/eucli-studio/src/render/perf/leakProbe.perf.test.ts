// @vitest-environment happy-dom
//
// 逐步骤内存归属：把引擎路径拆成 markdown / sanitize / commit / decorate 四步，
// 各自在复用同一输入、每轮强制 GC 下长跑，定位堆增长的准确环节。
import { beforeAll, describe, it } from 'vitest'
import { installRenderGlobals, createBenchCapabilities } from './benchmark'
import { buildFormulaHeavyFixture } from './streamFixture'
import { createDefaultAssistantRenderEngine } from '../assistantEngineDefault'
import { createMarkdownRenderer } from '../markdown'
import { createHtmlSanitizer } from '../sanitize'
import { commitHtml } from '../domCommit'
import { preprocessAssistantContent } from '../preprocess'
import type { BoolRef } from '../types'

const PROFILE = String(process.env.PERF_PROFILE || 'smoke').trim() || 'smoke'
const PROFILES = {
  smoke: { formulaCount: 20, prosePerFormula: 1 },
  stress: { formulaCount: 100, prosePerFormula: 2 },
} as const

function mb(n: number) {
  return (n / 1024 / 1024).toFixed(1)
}

function series(gc: undefined | (() => void), rounds: number, fn: () => void) {
  const out: number[] = []
  for (let i = 0; i < rounds; i++) {
    fn()
    if (i % 50 === 49) {
      if (gc) gc()
      out.push(process.memoryUsage().heapUsed)
    }
  }
  return out.map(mb).join(' -> ')
}

describe('逐步骤内存归属', () => {
  beforeAll(async () => {
    await installRenderGlobals()
  }, 120000)

  it('markdown / sanitize / commit / decorate', { timeout: 600000 }, async () => {
    const gc = (globalThis as any).gc as undefined | (() => void)
    const profile = PROFILES[(PROFILE in PROFILES ? PROFILE : 'smoke') as keyof typeof PROFILES]
    const text = buildFormulaHeavyFixture({ formulaCount: profile.formulaCount, prosePerFormula: profile.prosePerFormula, seed: 20261002 })
    const ROUNDS = 150

    const markdownRenderer = createMarkdownRenderer({ value: true } as BoolRef)
    const sanitizer = createHtmlSanitizer({ value: false } as BoolRef)
    const pre = preprocessAssistantContent(text, {})
    const md = markdownRenderer.renderMarkdownSource(pre.text)
    const safe = sanitizer.sanitizeHtml(md, 'original')

    const engine = createDefaultAssistantRenderEngine(createBenchCapabilities())
    const host = document.createElement('div')
    document.body.appendChild(host)
    engine.renderAssistantInto(host, text)

    const results: Record<string, string> = {}
    results['markdown'] = series(gc, ROUNDS, () => markdownRenderer.renderMarkdownSource(pre.text))
    results['sanitize'] = series(gc, ROUNDS, () => sanitizer.sanitizeHtml(md, 'original'))
    results['commit'] = series(gc, ROUNDS, () => commitHtml(host, safe))
    results['engine'] = series(gc, ROUNDS, () => engine.renderAssistantInto(host, text))

    // eslint-disable-next-line no-console
    console.log(`\n[leak-steps:${PROFILE}] text=${text.length} rounds=${ROUNDS} gc=${!!gc}\n` +
      Object.entries(results).map(([k, v]) => `  ${k.padEnd(10)}: ${v}`).join('\n'))
  })
})
