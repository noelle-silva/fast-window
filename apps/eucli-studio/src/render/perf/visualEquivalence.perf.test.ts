// @vitest-environment happy-dom
//
// 视觉等价性验证（主人的硬约束：性能提升不得改变视觉与交互）：
// 用「流式逐步增量提交」渲染出来的最终 DOM，必须与「一次性完整渲染」的结果
// 在结构、属性、文本、公式、按钮数量上完全一致。
import { beforeAll, describe, it, expect } from 'vitest'
import { installRenderGlobals, createBenchCapabilities } from './benchmark'
import { buildFormulaHeavyFixture, buildCumulativePrefixes } from './streamFixture'
import { createDefaultAssistantRenderEngine } from '../assistantEngineDefault'

// 把 DOM 序列化成与实现无关的规范签名（含装饰，用于比对最终视觉）。
function serialize(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return `#text:${JSON.stringify(node.textContent)}`
  if (node.nodeType === Node.COMMENT_NODE) return `#comment:${JSON.stringify(node.textContent)}`
  if (node.nodeType !== Node.ELEMENT_NODE) return `#${node.nodeType}`
  const el = node as Element
  const attrs = Array.from(el.attributes)
    .map((a) => `${a.name}=${JSON.stringify(a.value)}`)
    .sort()
    .join(' ')
  const kids = Array.from(el.childNodes).map(serialize).join('')
  return `<${el.tagName.toLowerCase()} ${attrs}>[${kids}]`
}

const FIXTURES: Record<string, string> = {
  formulaHeavy: buildFormulaHeavyFixture({ formulaCount: 15, prosePerFormula: 1, seed: 42 }),
  plainMarkdown: '# 标题\n\n一段普通文字，含 `行内代码` 与 $x^2$。\n\n- 列表一\n- 列表二\n\n```js\nconst a = 1\n```\n\n> 引用\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n末尾。\n',
  htmlBlock: '<div class="box">\n  <span>hello</span>\n</div>\n\n普通段落 $y = x$。\n',
  tablesAndMath: '| 公式 | 说明 |\n| --- | --- |\n| $a^2+b^2=c^2$ | 勾股 |\n| $$\\int_0^1 x\\,dx$$ | 积分 |\n',
}

describe('视觉等价性（增量提交 == 完整渲染）', () => {
  beforeAll(async () => {
    await installRenderGlobals()
  }, 120000)

  for (const [name, text] of Object.entries(FIXTURES)) {
    it(`${name}：流式增量结果与完整渲染一致`, { timeout: 120000 }, async () => {
      const engine = createDefaultAssistantRenderEngine(createBenchCapabilities())

      // A：流式逐步增量提交
      const streamHost = document.createElement('div')
      const prefixes = buildCumulativePrefixes(text, 25)
      for (const p of prefixes) engine.renderAssistantInto(streamHost, p)

      // B：一次性完整渲染（新宿主，走同一条 renderAssistantInto 的完整路径）
      const fullHost = document.createElement('div')
      engine.renderAssistantInto(fullHost, text)

      const streamSig = Array.from(streamHost.childNodes).map(serialize).join('\n')
      const fullSig = Array.from(fullHost.childNodes).map(serialize).join('\n')

      if (streamSig !== fullSig) {
        let diffAt = -1
        const n = Math.min(streamSig.length, fullSig.length)
        for (let i = 0; i < n; i++) if (streamSig[i] !== fullSig[i]) { diffAt = i; break }
        // eslint-disable-next-line no-console
        console.log(`\n[visual:${name}] diffAt=${diffAt}\n  stream=${streamSig.slice(Math.max(0, diffAt - 60), diffAt + 60)}\n  full  =${fullSig.slice(Math.max(0, diffAt - 60), diffAt + 60)}`)
      }
      expect(streamSig).toBe(fullSig)
    })
  }
})
