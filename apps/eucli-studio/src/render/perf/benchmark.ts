// 公式渲染性能基准内核：在受控 DOM 环境中驱动真实渲染引擎，
// 逐帧渲染流式前缀并采集耗时，得到「单次渲染成本随文本增长」的客观曲线。
// 只做测量与统计，不含任何被测量的业务逻辑。

import { countFormulas } from './streamFixture'

export type RenderGlobals = {
  marked: any
  katex: any
  DOMPurify: any
}

export type StreamBenchResult = {
  steps: number
  formulaCount: number
  totalMs: number
  avgMs: number
  p50Ms: number
  p95Ms: number
  // p99 用于预算断言：既捕捉持续劣化，又不像 max 那样被单次 GC 停顿带偏。
  p99Ms: number
  maxMs: number
  maxStepIndex: number
  firstMs: number
  lastMs: number
  samples: number[]
}

// installRenderGlobals 把渲染引擎依赖的全局对象装到当前 DOM 环境。
// 与 src/render/vendor.ts 在浏览器里做的接线同源，这里只是测试环境的等价装配。
export async function installRenderGlobals(): Promise<RenderGlobals> {
  const w = globalThis as any
  const markedMod: any = await import('marked')
  const dompurifyMod: any = await import('dompurify')
  const katexMod: any = await import('katex')

  const marked = markedMod.marked || markedMod.default
  const katex = katexMod.default
  const dompurifyFactory = dompurifyMod.default
  const DOMPurify = typeof dompurifyFactory === 'function' ? dompurifyFactory(w) : dompurifyFactory

  w.marked = marked
  w.katex = katex
  w.DOMPurify = DOMPurify
  return { marked, katex, DOMPurify }
}

export function createBenchCapabilities() {
  return {
    meta: { appId: 'bench', runtime: 'ui' as const },
    files: { images: {} },
    ui: {},
    clipboard: {},
  } as any
}

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

export function topSlowSamples(samples: number[], count: number): Array<{ index: number; ms: number }> {
  return samples
    .map((ms, index) => ({ index, ms }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, count)
}

function summarize(samples: number[], formulaCount: number): StreamBenchResult {
  const total = samples.reduce((a, b) => a + b, 0)
  const sorted = samples.slice().sort((a, b) => a - b)
  let maxMs = 0
  let maxStepIndex = -1
  for (let i = 0; i < samples.length; i++) {
    if (samples[i] > maxMs) {
      maxMs = samples[i]
      maxStepIndex = i
    }
  }
  return {
    steps: samples.length,
    formulaCount,
    totalMs: total,
    avgMs: samples.length ? total / samples.length : 0,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    maxMs,
    maxStepIndex,
    firstMs: samples.length ? samples[0] : 0,
    lastMs: samples.length ? samples[samples.length - 1] : 0,
    samples,
  }
}

// runStreamBench 用同一棵宿主节点逐帧渲染前缀序列（就地重渲染，模拟真实流式），
// 每帧记录耗时。默认丢弃前 warmup 帧以避开 JIT 预热。
export async function runStreamBench(opts: {
  prefixes: string[]
  engine: any
  host?: HTMLElement
  warmup?: number
}): Promise<StreamBenchResult> {
  const engine = opts.engine
  const prefixes = opts.prefixes
  const warmup = Math.max(0, opts.warmup ?? 1)

  // 预热：在独立宿主上完整跑一遍，暖化 JIT、marked、DOMPurify 与公式 HTML 缓存。
  // 公式缓存挂在引擎实例上，预热后测量轮即反映稳态。
  const warmHost = document.createElement('div')
  for (const p of prefixes) engine.renderAssistantInto(warmHost, p)

  const host = opts.host || document.createElement('div')
  if (opts.host) document.body.appendChild(host)

  const samples: number[] = []
  for (let i = 0; i < prefixes.length; i++) {
    const t0 = performance.now()
    engine.renderAssistantInto(host, prefixes[i])
    const dt = performance.now() - t0
    if (i >= warmup) samples.push(dt)
  }

  const formulaCount = countFormulas(prefixes[prefixes.length - 1] || '')
  return summarize(samples, formulaCount)
}

// perfBudget 是断言辅助：给定结果与预算，返回违规项列表（空即通过）。
// 默认以 p99/avg 断言：p99 捕捉持续劣化，且不像 max 那样被单次 GC 停顿带偏。
export type PerfBudget = {
  p99Ms?: number
  maxMs?: number
  p95Ms?: number
  avgMs?: number
  totalMs?: number
}

export function checkPerfBudget(result: StreamBenchResult, budget: PerfBudget): string[] {
  const violations: string[] = []
  if (budget.p99Ms != null && result.p99Ms > budget.p99Ms) violations.push(`p99Ms ${result.p99Ms.toFixed(1)} > ${budget.p99Ms}`)
  if (budget.maxMs != null && result.maxMs > budget.maxMs) violations.push(`maxMs ${result.maxMs.toFixed(1)} > ${budget.maxMs}`)
  if (budget.p95Ms != null && result.p95Ms > budget.p95Ms) violations.push(`p95Ms ${result.p95Ms.toFixed(1)} > ${budget.p95Ms}`)
  if (budget.avgMs != null && result.avgMs > budget.avgMs) violations.push(`avgMs ${result.avgMs.toFixed(1)} > ${budget.avgMs}`)
  if (budget.totalMs != null && result.totalMs > budget.totalMs) violations.push(`totalMs ${result.totalMs.toFixed(1)} > ${budget.totalMs}`)
  return violations
}
