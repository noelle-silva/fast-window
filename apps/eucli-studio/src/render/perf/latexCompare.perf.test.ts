// @vitest-environment happy-dom
//
// LaTeX 专项性能对比：纯公式内容（无白话叙述），新旧引擎逐帧对比。
// 同时校验两边最终渲染出的 KaTeX 数量一致（功能等价前提）。
import { beforeAll, describe, it } from 'vitest'
import { createDefaultAssistantRenderEngine } from '../assistantEngineDefault'
import { createUnifiedAssistantRenderEngine } from '../unified/engine'
import { installRenderGlobals, createBenchCapabilities, runStreamBench } from './benchmark'
import { buildFormulaHeavyFixture, buildCumulativePrefixes, countFormulas } from './streamFixture'

const ROUNDS = 2

function median(xs: number[]) {
  const s = xs.slice().sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function collect() {
  const g = (globalThis as any).gc
  if (typeof g === 'function') g()
}

describe('LaTeX 专项：新旧引擎对比', () => {
  beforeAll(async () => {
    await installRenderGlobals()
  }, 120000)

  it('纯公式内容 · 性能 + 功能等价', { timeout: 900000 }, async () => {
    // prosePerFormula: 0 → 纯公式，不含白话，聚焦 LaTeX 本身
    const fixture = buildFormulaHeavyFixture({ formulaCount: 60, prosePerFormula: 0, seed: 20261002 })
    const prefixes = buildCumulativePrefixes(fixture, 100)
    const formulas = countFormulas(fixture)

    // ---- 功能等价：最终渲染出的公式数量必须一致 ----
    const hostA = document.createElement('div')
    const hostB = document.createElement('div')
    createDefaultAssistantRenderEngine(createBenchCapabilities()).renderAssistantInto(hostA, fixture)
    createUnifiedAssistantRenderEngine(createBenchCapabilities()).renderAssistantInto(hostB, fixture)

    const stat = (host: HTMLElement) => ({
      katex: host.querySelectorAll('.katex').length,
      inline: host.querySelectorAll('.math-inline[data-tex]').length,
      block: host.querySelectorAll('.math-block[data-tex]').length,
      copyBtn: host.querySelectorAll('button.fw-math-copy').length,
    })
    const a = stat(hostA)
    const b = stat(hostB)
    // eslint-disable-next-line no-console
    console.log(
      `\n[latex] formulas(源文本)=${formulas}\n` +
        `  legacy : katex=${a.katex} inline=${a.inline} block=${a.block} copyBtn=${a.copyBtn}\n` +
        `  unified: katex=${b.katex} inline=${b.inline} block=${b.block} copyBtn=${b.copyBtn}`,
    )
    hostA.remove()
    hostB.remove()

    // ---- 性能：交替多轮取中位数 ----
    const legacyAvg: number[] = []
    const unifiedAvg: number[] = []

    for (let round = 0; round < ROUNDS; round++) {
      const legacy = createDefaultAssistantRenderEngine(createBenchCapabilities())
      const unified = createUnifiedAssistantRenderEngine(createBenchCapabilities())

      if (round % 2 === 0) {
        legacyAvg.push((await runStreamBench({ prefixes, engine: legacy })).avgMs)
        collect()
        unifiedAvg.push((await runStreamBench({ prefixes, engine: unified })).avgMs)
        collect()
      } else {
        unifiedAvg.push((await runStreamBench({ prefixes, engine: unified })).avgMs)
        collect()
        legacyAvg.push((await runStreamBench({ prefixes, engine: legacy })).avgMs)
        collect()
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `\n[latex] 各轮 avg  legacy=${legacyAvg.map((x) => x.toFixed(1)).join(', ')} → 中位 ${median(legacyAvg).toFixed(1)}ms\n` +
        `[latex] 各轮 avg unified=${unifiedAvg.map((x) => x.toFixed(1)).join(', ')} → 中位 ${median(unifiedAvg).toFixed(1)}ms\n` +
        `[latex] 新/旧 = ${(median(unifiedAvg) / median(legacyAvg)).toFixed(2)}x`,
    )
  })
})
