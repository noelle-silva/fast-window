// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { MarkdownRenderEngine } from './engine'

vi.mock('./vendor', async () => {
  const markedMod = await import('marked')
  const katexMod = await import('katex')
  const marked = (markedMod as any).marked ?? (markedMod as any).default
  const katex = (katexMod as any).default ?? (katexMod as any).katex ?? katexMod
  return { marked, katex, mermaid: null }
})

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }
})

type Engine = MarkdownRenderEngine

async function makeEngine(init?: Parameters<typeof import('./engine').createMarkdownRenderEngine>[0]) {
  const mod = await import('./engine')
  const engine: Engine = mod.createMarkdownRenderEngine(init)
  const el = document.createElement('div')
  return { engine, el }
}

function dataTex(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll('[data-tex]')).map(n => n.getAttribute('data-tex') || '')
}

describe('engine.renderInto markdown', () => {
  it('renders headings, emphasis, lists, blockquote and inline code', async () => {
    const { engine, el } = await makeEngine()
    engine.renderInto(el, '# Title\n\nPara **bold** and *italic*.\n\n- a\n- b\n\n> quote\n\n`inline` code')
    expect(el.querySelector('h1')?.textContent).toBe('Title')
    expect(el.querySelector('strong')?.textContent).toBe('bold')
    expect(el.querySelector('em')?.textContent).toBe('italic')
    expect(Array.from(el.querySelectorAll('li')).map(n => n.textContent)).toEqual(['a', 'b'])
    expect(el.querySelector('blockquote')?.textContent?.trim()).toBe('quote')
    expect(el.querySelector('code')?.textContent).toBe('inline')
  })

  it('returns empty output for empty input', async () => {
    const { engine, el } = await makeEngine()
    engine.renderInto(el, '')
    expect(el.innerHTML).toBe('')
  })

  it('no-ops when the target is not an HTMLElement', async () => {
    const { engine } = await makeEngine()
    expect(() => engine.renderInto(null, 'x')).not.toThrow()
    expect(() => engine.renderInto('not-el', 'x')).not.toThrow()
  })

  it('enhances fenced code blocks with a copy button', async () => {
    const { engine, el } = await makeEngine()
    engine.renderInto(el, '```js\nconst x = 1\n```')
    const pre = el.querySelector('pre')
    expect(pre?.getAttribute('data-fw-code')).toBe('1')
    expect(pre?.classList.contains('fw-code-block')).toBe(true)
    const btn = pre?.querySelector('button[data-act="copy-code"]')
    expect(btn).not.toBeNull()
    expect(btn?.getAttribute('title')).toBe('复制代码')
    expect(pre?.querySelector('code')?.textContent).toBe('const x = 1\n')
  })

  it('treats a closed mermaid fence as a mermaid placeholder code block', async () => {
    const { engine, el } = await makeEngine()
    engine.renderInto(el, '```mermaid\ngraph TD; A-->B\n```')
    const code = el.querySelector('code.language-mermaid')
    expect(code).not.toBeNull()
    expect(code?.textContent).toBe('graph TD; A-->B')
    expect(el.querySelector('pre')?.getAttribute('data-fw-code')).toBeNull()
  })

  it('does not extract an unclosed mermaid fence', async () => {
    const { engine, el } = await makeEngine()
    engine.renderInto(el, '```mermaid\ngraph TD')
    const code = el.querySelector('code.language-mermaid')
    expect(code).not.toBeNull()
    expect(code?.textContent).toBe('graph TD\n')
  })

  it('escapes and drops script tags in the original policy', async () => {
    const { engine, el } = await makeEngine()
    engine.renderInto(el, 'hello <script>alert(1)</script> world')
    expect(el.querySelector('script')).toBeNull()
    expect(el.querySelector('p')?.textContent).toBe('hello  world')
  })
})

describe('engine.renderInto math', () => {
  it('renders inline and block math with data-tex and copy buttons', async () => {
    const { engine, el } = await makeEngine()
    engine.renderInto(el, 'inline $a+b$ and block:\n\n$$x^2$$\n\n\\(c\\)\n\n\\[d\\]')
    expect(dataTex(el)).toEqual(['a+b', 'x^2', 'c', 'd'])
    expect(el.querySelectorAll('.math-inline[data-tex]').length).toBe(2)
    expect(el.querySelectorAll('.math-block[data-tex]').length).toBe(2)
    expect(el.querySelectorAll('.katex').length).toBe(4)
    expect(el.querySelectorAll('.fw-math-copy').length).toBe(4)
    expect(el.querySelector('.math-inline')?.getAttribute('data-fw-math')).toBe('1')
    expect(el.querySelector('.math-block')?.classList.contains('fw-math-host')).toBe(true)
  })

})

