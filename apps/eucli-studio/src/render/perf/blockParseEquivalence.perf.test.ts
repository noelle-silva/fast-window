// @vitest-environment happy-dom
//
// 块解析等价性验证：确认「把 HTML 按顶层块切开、逐块解析后按序拼接」得到的 DOM
// 与「整体一次性解析」得到的 DOM 在节点序列上完全一致。
// 这是「只重解析变化尾部块」增量提交方案的安全前提。
import { beforeAll, describe, it, expect } from 'vitest'
import { installRenderGlobals } from './benchmark'
import { splitTopLevelBlocks } from '../topLevelBlocks'

function nodeSignature(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return `#text:${JSON.stringify(node.textContent)}`
  if (node.nodeType === Node.COMMENT_NODE) return `#comment:${node.textContent}`
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element
    const attrs = Array.from(el.attributes).map((a) => `${a.name}=${a.value}`).sort().join(',')
    const kids = Array.from(el.childNodes).map(nodeSignature).join('|')
    return `<${el.tagName.toLowerCase()} ${attrs}>[${kids}]`
  }
  return `#${node.nodeType}`
}

function wholeSignature(html: string): string {
  const d = document.createElement('div')
  d.innerHTML = html
  return Array.from(d.childNodes).map(nodeSignature).join('\n')
}

function perBlockSignature(html: string): string {
  const d = document.createElement('div')
  for (const block of splitTopLevelBlocks(html)) {
    const tmp = document.createElement('div')
    tmp.innerHTML = block
    while (tmp.firstChild) d.appendChild(tmp.firstChild)
  }
  return Array.from(d.childNodes).map(nodeSignature).join('\n')
}

const CASES: Record<string, string> = {
  simpleParas: '<p>a</p>\n<p>b</p>\n',
  headingAndPara: '<h1>标题</h1>\n<p>正文</p>\n',
  withInline: '<p>hello <strong>world</strong> and <code>x</code></p>\n',
  list: '<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n',
  nestedDiv: '<div class="x">\n  <span>hello</span>\n  <span>world</span>\n</div>\n',
  voidTags: '<p>a<br>b</p>\n<hr>\n<img src="x">\n',
  comments: '<!-- c -->\n<p>a</p>\n',
  table: '<table>\n<thead><tr><th>a</th></tr></thead>\n<tbody><tr><td>b</td></tr></tbody>\n</table>\n',
  mathHost: '<p>text</p>\n<div class="math-block" data-tex="a^2"><span class="katex">R</span></div>\n<span class="math-inline" data-tex="x"><span class="katex">I</span></span>\n',
  fenced: '<pre><code class="language-js">const a = 1\n</code></pre>\n<p>after</p>\n',
  trailingText: '<p>a</p>\n尾随文字',
  leadingText: '前导文字\n<p>a</p>\n',
  selfClosingSlash: '<br/>\n<p>a</p>\n',
  attributeQuotes: '<a href="x>y" title=\'z\'>link</a>\n<p>a</p>\n',
}

describe('块解析等价性', () => {
  beforeAll(async () => {
    await installRenderGlobals()
  }, 120000)

  it('逐块解析拼接 == 整体解析', () => {
    const failures: string[] = []
    for (const [name, html] of Object.entries(CASES)) {
      const whole = wholeSignature(html)
      const perBlock = perBlockSignature(html)
      if (whole !== perBlock) failures.push(`${name}:\n  whole=${whole}\n  perBlk=${perBlock}`)
    }
    // eslint-disable-next-line no-console
    console.log(`\n[block-equiv] cases=${Object.keys(CASES).length} failures=${failures.length}\n` + failures.join('\n'))
    expect(failures).toEqual([])
  })
})
