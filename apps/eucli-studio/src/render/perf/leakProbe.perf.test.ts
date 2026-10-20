// @vitest-environment happy-dom
//
// 引擎内存长跑：同一输入反复渲染，每 50 轮强制 GC 后记录堆占用，
// 用于区分「真泄漏」与「GC 尚未回收」。
import { beforeAll, describe, it } from 'vitest'
import { installRenderGlobals, createBenchCapabilities } from './benchmark'
import { buildFormulaHeavyFixture } from './streamFixture'
import { createUnifiedAssistantRenderEngine } from '../unified/engine'

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

describe('引擎内存长跑', () => {
  beforeAll(async () => {
    await installRenderGlobals()
  }, 120000)

  it('同输入反复渲染的堆占用走势', { timeout: 600000 }, async () => {
    const gc = (globalThis as any).gc as undefined | (() => void)
    const profile = PROFILES[(PROFILE in PROFILES ? PROFILE : 'smoke') as keyof typeof PROFILES]
    const text = buildFormulaHeavyFixture({ formulaCount: profile.formulaCount, prosePerFormula: profile.prosePerFormula, seed: 20261002 })
    const ROUNDS = 150

    const engine = createUnifiedAssistantRenderEngine(createBenchCapabilities())
    const host = document.createElement('div')
    document.body.appendChild(host)
    engine.renderAssistantInto(host, text)

    const engineSeries = series(gc, ROUNDS, () => engine.renderAssistantInto(host, text))

    // eslint-disable-next-line no-console
    console.log(`\n[leak-engine:${PROFILE}] text=${text.length} rounds=${ROUNDS} gc=${!!gc}\n  engine    : ${engineSeries}`)

    host.remove()
  })
})