describe('engine.renderInto assets', () => {
  it('renders a bare asset reference with default name and loading state', async () => {
    const { engine, el } = await makeEngine()
    engine.renderInto(el, '{{asset:foo.png}}')
    const span = el.querySelector('.hc-asset[data-hc-asset-ref]')
    expect(span?.getAttribute('data-hc-asset-ref')).toBe('foo.png')
    expect(span?.getAttribute('data-hc-asset-name')).toBe('.png')
    expect(span?.getAttribute('data-hc-asset-name-default')).toBe('1')
    expect(span?.getAttribute('data-hc-asset-state')).toBe('loading')
    expect(span?.querySelector('.hc-asset-chip--loading')?.textContent).toBe('📎 .png（加载中…）')
  })

  it('renders a named asset with width', async () => {
    const { engine, el } = await makeEngine()
    engine.renderInto(el, '{{asset:bar.pdf|My Doc|320}}')
    const span = el.querySelector('.hc-asset[data-hc-asset-ref]')
    expect(span?.getAttribute('data-hc-asset-name')).toBe('My Doc')
    expect(span?.getAttribute('data-hc-asset-name-default')).toBeNull()
    expect(span?.getAttribute('data-hc-asset-width')).toBe('320')
  })

  it('renders the width-only asset syntax', async () => {
    const { engine, el } = await makeEngine()
    engine.renderInto(el, '{{asset:baz.jpg||480}}')
    const span = el.querySelector('.hc-asset[data-hc-asset-ref]')
    expect(span?.getAttribute('data-hc-asset-name')).toBe('.jpg')
    expect(span?.getAttribute('data-hc-asset-width')).toBe('480')
  })

  it('leaves asset syntax inside inline code untouched', async () => {
    const { engine, el } = await makeEngine()
    engine.renderInto(el, '`{{asset:x.png}}`')
    expect(el.querySelector('.hc-asset')).toBeNull()
    expect(el.querySelector('code')?.textContent).toBe('{{asset:x.png}}')
  })
})

describe('engine.renderInto note refs', () => {
  it('renders a broken ref when the note index is absent', async () => {
    const { engine, el } = await makeEngine()
    engine.renderInto(el, '[[note_id=n1|title=Hello|remarks=note]]')
    const a = el.querySelector('a.hc-note-ref--broken')
    expect(a).not.toBeNull()
    expect(a?.getAttribute('data-note-id')).toBe('n1')
    expect(a?.getAttribute('data-hc-ref-index')).toBe('0')
    expect(a?.getAttribute('data-note-remarks')).toBe('note')
    expect(a?.textContent).toBe('不存在笔记：Hello')
  })

  it('renders existing, face-gone and broken states against the note index', async () => {
    const { engine, el } = await makeEngine()
    engine.noteIndex = { n1: { title: 'T1', faceIds: ['f1', 'f2'] } }
    engine.renderInto(el, '[[note_id=n1|title=]] [[note_id=n1|title=|face=f1]] [[note_id=n1|title=|face=f9]] [[note_id=missing|title=X]]')
    const anchors = Array.from(el.querySelectorAll('a.hc-note-ref'))
    expect(anchors.length).toBe(4)
    expect(anchors[0].className).toBe('hc-note-ref')
    expect(anchors[0].textContent).toBe('T1')
    expect(anchors[1].querySelector('.hc-note-ref-badge')?.textContent).toBe('f1')
    expect(anchors[2].className).toBe('hc-note-ref hc-note-ref--face-gone')
    expect(anchors[2].textContent).toBe('此面已失效：T1')
    expect(anchors[3].className).toBe('hc-note-ref hc-note-ref--broken')
    expect(anchors[3].textContent).toBe('不存在笔记：X')
  })

  it('leaves note-ref syntax inside inline code untouched', async () => {
    const { engine, el } = await makeEngine()
    engine.renderInto(el, '`[[note_id=n1]]`')
    expect(el.querySelector('a.hc-note-ref')).toBeNull()
    expect(el.querySelector('code')?.textContent).toBe('[[note_id=n1]]')
  })
})

describe('engine.renderInto indentation preprocessing', () => {
  it('dedents 4-space html but preserves a 2-space line', async () => {
    const { engine, el } = await makeEngine()
    engine.renderInto(el, '    <div>hi</div>\n\n  <span>two</span>')
    expect(el.querySelector('div')?.textContent).toBe('hi')
    expect(el.querySelector('span')?.textContent).toBe('two')
    expect(el.querySelector('p')?.textContent).toBe('  two')
  })

  it('does not dedent inside fenced code', async () => {
    const { engine, el } = await makeEngine()
    engine.renderInto(el, '```\n    <div>hi</div>\n```')
    expect(el.querySelector('code')?.textContent).toBe('    <div>hi</div>\n')
    expect(el.querySelector('div')).toBeNull()
  })
})

