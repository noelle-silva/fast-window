// @vitest-environment happy-dom
//
// 引擎性能对比基准：同一份流式内容，分别用旧引擎（自研字符串管线）与
// 新引擎（unified 管线）逐帧渲染，对比耗时分布。
//
// 关注点：unified 每次全文重解析 + 多次树遍历，是否比旧引擎明显更慢。
import { beforeAll, describe, it } from 'vitest'
import { createDefaultAssistantRenderEngine } from '../assistantEngineDefault'
import { createUnifiedAssistantRenderEngine } from '../unified/engine'
import { installRenderGlobals, createBenchCapabilities, runStreamBench, type StreamBenchResult } from './benchmark'
import { buildFormulaHeavyFixture, buildCumulativePrefixes, countFormulas } from './streamFixture'

const PROFILE = String(process.env.PERF_PROFILE || 'stress').trim() || 'stress'

const PROFILES = {
  smoke: { formulaCount: 20, prosePerFormula: 1, steps: 40 },
  stress: { formulaCount: 100, prosePerFormula: 2, steps: 150 },
  brutal: { formulaCount: 200, prosePerFormula: 3, steps: 260 },
} as const

type ProfileName = keyof typeof PROFILES

const activeProfile = () => PROFILES[(PROFILE in PROFILES ? PROFILE : 'stress') as ProfileName]

function fmt(n: number) {
  return n.toFixed(1)
}

function report(label: string, r: StreamBenchResult) {
  // eslint-disable-next-line no-console
  console.log(
    `\n[compare:${PROFILE}] ${label}\n` +
      `  steps=${r.steps} formulas=${r.formulaCount}\n` +
      `  total=${fmt(r.totalMs)}ms avg=${fmt(r.avgMs)}ms p50=${fmt(r.p50Ms)}ms p95=${fmt(r.p95Ms)}ms p99=${fmt(r.p99Ms)}ms max=${fmt(r.maxMs)}ms\n` +
      `  first=${fmt(r.firstMs)}ms last=${fmt(r.lastMs)}ms`,
  )
}

describe('引擎性能对比：legacy vs unified', () => {
  beforeAll(async () => {
    await installRenderGlobals()
  }, 120000)

  it('公式密集内容 · 流式前缀渲染对比', { timeout: 600000 }, async () => {
    const profile = activeProfile()
    const fixture = buildFormulaHeavyFixture({
      formulaCount: profile.formulaCount,
      prosePerFormula: profile.prosePerFormula,
      seed: 20261002,
    })
    const prefixes = buildCumulativePrefixes(fixture, profile.steps)
    const formulas = countFormulas(fixture)

    const legacy = createDefaultAssistantRenderEngine(createBenchCapabilities())
    const unified = createUnifiedAssistantRenderEngine(createBenchCapabilities())

    const legacyResult = await runStreamBench({ prefixes, engine: legacy })
    const unifiedResult = await runStreamBench({ prefixes, engine: unified })

    report('legacy（旧引擎）', legacyResult)
    report('unified（新引擎）', unifiedResult)

    const ratio = (a: number, b: number) => (b > 0 ? a / b : 0)
    // eslint-disable-next-line no-console
    console.log(
      `\n[compare:${PROFILE}] 新/旧 倍数（>1 表示新引擎更慢）\n` +
        `  avg=${ratio(unifiedResult.avgMs, legacyResult.avgMs).toFixed(2)}x ` +
        `p50=${ratio(unifiedResult.p50Ms, legacyResult.p50Ms).toFixed(2)}x ` +
        `p95=${ratio(unifiedResult.p95Ms, legacyResult.p95Ms).toFixed(2)}x ` +
        `p99=${ratio(unifiedResult.p99Ms, legacyResult.p99Ms).toFixed(2)}x ` +
        `total=${ratio(unifiedResult.totalMs, legacyResult.totalMs).toFixed(2)}x\n` +
        `  formulas=${formulas}`,
    )

    // 增长健康度：两引擎的后半段都不应比前半段失控膨胀。
    const growth = (r: StreamBenchResult) => {
      const half = Math.floor(r.samples.length / 2)
      const first = r.samples.slice(0, half)
      const second = r.samples.slice(half)
      const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
      return avg(second) / Math.max(0.01, avg(first))
    }
    // eslint-disable-next-line no-console
    console.log(`  growth legacy=${growth(legacyResult).toFixed(2)}x unified=${growth(unifiedResult).toFixed(2)}x`)
  })
})
