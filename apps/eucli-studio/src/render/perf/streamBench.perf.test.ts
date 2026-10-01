// @vitest-environment happy-dom
//
// 公式流式渲染压力基准。默认「压力档」，可用 PERF_PROFILE=smoke|stress|brutal 切换。
// 输出单次渲染成本随文本增长的曲线，并按预算断言。
//
// 注意：本基准跑在 happy-dom（纯 JS DOM）上，DOMPurify 在此环境比真实浏览器
// （原生 DOM）慢且堆内存增长，属于测试环境的保守估计，非源码问题。
import { beforeAll, describe, expect, it } from 'vitest'
import { createDefaultAssistantRenderEngine } from '../assistantEngineDefault'
import { installRenderGlobals, createBenchCapabilities, runStreamBench, checkPerfBudget, topSlowSamples, type StreamBenchResult, type PerfBudget } from './benchmark'
import { buildFormulaHeavyFixture, buildCumulativePrefixes, countFormulas } from './streamFixture'

const PROFILE = String(process.env.PERF_PROFILE || 'stress').trim() || 'stress'

const PROFILES = {
  smoke: { formulaCount: 20, prosePerFormula: 1, steps: 40 },
  stress: { formulaCount: 100, prosePerFormula: 2, steps: 150 },
  brutal: { formulaCount: 200, prosePerFormula: 3, steps: 260 },
} as const

// 单次渲染预算（happy-dom 保守值；真实浏览器用原生 DOM 会更快）。
// 以 p99/avg 断言，避免被测试环境偶发的 GC 停顿（max 尖峰）误伤。
const BUDGETS: Record<keyof typeof PROFILES, PerfBudget> = {
  smoke: { p99Ms: 40, p95Ms: 30, avgMs: 15 },
  stress: { p99Ms: 120, p95Ms: 70, avgMs: 45 },
  brutal: { p99Ms: 300, p95Ms: 200, avgMs: 120 },
}

type ProfileName = keyof typeof PROFILES

function activeProfile() {
  return PROFILES[(PROFILE in PROFILES ? PROFILE : 'stress') as ProfileName]
}

function logResult(label: string, result: StreamBenchResult) {
  const fmt = (n: number) => n.toFixed(1)
  // eslint-disable-next-line no-console
  console.log(
    `\n[perf:${PROFILE}] ${label}\n` +
      `  formulas=${result.formulaCount} steps=${result.steps}\n` +
      `  total=${fmt(result.totalMs)}ms avg=${fmt(result.avgMs)}ms p50=${fmt(result.p50Ms)}ms p95=${fmt(result.p95Ms)}ms max=${fmt(result.maxMs)}ms\n` +
      `  first=${fmt(result.firstMs)}ms last=${fmt(result.lastMs)}ms maxAtStep=${result.maxStepIndex}`,
  )
}

describe('公式流式渲染压力基准', () => {
  let engine: any

  beforeAll(async () => {
    await installRenderGlobals()
    engine = createDefaultAssistantRenderEngine(createBenchCapabilities())
  }, 120000)

  it('流式前缀渲染：增长曲线 + 预算达标', { timeout: 600000 }, async () => {
    const profile = activeProfile()
    const fixture = buildFormulaHeavyFixture({ formulaCount: profile.formulaCount, prosePerFormula: profile.prosePerFormula, seed: 20261002 })
    const prefixes = buildCumulativePrefixes(fixture, profile.steps)
    expect(countFormulas(fixture)).toBeGreaterThan(profile.formulaCount)

    const result = await runStreamBench({ prefixes, engine })
    logResult('formula-heavy stream', result)

    // 增长健康度：后半段平均不应比前半段失控膨胀（增量生效后应接近 1x）。
    const half = Math.floor(result.samples.length / 2)
    const firstHalf = result.samples.slice(0, half)
    const secondHalf = result.samples.slice(half)
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / Math.max(1, firstHalf.length)
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / Math.max(1, secondHalf.length)
    const ratio = secondAvg / Math.max(0.01, firstAvg)
    // eslint-disable-next-line no-console
    console.log(`  firstHalfAvg=${firstAvg.toFixed(2)}ms secondHalfAvg=${secondAvg.toFixed(2)}ms ratio=${ratio.toFixed(2)}x`)

    const slowest = topSlowSamples(result.samples, 8)
    // eslint-disable-next-line no-console
    console.log(`  slowest(step:ms)=${slowest.map((s) => `${s.index}:${s.ms.toFixed(0)}`).join(' ')}`)

    const violations = checkPerfBudget(result, BUDGETS[(PROFILE in PROFILES ? PROFILE : 'stress') as ProfileName])
    if (violations.length) {
      // eslint-disable-next-line no-console
      console.log(`  BUDGET VIOLATIONS: ${violations.join('; ')}`)
    }
    expect(violations).toEqual([])
  })
})
