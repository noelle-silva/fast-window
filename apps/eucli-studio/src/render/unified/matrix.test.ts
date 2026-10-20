// @vitest-environment happy-dom
//
// 组合矩阵测试：内容类型 × 所在位置 的交叉覆盖。
//
// 矩阵维度：
//   内容：表情包 / 行内公式 / 块级公式 / mermaid 围栏 / 普通代码块 / HTML 卡片
//   位置：纯文本 / HTML 块内 / 嵌套 HTML 块内 / 代码块内 / 行内代码内
//
// 期望规则：块外、块内、嵌套 → 正常渲染；代码块内、行内代码内 → 一律不认领。
import { beforeAll, describe, expect, it } from 'vitest'
import { installRenderGlobals } from '../testing/globals'
import { createRenderTestCapabilities } from '../testing/capabilities'
import { renderInto, waitForAsyncSettle } from '../testing/dom'
import { createUnifiedAssistantRenderEngine } from './engine'

const OPTIONS = {
  stickersEnabled: true,
  getStickerPath: (category: string, name: string) => `stickers/${category}/${name}.png`,
  renderSafetyPolicy: 'unsafe' as const,
}

function makeEngine() {
  return createUnifiedAssistantRenderEngine(createRenderTestCapabilities())
}

type Position = 'plain' | 'block' | 'nested' | 'code' | 'inlineCode'

function wrap(content: string, position: Position): string {
  switch (position) {
    case 'plain':
      return content
    case 'block':
      return `<div class="card">\n${content}\n</div>`
    case 'nested':
      return `<div class="outer">\n<div class="inner">\n${content}\n</div>\n</div>`
    case 'code':
      return '```\n' + content + '\n```'
    case 'inlineCode':
      return '`' + content + '`'
  }
}

type ContentCase = {
  key: string
  text: string
  selector: string
  positions: Position[]
}

const CONTENTS: ContentCase[] = [
  {
    key: '表情包',
    text: '[[sticker:doro/x]]',
    selector: 'img.fw-sticker',
    positions: ['plain', 'block', 'nested', 'code', 'inlineCode'],
  },
  {
    key: '行内公式',
    text: '$a^2+b^2=c^2$',
    selector: '.math-inline[data-tex]',
    positions: ['plain', 'block', 'nested', 'code', 'inlineCode'],
  },
  {
    key: '块级公式',
    text: '$$E=mc^2$$',
    selector: '.math-block[data-tex]',
    positions: ['plain', 'block', 'nested', 'code', 'inlineCode'],
  },
  {
    key: 'mermaid 围栏',
    text: '```mermaid\ngraph TD\n  A-->B\n```',
    selector: '.mermaid-block[data-mermaid="1"]',
    // 围栏套围栏会破坏语法，代码位置不测。
    positions: ['plain', 'block', 'nested'],
  },
  {
    key: '普通代码块',
    text: '```js\nconst a = 1\n```',
    selector: 'pre code.language-js',
    positions: ['plain', 'block', 'nested'],
  },
  {
    key: 'HTML 卡片',
    text: '<div class="inner-card">卡片</div>',
    selector: '.inner-card',
    positions: ['plain', 'block', 'nested', 'code', 'inlineCode'],
  },
]

describe('组合矩阵：内容 × 位置', () => {
  beforeAll(async () => {
    await installRenderGlobals()
  }, 120000)

  for (const content of CONTENTS) {
    for (const position of content.positions) {
      it(`${content.key} @ ${position}`, async () => {
        const host = renderInto(makeEngine(), wrap(content.text, position), OPTIONS)
        await waitForAsyncSettle(host)

        const count = host.querySelectorAll(content.selector).length
        const shouldRender = position !== 'code' && position !== 'inlineCode'

        if (shouldRender) {
          expect(count, `期望渲染 ${content.selector}，实际 ${count}`).toBeGreaterThanOrEqual(1)
        } else {
          expect(count, `期望不渲染 ${content.selector}，实际 ${count}`).toBe(0)
        }

        host.remove()
      })
    }
  }
})

describe('压力测试', () => {
  beforeAll(async () => {
    await installRenderGlobals()
  }, 120000)

  it('100 个表情包同时渲染', async () => {
    const text = Array.from({ length: 100 }, (_, i) => `[[sticker:doro/s${i}]]`).join(' ')
    const host = renderInto(makeEngine(), text, OPTIONS)
    await waitForAsyncSettle(host)
    expect(host.querySelectorAll('img.fw-sticker').length).toBe(100)
    host.remove()
  })

  it('50 个公式同时渲染', async () => {
    const text = Array.from({ length: 50 }, (_, i) => `$x_{${i}}^2$`).join(' ')
    const host = renderInto(makeEngine(), text, OPTIONS)
    await waitForAsyncSettle(host)
    expect(host.querySelectorAll('.math-inline[data-tex]').length).toBe(50)
    host.remove()
  })

  it('10 个 mermaid 图表同时渲染', async () => {
    const text = Array.from({ length: 10 }, (_, i) => `\`\`\`mermaid\ngraph TD\n  A${i}-->B${i}\n\`\`\``).join('\n\n')
    const host = renderInto(makeEngine(), text, OPTIONS)
    await waitForAsyncSettle(host)
    expect(host.querySelectorAll('.mermaid-block[data-mermaid="1"]').length).toBe(10)
    host.remove()
  })

  it('10 层嵌套 HTML 里的表情包', async () => {
    let inner = '[[sticker:doro/deep]]'
    for (let i = 0; i < 10; i++) inner = `<div class="lv${i}">\n${inner}\n</div>`
    const host = renderInto(makeEngine(), inner, OPTIONS)
    await waitForAsyncSettle(host)
    expect(host.querySelectorAll('img.fw-sticker').length).toBe(1)
    host.remove()
  })

  it('长文本 + 混合内容', async () => {
    const parts: string[] = []
    for (let i = 0; i < 30; i++) {
      parts.push(`第 ${i} 段：表情包 [[sticker:doro/x${i}]]，公式 $a_{${i}}$。`)
      if (i % 10 === 0) parts.push(`<div class="card">\n[[sticker:doro/in${i}]] $b_{${i}}$\n</div>`)
    }
    const text = parts.join('\n\n')
    const host = renderInto(makeEngine(), text, OPTIONS)
    await waitForAsyncSettle(host)
    expect(host.querySelectorAll('img.fw-sticker').length).toBe(33)
    expect(host.querySelectorAll('.math-inline[data-tex]').length).toBe(33)
    host.remove()
  })
})
