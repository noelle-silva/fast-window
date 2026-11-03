import { describe, expect, it } from 'vitest'
import katex from 'katex'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeStringify from 'rehype-stringify'

import { preprocessHtmlIndentation } from '../markdown'
import { protectMath } from '../unified/mathProtect'
import { protectHtmlBlocks, demoteOpenFences } from '../unified/htmlProtect'
import { RENDER_PLUGINS, type RenderPluginContext } from '../unified/plugins/registry'
import { createMarkdownComputer } from './compute'

// ============================================================================
// 等价性测试：Worker 纯计算层 vs 测试进程内直接跑同一条 unified 管线。
//
// 参考实现按 engine.ts 的纯计算顺序独立搭建，不复用 compute.ts 的编排，
// 因此能发现插件顺序、raw 开关或保护步骤的任何漂移。
// 本文件不声明 DOM 环境，计算层必须在纯 Node 环境里跑通。
// ============================================================================

function createReferenceRenderer() {
  const ctx: RenderPluginContext = {
    stickersEnabled: false,
    getStickerPath: null,
    mathClaims: [],
    htmlBlocks: [],
  }

  function applyPlugins(processor: any, phase: 'before-raw' | 'after-raw', withRaw: boolean) {
    let p = processor
    for (const entry of RENDER_PLUGINS) {
      if (entry.phase !== phase) continue
      if (entry.requiresRaw && !withRaw) continue
      p = entry.options ? p.use(entry.plugin, entry.options(ctx)) : p.use(entry.plugin)
    }
    return p
  }

  function createProcessor(withRaw: boolean) {
    let p = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkBreaks)
      .use(remarkRehype, { allowDangerousHtml: true })

    p = applyPlugins(p, 'before-raw', withRaw)
    if (withRaw) p = p.use(rehypeRaw)
    p = applyPlugins(p, 'after-raw', withRaw)

    return p.use(rehypeStringify, { allowDangerousHtml: true })
  }

  const processorWithRaw = createProcessor(true)
  const processorNoRaw = createProcessor(false)

  return (source: string): string => {
    const noIndent = preprocessHtmlIndentation(source)
    const mathProtected = protectMath(noIndent)
    ctx.mathClaims = mathProtected.claims
    const htmlProtected = protectHtmlBlocks(mathProtected.text)
    ctx.htmlBlocks = htmlProtected.blocks
    const finalSource = demoteOpenFences(htmlProtected.text)
    const processor = ctx.htmlBlocks.length ? processorWithRaw : processorNoRaw
    return String(processor.processSync(finalSource))
  }
}

type Case = {
  name: string
  source: string
  includes: string[]
}

const CASES: Case[] = [
  {
    name: '普通中文',
    source: '你好，世界！\n\n第二段。',
    includes: ['<p>你好，世界！</p>', '<p>第二段。</p>'],
  },
  {
    name: '列表',
    source: '- 一\n- 二\n  - 二之一',
    includes: ['<ul>', '<li>一</li>', '<li>二', '<li>二之一</li>'],
  },
  {
    name: '代码块',
    source: '```ts\nconst a = 1 < 2 && 3 > 2\n```',
    includes: ['<pre><code class="language-ts">', '&lt;', '&amp;&amp;', '&gt;'],
  },
  {
    name: '表格',
    source: '| 名称 | 值 |\n| --- | --- |\n| 甲 | 1 |',
    includes: ['<table>', '<thead>', '<td>甲</td>'],
  },
  {
    name: '行内公式',
    source: '公式 $a^2+b^2=c^2$ 结束',
    includes: ['<span class="math-inline" data-tex="a^2+b^2=c^2"></span>'],
  },
  {
    name: '展示公式',
    source: '$$\n\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}\n$$',
    includes: ['<div class="math-block"', 'data-tex="\\begin{pmatrix}', '\\end{pmatrix}"'],
  },
  {
    name: 'HTML 块',
    source: '<div class="card">\n  <span>你好</span>\n\n  世界\n</div>',
    includes: ['<div class="card">', '<span>你好</span>', '世界'],
  },
]

describe('Worker compute 与主线程 unified 管线等价', () => {
  const computer = createMarkdownComputer()
  const reference = createReferenceRenderer()

  for (const item of CASES) {
    it(item.name, () => {
      const html = computer.renderMarkdown(item.source)
      expect(html).toBe(reference(item.source))
      for (const part of item.includes) expect(html).toContain(part)
    })
  }
})

describe('Worker compute 的 KaTeX 输出', () => {
  const computer = createMarkdownComputer()

  it('行内公式与直接调用 KaTeX 一致', () => {
    const tex = 'a^2+b^2=c^2'
    expect(computer.renderMath(tex, false)).toBe(
      katex.renderToString(tex, { displayMode: false, throwOnError: false }),
    )
  })

  it('展示公式与直接调用 KaTeX 一致', () => {
    const tex = '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}'
    expect(computer.renderMath(tex, true)).toBe(
      katex.renderToString(tex, { displayMode: true, throwOnError: false }),
    )
  })

  it('非法 TeX 返回错误标记而不是抛出', () => {
    const tex = '\\notacommand'
    expect(computer.renderMath(tex, false)).toBe(
      katex.renderToString(tex, { displayMode: false, throwOnError: false }),
    )
  })
})
