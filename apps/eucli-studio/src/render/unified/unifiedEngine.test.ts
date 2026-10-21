// @vitest-environment happy-dom
//
// unified 引擎测试：验证新底座在「块外 / 块内 / 嵌套 / 代码内」各场景下的行为，
// 以及流式增量与一次性完整渲染的等价性。
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

describe('unified 引擎：表情包', () => {
  beforeAll(async () => {
    await installRenderGlobals()
  }, 120000)

  it('纯文本里的表情包', () => {
    const host = renderInto(makeEngine(), '你好 [[sticker:doro/x]] 呀', OPTIONS)
    expect(host.querySelectorAll('img.fw-sticker').length).toBe(1)
    host.remove()
  })

  it('HTML 块里的表情包（旧版失效场景）', () => {
    const host = renderInto(makeEngine(), '<div class="card">\n[[sticker:doro/x]]\n</div>', OPTIONS)
    expect(host.querySelectorAll('div.card img.fw-sticker').length).toBe(1)
    host.remove()
  })

  it('嵌套 HTML 块里的表情包', () => {
    const text = '<div class="outer">\n  <div class="inner">\n    [[sticker:doro/x]]\n  </div>\n</div>'
    const host = renderInto(makeEngine(), text, OPTIONS)
    expect(host.querySelectorAll('div.outer div.inner img.fw-sticker').length).toBe(1)
    host.remove()
  })

  it('代码块里的口令不认领', () => {
    const host = renderInto(makeEngine(), '```\n[[sticker:doro/x]]\n```', OPTIONS)
    expect(host.querySelectorAll('img.fw-sticker').length).toBe(0)
    host.remove()
  })

  it('行内代码里的口令不认领', () => {
    const host = renderInto(makeEngine(), '代码 `[[sticker:doro/x]]` 保留', OPTIONS)
    expect(host.querySelectorAll('img.fw-sticker').length).toBe(0)
    host.remove()
  })

  it('尺寸与中文别名', () => {
    const host = renderInto(makeEngine(), '[[表情包:doro/x/128]]', OPTIONS)
    const img = host.querySelector('img.fw-sticker')
    expect(img).toBeTruthy()
    expect(img?.getAttribute('data-fw-sticker-size')).toBe('128')
    host.remove()
  })

  it('畸形口令保持原文', () => {
    const host = renderInto(makeEngine(), '[[sticker:../secret/x]] [[sticker:only]]', OPTIONS)
    expect(host.querySelectorAll('img.fw-sticker').length).toBe(0)
    host.remove()
  })
})

