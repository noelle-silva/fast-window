// @vitest-environment happy-dom
//
// 视觉等价性验证（主人的硬约束：性能提升不得改变视觉与交互）：
// 用「流式逐步增量提交」渲染出来的最终 DOM，必须与「一次性完整渲染」的结果
// 在结构、属性、文本、公式、图表、贴纸、图片、按钮数量上完全一致。
//
// 守护范围：公式 / 图表 / 贴纸 / 图片 / HTML 五种渲染能力全覆盖。
import { beforeAll, describe, it, expect } from 'vitest'
import { installRenderGlobals, createBenchCapabilities } from './benchmark'
import { buildFormulaHeavyFixture, buildCumulativePrefixes } from './streamFixture'
import { createDefaultAssistantRenderEngine } from '../assistantEngineDefault'

// 图表能力每次渲染会生成唯一 id（uid('mm')），它派生出的所有内部节点 id 与
// 引用都含这个易变令牌。它是非视觉差异，守护必须归一化后才能比较真正的画面。
function normalizeVolatile(value: string): string {
  return String(value || '').replace(/mm_[a-z0-9_]+/g, 'MMID')
}

// 把 DOM 序列化成与实现无关的规范签名（含装饰，用于比对最终视觉）。
function serialize(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return `#text:${JSON.stringify(normalizeVolatile(String(node.textContent || '')))}`
  if (node.nodeType === Node.COMMENT_NODE) return `#comment:${JSON.stringify(normalizeVolatile(String(node.textContent || '')))}`
  if (node.nodeType !== Node.ELEMENT_NODE) return `#${node.nodeType}`
  const el = node as Element
  const attrs = Array.from(el.attributes)
    .map((a) => `${a.name}=${JSON.stringify(normalizeVolatile(a.value))}`)
    .sort()
    .join(' ')
  const kids = Array.from(el.childNodes).map(serialize).join('')
  return `<${el.tagName.toLowerCase()} ${attrs}>[${kids}]`
}

// 能力开关：贴纸开启并提供路径解析，图片与 HTML 走默认能力。
const RENDER_OPTIONS = {
  stickersEnabled: true,
  getStickerPath: (category: string, name: string) => `stickers/${category}/${name}.png`,
}

// 等待异步产出收尾：图表能力的渲染是异步的，守护必须比对稳定后的画面。
// 收尾判据：地盘内不再有未完成的图表占位（data-mermaid="0"）。
async function waitForAsyncSettle(host: HTMLElement, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const pending = host.querySelectorAll('.mermaid-block[data-mermaid="0"]').length
    if (!pending) return
    if (Date.now() > deadline) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

const FIXTURES: Record<string, string> = {
  // 公式能力
  formulaHeavy: buildFormulaHeavyFixture({ formulaCount: 15, prosePerFormula: 1, seed: 42 }),
  // HTML 能力 + 公式
  plainMarkdown: '# 标题\n\n一段普通文字，含 `行内代码` 与 $x^2$。\n\n- 列表一\n- 列表二\n\n```js\nconst a = 1\n```\n\n> 引用\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n末尾。\n',
  htmlBlock: '<div class="box">\n  <span>hello</span>\n</div>\n\n普通段落 $y = x$。\n',
  tablesAndMath: '| 公式 | 说明 |\n| --- | --- |\n| $a^2+b^2=c^2$ | 勾股 |\n| $$\\int_0^1 x\\,dx$$ | 积分 |\n',
  // 图表能力：已闭合围栏进入成品态，未闭合围栏保持草稿态
  mermaidClosed: '```mermaid\ngraph TD\n  A --> B\n```\n\n图表之后 $z = 1$。\n',
  mermaidStreaming: '```mermaid\ngraph TD\n  A --> B',
  // 贴纸能力
  stickers: '打招呼 [[sticker:emoji/hi]] 再来一个 [[sticker:emoji/ok:64]]。\n\n公式 $a + b$。\n',
  // 图片能力
  images: '![示例图](https://example.com/a.png)\n\n引用图 <img data-ref-img="sessions/roles/x/a.png" src="data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=" />\n',
}

describe('视觉等价性（增量提交 == 完整渲染，覆盖全部能力）', () => {
  beforeAll(async () => {
    await installRenderGlobals()
  }, 120000)

  for (const [name, text] of Object.entries(FIXTURES)) {
    it(`${name}：流式增量结果与完整渲染一致`, { timeout: 120000 }, async () => {
      const engine = createDefaultAssistantRenderEngine(createBenchCapabilities())

      // A：流式逐步增量提交
      const streamHost = document.createElement('div')
      const prefixes = buildCumulativePrefixes(text, 25)
      for (const p of prefixes) engine.renderAssistantInto(streamHost, p, RENDER_OPTIONS)

      // B：一次性完整渲染（新宿主，走同一条 renderAssistantInto 的完整路径）
      const fullHost = document.createElement('div')
      engine.renderAssistantInto(fullHost, text, RENDER_OPTIONS)

      // 等待异步能力（图表）收尾后再比对稳定画面。
      await waitForAsyncSettle(streamHost)
      await waitForAsyncSettle(fullHost)

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