describe('engine sanitize policy', () => {
  it.each([
    ['original', '<p>a  b  <a>j</a> <a href="https://e.com">ok</a></p>\n'],
    ['baseline', '<p>a  b <iframe src="x"></iframe> <a>j</a> <a href="https://e.com">ok</a></p>\n'],
    ['unsafe', '<p>a <script>alert(1)</script> b <iframe src="x"></iframe> <a href="javascript:void(0)">j</a> <a href="https://e.com">ok</a></p>\n'],
  ] as const)('applies the %s policy to rendered html', async (policy, expected) => {
    const { engine, el } = await makeEngine()
    engine.renderInto(el, 'a <script>alert(1)</script> b <iframe src="x"></iframe> <a href="javascript:void(0)">j</a> <a href="https://e.com">ok</a>', { renderSafetyPolicy: policy })
    expect(el.innerHTML).toBe(expected)
  })

  it('exposes sanitizeHtml delegating to the shared sanitizer', async () => {
    const { engine } = await makeEngine()
    expect(engine.sanitizeHtml('<b>x</b><script>1</script>')).toBe('<b>x</b>')
    expect(engine.sanitizeHtml('<b>x</b><script>1</script>', 'unsafe')).toBe('<b>x</b><script>1</script>')
  })

  it('exposes sanitizeSvg delegating to the shared sanitizer', async () => {
    const { engine } = await makeEngine()
    expect(engine.sanitizeSvg('<svg onload="x()"><script>1</script></svg>')).toBe('<svg></svg>')
    expect(engine.sanitizeSvg('<svg onload="x()"><script>1</script></svg>', 'baseline')).toBe('<svg></svg>')
    expect(engine.sanitizeSvg('<svg onload="x()"></svg>', 'unsafe')).toBe('<svg onload="x()"></svg>')
  })
})

describe('engine.refreshNoteRefs', () => {
  it('updates an attached container when the note index appears', async () => {
    const { engine, el } = await makeEngine()
    engine.noteIndex = {}
    document.body.appendChild(el)
    try {
      engine.renderInto(el, '[[note_id=n1|title=Hi]]')
      expect(el.querySelector('a.hc-note-ref--broken')?.textContent).toBe('不存在笔记：Hi')
      engine.noteIndex = { n1: { title: 'T1', faceIds: ['f1'] } }
      engine.refreshNoteRefs(el)
      const a = el.querySelector('a.hc-note-ref')
      expect(a?.className).toBe('hc-note-ref')
      expect(a?.textContent).toBe('Hi')
    } finally {
      el.remove()
    }
  })

  it('marks an attached anchor as face-gone when the face disappears', async () => {
    const { engine, el } = await makeEngine()
    engine.noteIndex = { n1: { title: 'T1', faceIds: ['f1'] } }
    document.body.appendChild(el)
    try {
      engine.renderInto(el, '[[note_id=n1|title=|face=f1]]')
      expect(el.querySelector('.hc-note-ref-badge')?.textContent).toBe('f1')
      engine.noteIndex = { n1: { title: 'T1', faceIds: ['f2'] } }
      engine.refreshNoteRefs(el)
      const a = el.querySelector('a.hc-note-ref--face-gone')
      expect(a?.textContent).toBe('此面已失效：T1')
    } finally {
      el.remove()
    }
  })

  it('is a no-op for containers without a note-ref cache', async () => {
    const { engine } = await makeEngine()
    expect(() => engine.refreshNoteRefs(document.createElement('div'))).not.toThrow()
    expect(() => engine.refreshNoteRefs(null)).not.toThrow()
  })
})

describe('engine misc public surface', () => {
  it('ensureRenderer resolves', async () => {
    const { engine } = await makeEngine()
    await expect(engine.ensureRenderer()).resolves.toBeUndefined()
  })

  it('bindPlaybackReporter returns a cleanup function even for non-elements', async () => {
    const { engine } = await makeEngine()
    const cleanup = engine.bindPlaybackReporter(null, () => {})
    expect(typeof cleanup).toBe('function')
    expect(() => cleanup()).not.toThrow()
  })

  it('copies code block text through the injected clipboard gateway', async () => {
    const writeText = vi.fn(async () => {})
    const { engine, el } = await makeEngine({ clipboard: { writeText } as any })
    engine.renderInto(el, '```js\nconst x = 1\n```')
    const btn = el.querySelector<HTMLButtonElement>('button[data-act="copy-code"]')
    expect(btn).not.toBeNull()
    btn!.click()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(writeText).toHaveBeenCalledWith('const x = 1\n')
  })
})