describe('unified 引擎：公式', () => {
  beforeAll(async () => {
    await installRenderGlobals()
  }, 120000)

  it('纯文本里的行内公式', () => {
    const host = renderInto(makeEngine(), '公式 $a^2+b^2=c^2$ 结束', OPTIONS)
    expect(host.querySelectorAll('.math-inline[data-tex]').length).toBe(1)
    expect(host.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(1)
    host.remove()
  })

  it('HTML 块里的公式（旧版失效场景）', () => {
    const host = renderInto(makeEngine(), '<div class="card">\n$a^2+b^2=c^2$\n</div>', OPTIONS)
    expect(host.querySelectorAll('div.card .math-inline[data-tex]').length).toBe(1)
    host.remove()
  })

  it('块内 公式 + 表情包 混合', () => {
    const host = renderInto(makeEngine(), '<div class="card">\n[[sticker:doro/x]] 和 $a^2$\n</div>', OPTIONS)
    expect(host.querySelectorAll('div.card img.fw-sticker').length).toBe(1)
    expect(host.querySelectorAll('div.card .math-inline[data-tex]').length).toBe(1)
    host.remove()
  })

  it('代码块里的公式不认领', () => {
    const host = renderInto(makeEngine(), '```\n$a^2+b^2$\n```', OPTIONS)
    expect(host.querySelectorAll('.math-inline').length).toBe(0)
    host.remove()
  })

  it('公式 TeX 里的反斜杠命令不被 Markdown 吃掉', () => {
    // Markdown 会把 \, \\ \| \_ 当转义处理，公式必须在解析前保护才能保真。
    const text = [
      '细空格 $a\\,b$',
      '',
      '$$',
      '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
      '$$',
      '',
      '范数 $\\|x\\|_2$ 与下标 $a\\_b$',
    ].join('\n')

    const host = renderInto(makeEngine(), text, OPTIONS)
    const texs = Array.from(host.querySelectorAll('[data-tex]')).map((n) => String(n.getAttribute('data-tex') || ''))

    expect(texs.some((t) => t.includes('\\,'))).toBe(true)
    expect(texs.some((t) => t.includes('\\\\'))).toBe(true)
    expect(texs.some((t) => t.includes('\\|'))).toBe(true)
    expect(texs.some((t) => t.includes('\\_'))).toBe(true)

    host.remove()
  })
})

describe('unified 引擎：图表与代码块', () => {
  beforeAll(async () => {
    await installRenderGlobals()
  }, 120000)

  it('mermaid 围栏被识别并渲染', async () => {
    const host = renderInto(makeEngine(), '```mermaid\ngraph TD\n  A-->B\n```', OPTIONS)
    await waitForAsyncSettle(host)
    expect(host.querySelectorAll('.mermaid-block[data-mermaid="1"]').length).toBe(1)
    host.remove()
  })

  it('flowchart 围栏被识别', async () => {
    const host = renderInto(makeEngine(), '```flowchart\ngraph LR\n  A-->B\n```', OPTIONS)
    await waitForAsyncSettle(host)
    expect(host.querySelectorAll('.mermaid-block[data-mermaid="1"]').length).toBe(1)
    host.remove()
  })

  it('普通 js 围栏不被识别为图表', () => {
    const host = renderInto(makeEngine(), '```js\nconst a = 1\n```', OPTIONS)
    expect(host.querySelectorAll('.mermaid-block').length).toBe(0)
    expect(host.querySelectorAll('pre code.language-js').length).toBe(1)
    host.remove()
  })

  it('代码块挂复制按钮，mermaid 块不挂', async () => {
    const host = renderInto(makeEngine(), '```js\nconst a = 1\n```\n\n```mermaid\ngraph TD\n  A-->B\n```', OPTIONS)
    await waitForAsyncSettle(host)
    expect(host.querySelectorAll('button.fw-code-copy').length).toBe(1)
    expect(host.querySelectorAll('.mermaid-block').length).toBe(1)
    host.remove()
  })
})

describe('unified 引擎：网页代码块', () => {
  beforeAll(async () => {
    await installRenderGlobals()
  }, 120000)

  it('整块 HTML 完整保留', () => {
    const text = '<div class="card">\n  <svg viewBox="0 0 10 10"><rect width="10" height="10"></rect></svg>\n</div>'
    const host = renderInto(makeEngine(), text, OPTIONS)
    expect(host.querySelectorAll('div.card svg rect').length).toBe(1)
    host.remove()
  })
})

describe('unified 引擎：流式等价', () => {
  beforeAll(async () => {
    await installRenderGlobals()
  }, 120000)

  it('增量最终画面 == 一次性完整渲染', async () => {
    const text = [
      '# 标题',
      '',
      '公式 $a^2$ 与表情包 [[sticker:doro/x]]',
      '',
      '<div class="card">',
      '[[sticker:doro/y]] $b^2$',
      '</div>',
      '',
      '```js',
      'const a = 1',
      '```',
    ].join('\n')

    const engine = makeEngine()
    const streamHost = document.createElement('div')
    document.body.appendChild(streamHost)

    for (let i = 1; i <= text.length; i += 3) {
      engine.renderAssistantInto(streamHost, text.slice(0, i), OPTIONS)
    }
    engine.renderAssistantInto(streamHost, text, OPTIONS)

    const fullHost = renderInto(makeEngine(), text, OPTIONS)

    await waitForAsyncSettle(streamHost)
    await waitForAsyncSettle(fullHost)

    expect(streamHost.innerHTML).toBe(fullHost.innerHTML)

    streamHost.remove()
    fullHost.remove()
  })
})

describe('unified 引擎：Markdown 基础语法（GFM）', () => {
  beforeAll(async () => {
    await installRenderGlobals()
  }, 120000)

  it('表格渲染', () => {
    const text = ['| 能力 | 状态 |', '|---|---|', '| 公式 | 正常 |', '| 表情包 | 正常 |'].join('\n')
    const host = renderInto(makeEngine(), text, OPTIONS)
    expect(host.querySelectorAll('table').length).toBe(1)
    expect(host.querySelectorAll('thead th').length).toBe(2)
    expect(host.querySelectorAll('tbody tr').length).toBe(2)
    host.remove()
  })

  it('删除线与任务列表', () => {
    const text = ['~~删除线~~', '', '- [x] 已完成', '- [ ] 未完成'].join('\n')
    const host = renderInto(makeEngine(), text, OPTIONS)
    expect(host.querySelectorAll('del').length).toBe(1)
    expect(host.querySelectorAll('input[type="checkbox"]').length).toBe(2)
    host.remove()
  })

  it('块内 Markdown 表格不解析（HTML 块内不解析 Markdown，与旧引擎一致）', () => {
    const text = ['<div class="card">', '', '| A | B |', '|---|---|', '| 1 | 2 |', '', '</div>'].join('\n')
    const host = renderInto(makeEngine(), text, OPTIONS)
    expect(host.querySelectorAll('div.card').length).toBe(1)
    expect(host.querySelectorAll('div.card table').length).toBe(0)
    host.remove()
  })

  it('单换行即换行（breaks 对齐旧引擎）', () => {
    const host = renderInto(makeEngine(), '第一行\n第二行\n第三行', OPTIONS)
    expect(host.querySelectorAll('br').length).toBeGreaterThanOrEqual(2)
    host.remove()
  })

  it('缩进 4 空格的 HTML 不被当成代码块', () => {
    const text = ['<div class="card">', '    <span class="inner">缩进内容</span>', '</div>'].join('\n')
    const host = renderInto(makeEngine(), text, OPTIONS)
    expect(host.querySelectorAll('div.card').length).toBe(1)
    expect(host.querySelectorAll('div.card span.inner').length).toBe(1)
    expect(host.querySelectorAll('pre').length).toBe(0)
    host.remove()
  })

  it('基础语法全覆盖：标题/列表/引用/链接/图片/水平线/粗斜体', () => {    const text = [
      '# 标题一',
      '',
      '## 标题二',
      '',
      '**粗体** 和 *斜体* 和 ~~删除~~',
      '',
      '- 无序一',
      '- 无序二',
      '',
      '1. 有序一',
      '2. 有序二',
      '',
      '> 引用块内容',
      '',
      '[链接](https://example.com)',
      '',
      '![图片](https://example.com/a.png)',
      '',
      '---',
    ].join('\n')

    const host = renderInto(makeEngine(), text, OPTIONS)
    expect(host.querySelectorAll('h1').length).toBe(1)
    expect(host.querySelectorAll('h2').length).toBe(1)
    expect(host.querySelectorAll('strong').length).toBeGreaterThanOrEqual(1)
    expect(host.querySelectorAll('em').length).toBeGreaterThanOrEqual(1)
    expect(host.querySelectorAll('del').length).toBe(1)
    expect(host.querySelectorAll('ul li').length).toBe(2)
    expect(host.querySelectorAll('ol li').length).toBe(2)
    expect(host.querySelectorAll('blockquote').length).toBe(1)
    expect(host.querySelectorAll('a[href]').length).toBe(1)
    expect(host.querySelectorAll('img[src]').length).toBe(1)
    expect(host.querySelectorAll('hr').length).toBe(1)
    host.remove()
  })

  it('表格挂载复制工具条（两个图标按钮）', () => {
    const text = ['| A | B |', '|---|---|', '| 1 | 2 |'].join('\n')
    const host = renderInto(makeEngine(), text, OPTIONS)

    const wrap = host.querySelector('.fw-table-wrap')
    expect(wrap).toBeTruthy()
    expect(wrap?.querySelector('table')).toBeTruthy()
    expect(wrap?.querySelectorAll('button.fw-table-action').length).toBe(2)

    host.remove()
  })
})
