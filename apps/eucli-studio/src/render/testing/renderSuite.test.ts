// @vitest-environment happy-dom
//
// 渲染体系测试套件：对全部渲染能力（公式 / 图表 / 贴纸 / 图片 / HTML）做
// 统一验证。回答三件事：
//   1. 渲染是否正确（能力成品是否按预期出现）；
//   2. 是否被破坏（流式增量最终画面 == 一次性完整画面）；
//   3. 契约是否一致（半成品保持草稿态、越界内容不被认领）。
//
// 素材库见 ./fixtures，共享工具见 ./dom 与 ./capabilities。
import { beforeAll, describe, expect, it } from 'vitest'
import { installRenderGlobals } from './globals'
import { createRenderTestCapabilities } from './capabilities'
import { serializeChildren, waitForAsyncSettle, renderInto } from './dom'
import { ALL_FIXTURES, buildCumulativePrefixes, type Fixture } from './fixtures'
import { createDefaultAssistantRenderEngine } from '../assistantEngineDefault'

// 测试基准：unsafe（裸奔模式，与应用实际使用 HTML/SVG 富渲染的环境一致），
// 以此隔离「内容形态保护是否正确」与「安全清理策略」，让本套件专注渲染本身。
const RENDER_OPTIONS = {
  stickersEnabled: true,
  getStickerPath: (category: string, name: string) => `stickers/${category}/${name}.png`,
  renderSafetyPolicy: 'unsafe' as const,
}

function makeEngine() {
  return createDefaultAssistantRenderEngine(createRenderTestCapabilities())
}

describe('渲染体系：能力正确性', () => {
  beforeAll(async () => {
    await installRenderGlobals()
  }, 120000)

  for (const fixture of ALL_FIXTURES) {
    it(`${fixture.name}：成品结构符合预期`, { timeout: 60000 }, async () => {
      const engine = makeEngine()
      const host = renderInto(engine, fixture.text, RENDER_OPTIONS)
      await waitForAsyncSettle(host)

      for (const [selector, min] of Object.entries(fixture.expect || {})) {
        const count = host.querySelectorAll(selector).length
        expect(count, `选择器 ${selector} 期望 >= ${min}，实际 ${count}`).toBeGreaterThanOrEqual(min)
      }

      // 结构禁止断言：捕获不该出现的注入（如 HTML 块被 Markdown 包进 <p>）。
      for (const [selector, max] of Object.entries(fixture.forbid || {})) {
        const count = host.querySelectorAll(selector).length
        expect(count, `选择器 ${selector} 期望 <= ${max}，实际 ${count}`).toBeLessThanOrEqual(max)
      }

      host.remove()
    })
  }
})

describe('渲染体系：流式不破坏（增量 == 完整）', () => {
  beforeAll(async () => {
    await installRenderGlobals()
  }, 120000)

  for (const fixture of ALL_FIXTURES) {
    it(`${fixture.name}：流式增量最终画面与完整渲染一致`, { timeout: 60000 }, async () => {
      const engine = makeEngine()

      // A：流式逐步增量提交
      const streamHost = document.createElement('div')
      document.body.appendChild(streamHost)
      for (const p of buildCumulativePrefixes(fixture.text, 20)) {
        engine.renderAssistantInto(streamHost, p, RENDER_OPTIONS)
      }

      // B：一次性完整渲染
      const fullHost = renderInto(engine, fixture.text, RENDER_OPTIONS)

      await waitForAsyncSettle(streamHost)
      await waitForAsyncSettle(fullHost)

      const streamSig = serializeChildren(streamHost)
      const fullSig = serializeChildren(fullHost)

      if (streamSig !== fullSig) {
        let diffAt = -1
        const n = Math.min(streamSig.length, fullSig.length)
        for (let i = 0; i < n; i++) if (streamSig[i] !== fullSig[i]) { diffAt = i; break }
        // eslint-disable-next-line no-console
        console.log(`\n[stream-equiv:${fixture.name}] diffAt=${diffAt}\n  stream=${streamSig.slice(Math.max(0, diffAt - 80), diffAt + 80)}\n  full  =${fullSig.slice(Math.max(0, diffAt - 80), diffAt + 80)}`)
      }
      expect(streamSig).toBe(fullSig)

      streamHost.remove()
      fullHost.remove()
    })
  }
})

describe('渲染体系：契约一致性', () => {
  beforeAll(async () => {
    await installRenderGlobals()
  }, 120000)

  const draftFixtures = ALL_FIXTURES.filter((f: Fixture) => !f.complete)
  for (const fixture of draftFixtures) {
    it(`${fixture.name}：半成品保持草稿态，不进入专用渲染`, { timeout: 60000 }, async () => {
      const engine = makeEngine()
      const host = renderInto(engine, fixture.text, RENDER_OPTIONS)
      await waitForAsyncSettle(host)

      // 未闭合的图表不得产出成品。
      expect(host.querySelectorAll('.mermaid-block[data-mermaid="1"]').length).toBe(0)

      host.remove()
    })
  }
})
