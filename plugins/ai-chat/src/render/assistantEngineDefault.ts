import { uid, esc } from '../core/utils'
import './vendor'

export type AssistantRenderEngine = {
  ensureRenderer: () => Promise<void>
  sanitizeHtml: (html: unknown) => string
  sanitizeSvg: (svg: unknown) => string
  renderAssistantInto: (el: unknown, text: unknown) => void
}

export function createDefaultAssistantRenderEngine(): AssistantRenderEngine {
  let rendererPromise: Promise<void> | null = null
  let domPurifyHooked = false
  let mermaidInited = false
  let markedConfigured = false
  const mermaidSvgCache = new Map<string, string>()

  const ICON_COPY =
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M16 1H6c-1.1 0-2 .9-2 2v12h2V3h10V1zm3 4H10c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h9c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16h-9V7h9v14z"/></svg>'
  const ICON_OK =
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>'
  const ICON_FAIL =
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>'

  function setCopyBtnState(btn: HTMLButtonElement, state: 'copy' | 'ok' | 'fail') {
    if (state === 'ok') {
      btn.innerHTML = ICON_OK
      btn.setAttribute('data-state', 'ok')
      btn.setAttribute('title', '已复制')
      btn.setAttribute('aria-label', '已复制')
      return
    }
    if (state === 'fail') {
      btn.innerHTML = ICON_FAIL
      btn.setAttribute('data-state', 'fail')
      btn.setAttribute('title', '复制失败')
      btn.setAttribute('aria-label', '复制失败')
      return
    }
    btn.innerHTML = ICON_COPY
    btn.removeAttribute('data-state')
    btn.setAttribute('title', '复制代码')
    btn.setAttribute('aria-label', '复制代码')
  }

  async function copyTextToClipboard(text: string) {
    const t = String(text || '')
    if (!t) return false

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(t)
        return true
      }
    } catch (_) {}

    try {
      const ta = document.createElement('textarea')
      ta.value = t
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      ta.style.top = '0'
      document.body.appendChild(ta)
      ta.select()
      ta.setSelectionRange(0, ta.value.length)
      const ok = document.execCommand('copy')
      ta.remove()
      return !!ok
    } catch (_) {}

    return false
  }

  function ensureCodeCopyHandlerOnce(root: HTMLElement) {
    if (root.getAttribute('data-fw-copy-hook') === '1') return
    root.setAttribute('data-fw-copy-hook', '1')

    root.addEventListener('click', (e) => {
      const target = e.target instanceof Element ? e.target : null
      const btn = target?.closest?.('button[data-act="copy-code"]')
      if (!(btn instanceof HTMLButtonElement)) return

      const pre = btn.closest('pre')
      const code = pre?.querySelector?.('code')
      const text = code ? String(code.textContent || '') : ''
      if (!text) return

      btn.disabled = true
      copyTextToClipboard(text)
        .then((ok) => {
          setCopyBtnState(btn, ok ? 'ok' : 'fail')
        })
        .catch(() => {
          setCopyBtnState(btn, 'fail')
        })
        .finally(() => {
          window.setTimeout(() => {
            if (!btn.isConnected) return
            setCopyBtnState(btn, 'copy')
            btn.disabled = false
          }, 1200)
        })
    })
  }

  function enhanceCodeBlocks(root: unknown) {
    if (!(root instanceof HTMLElement)) return
    ensureCodeCopyHandlerOnce(root)

    const pres = Array.from(root.querySelectorAll?.('pre') || [])
    for (const pre of pres) {
      if (!(pre instanceof HTMLElement)) continue
      if (pre.getAttribute('data-fw-code') === '1') continue
      const code = pre.querySelector?.('code')
      if (!(code instanceof HTMLElement)) continue

      const cls = String(code.className || '')
      const isMermaid = cls.includes('language-mermaid') || cls.includes('lang-mermaid') || cls.includes('mermaid')
      if (isMermaid) continue

      pre.setAttribute('data-fw-code', '1')
      pre.classList.add('fw-code-block')

      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'fw-code-copy'
      btn.setAttribute('data-act', 'copy-code')
      setCopyBtnState(btn, 'copy')
      pre.appendChild(btn)
    }
  }

  function initMermaidOnce() {
    const m = (window as any).mermaid
    if (mermaidInited || !m || !m.initialize) return
    try {
      mermaidInited = true
      m.initialize({
        startOnLoad: false,
        // 参考 Dendron-studio：使用 loose，避免部分图类型在 strict 下触发 DOMPurify 兼容问题导致渲染失败。
        // 仍会对最终 SVG 做 sanitizeSvg 过滤。
        securityLevel: 'loose',
        theme: 'default',
        themeVariables: {
          fontFamily:
            'system-ui,-apple-system,"Segoe UI","Microsoft YaHei","PingFang SC","Noto Sans CJK SC",Roboto,Arial,sans-serif',
        },
        flowchart: { htmlLabels: false },
        state: { htmlLabels: false },
        class: { htmlLabels: false },
      })
    } catch (_) {}
  }

  function ensureRenderer() {
    if (rendererPromise) return rendererPromise
    rendererPromise = (async () => {
      // v2: 依赖在构建期打包为本地依赖（见 src/render/vendor.ts），运行时不再拉公共 CDN。
      try {
        initMermaidOnce()
      } catch (_) {}
    })()
    return rendererPromise
  }

  function sanitizeHtml(html: unknown) {
    const raw = String(html || '')

    function isSafeHref(href: unknown) {
      const s = String(href || '').trim().toLowerCase()
      return s.startsWith('http://') || s.startsWith('https://') || s.startsWith('mailto:')
    }

    function isAllowedAttr(tag: unknown, name: unknown) {
      const n = String(name || '').toLowerCase()
      const t = String(tag || '').toUpperCase()

      if (!n) return false
      if (n.startsWith('on')) return false
      if (n === 'id') return true
      if (n === 'class' || n === 'style') return true
      if (n.startsWith('data-')) return true
      if (n.startsWith('aria-') || n === 'role' || n === 'tabindex') return true

      if (t === 'A') return n === 'href' || n === 'target' || n === 'rel' || n === 'title'
      if (t === 'BUTTON') return n === 'type' || n === 'disabled' || n === 'title'
      if (t === 'INPUT') return n === 'type' || n === 'value' || n === 'checked' || n === 'disabled' || n === 'placeholder' || n === 'title'
      if (t === 'TD' || t === 'TH') return n === 'colspan' || n === 'rowspan' || n === 'title'
      if (t === 'DETAILS') return n === 'open'
      return false
    }

    function sanitizeStyleValue(style: unknown) {
      const s = String(style || '')
      if (!s.trim()) return ''
      const out: string[] = []
      const parts = s.split(';')
      for (const part of parts) {
        const p = part.trim()
        if (!p) continue
        const idx = p.indexOf(':')
        if (idx <= 0) continue
        const key = p.slice(0, idx).trim().toLowerCase()
        let value = p.slice(idx + 1).trim()
        if (!key || !value) continue

        const v = value.toLowerCase()
        if (v.includes('expression(') || v.includes('javascript:') || v.includes('@import') || v.includes('url(')) continue
        if (value.includes('<') || value.includes('>')) continue
        out.push(`${key}:${value}`)
      }
      return out.join(';')
    }

    const w = window as any
    if (w.DOMPurify && w.DOMPurify.sanitize) {
      try {
        if (!domPurifyHooked && w.DOMPurify.addHook) {
          domPurifyHooked = true
          w.DOMPurify.addHook('uponSanitizeAttribute', (_node: unknown, data: any) => {
            try {
              const name = String(data?.attrName || '').toLowerCase()
              if (name.startsWith('on')) data.keepAttr = false
              if (name === 'href' && data.attrValue && !isSafeHref(data.attrValue)) data.keepAttr = false
              if (name === 'style') {
                const v = sanitizeStyleValue(String(data.attrValue || ''))
                if (!v) data.keepAttr = false
                else data.attrValue = v
              }
            } catch (_) {}
          })
        }

        return w.DOMPurify.sanitize(raw, {
          FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
          ALLOW_DATA_ATTR: true,
          ADD_TAGS: ['button', 'details', 'summary', 'input', 'label', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
          ADD_ATTR: ['id', 'style', 'class', 'role', 'tabindex', 'colspan', 'rowspan'],
        })
      } catch (_) {}
    }

    const tpl = document.createElement('template')
    tpl.innerHTML = raw

    const allowedTags = new Set([
      'DIV',
      'SPAN',
      'P',
      'BR',
      'PRE',
      'CODE',
      'EM',
      'STRONG',
      'UL',
      'OL',
      'LI',
      'BLOCKQUOTE',
      'A',
      'BUTTON',
      'DETAILS',
      'SUMMARY',
      'INPUT',
      'LABEL',
      'TABLE',
      'THEAD',
      'TBODY',
      'TR',
      'TH',
      'TD',
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
      'HR',
    ])

    const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT, null)
    const toRemove: Node[] = []

    while (walker.nextNode()) {
      const node = walker.currentNode
      if (node.nodeType === Node.COMMENT_NODE) {
        toRemove.push(node)
        continue
      }

      const el = node as Element
      const tag = String(el.tagName || '')
      if (!allowedTags.has(tag)) {
        el.replaceWith(document.createTextNode(el.textContent || ''))
        continue
      }

      const attrs = Array.from(el.attributes || [])
      for (const a of attrs) {
        const name = String(a.name || '').toLowerCase()
        if (!isAllowedAttr(tag, name)) {
          el.removeAttribute(a.name)
          continue
        }
        if (name === 'style') {
          const v = sanitizeStyleValue(el.getAttribute('style') || '')
          if (!v) el.removeAttribute('style')
          else el.setAttribute('style', v)
        }
      }

      if (tag === 'A') {
        const href = el.getAttribute('href') || ''
        if (href && !isSafeHref(href)) el.removeAttribute('href')
        const target = String(el.getAttribute('target') || '').toLowerCase()
        if (target && target !== '_blank') el.removeAttribute('target')
        if (target === '_blank') el.setAttribute('rel', 'noopener noreferrer')
      }
    }

    for (const n of toRemove) n.remove()
    return tpl.innerHTML
  }

  function preprocessHtmlIndentation(source: unknown) {
    function dedentHtmlLines(s: unknown) {
      const t = String(s || '')
      // Markdown：4 空格缩进会被当作代码块；HTML 内部常见缩进会触发这个坑。
      // 仅在“非代码围栏”区域，把以 4 空格/Tab 开头且后面紧跟 < 或 <!-- 的行去掉缩进。
      return t.replace(/^(?:\t| {4})+(?=<)/gm, '').replace(/^(?:\t| {4})+(?=<!--)/gm, '')
    }

    const src = String(source || '').replace(/\r\n/g, '\n')
    const tokens = tokenizeFences(src)
    return tokens
      .map((t) => {
        if (t.kind === 'text') return dedentHtmlLines(t.text)
        return t.raw
      })
      .join('')
  }

  function sanitizeSvg(svg: unknown) {
    const raw = String(svg || '')
    if (!raw) return ''
    const w = window as any
    if (w.DOMPurify && w.DOMPurify.sanitize) {
      try {
        return w.DOMPurify.sanitize(raw, { USE_PROFILES: { svg: true, svgFilters: true } })
      } catch (_) {}
    }
    return raw
  }

  async function renderMermaidInto(el: unknown) {
    if (!(el instanceof HTMLElement)) return
    const m = (window as any).mermaid
    if (!m || !m.render) return

    const codes = Array.from(el.querySelectorAll?.('pre>code') || []).filter((c) => {
      if (!(c instanceof HTMLElement)) return false
      const cls = String(c.className || '')
      return cls.includes('language-mermaid') || cls.includes('lang-mermaid') || cls.includes('mermaid')
    })
    if (!codes.length) return

    initMermaidOnce()

    async function doRender(id: string, code: string, container: HTMLElement) {
      try {
        return await m.render(id, code)
      } catch (_) {
        return await m.render(id, code, container)
      }
    }

    for (const codeEl of codes) {
      const pre = codeEl.closest('pre')
      if (!(pre instanceof HTMLElement)) continue
      if (pre.getAttribute('data-mermaid') === '1') continue

      const src = String(codeEl.textContent || '').trim()
      pre.setAttribute('data-mermaid', '1')
      if (!src) continue

      const holder = document.createElement('div')
      holder.className = 'mermaid-block'
      holder.setAttribute('data-mermaid', '1')
      holder.setAttribute('data-act', 'open-mermaid')
      pre.replaceWith(holder)

      const cached = mermaidSvgCache.get(src)
      if (typeof cached === 'string' && cached) {
        holder.innerHTML = cached
        continue
      }

      try {
        const id = uid('mm')
        const r = await doRender(id, src, holder)
        const svg = typeof r === 'string' ? r : String(r?.svg || '')
        const safe = sanitizeSvg(svg)
        if (!safe) throw new Error('empty svg')
        if (mermaidSvgCache.size >= 50) {
          const first = mermaidSvgCache.keys().next().value
          if (typeof first === 'string' && first) mermaidSvgCache.delete(first)
        }
        mermaidSvgCache.set(src, safe)
        holder.innerHTML = safe
        if (r && typeof r.bindFunctions === 'function') {
          try {
            r.bindFunctions(holder)
          } catch (_) {}
        }
      } catch (e) {
        const msg = esc(String((e as any)?.message || e || ''))
        holder.innerHTML = `
          <div class="muted">Mermaid 渲染失败${msg ? `：${msg}` : ''}</div>
          <pre><code class="language-mermaid">${esc(src)}</code></pre>
        `
      }
    }
  }

  function markPreviewImages(root: unknown) {
    if (!(root instanceof HTMLElement)) return
    const imgs = Array.from(root.querySelectorAll?.('img') || [])
    for (const img of imgs) {
      if (!(img instanceof HTMLImageElement)) continue
      const src = String(img.getAttribute('src') || '').trim()
      if (!src) continue
      if (img.getAttribute('data-fw-img') === '1') continue
      img.setAttribute('data-fw-img', '1')
      try {
        img.style.cursor = 'zoom-in'
      } catch (_) {}
    }
  }

  function renderAssistantInto(el: unknown, text: unknown) {
    if (!(el instanceof HTMLElement)) return
    const raw = String(text || '')
    let html = ''

    const noIndent = preprocessHtmlIndentation(raw)
    const pre = preprocessAssistantContent(noIndent)
    const src = String(pre.text || '')

    const w = window as any
    if (!w.marked || typeof w.marked.parse !== 'function') {
      html = `<pre>${esc(src)}</pre>`
    } else {
      try {
        if (!markedConfigured) {
          markedConfigured = true
          w.marked.setOptions?.({ gfm: true, breaks: true })
        }
        // 唯一渲染机制：始终走 Markdown（marked 会保留 HTML block，同时解析后续 Markdown）
        html = w.marked.parse(src)
      } catch (_) {
        html = `<pre>${esc(src)}</pre>`
      }
    }

    let safe = sanitizeHtml(html)
    if (Array.isArray(pre.math) && pre.math.length) {
      safe = safe.replace(/@@MATH_(INLINE|BLOCK)_(\d+)@@/g, (_m, kind, id) => {
        const it = pre.math[Number(id)]
        const tex = it ? String(it.tex || '') : ''
        if (kind === 'INLINE') return `<span class="math-inline" data-tex="${esc(tex)}"></span>`
        return `<div class="math-block" data-tex="${esc(tex)}"></div>`
      })
    }
    if (Array.isArray(pre.mermaid) && pre.mermaid.length) {
      safe = safe.replace(/@@MERMAID_(\d+)@@/g, (_m, id) => {
        const code = pre.mermaid[Number(id)] ?? ''
        return `<pre><code class="language-mermaid">${esc(code)}</code></pre>`
      })
    }

    el.innerHTML = safe
    enhanceCodeBlocks(el)
    markPreviewImages(el)

    const katex = w.katex
    if (katex && typeof katex.render === 'function') {
      const blocks = Array.from(el.querySelectorAll?.('.math-block[data-tex]') || [])
      for (const b of blocks) {
        if (!(b instanceof HTMLElement)) continue
        const tex = b.getAttribute('data-tex') || ''
        try {
          katex.render(tex, b, { displayMode: true, throwOnError: false })
        } catch (_) {}
      }
      const inlines = Array.from(el.querySelectorAll?.('.math-inline[data-tex]') || [])
      for (const s of inlines) {
        if (!(s instanceof HTMLElement)) continue
        const tex = s.getAttribute('data-tex') || ''
        try {
          katex.render(tex, s, { displayMode: false, throwOnError: false })
        } catch (_) {}
      }
    }

    renderMermaidInto(el).catch(() => {})
  }

  return { ensureRenderer, sanitizeHtml, sanitizeSvg, renderAssistantInto }
}

type PreprocessedMath = { tex: string; display: boolean }

type FenceToken =
  | { kind: 'text'; text: string }
  | { kind: 'fence'; raw: string; lang: string; content: string; closed: boolean }

function preprocessAssistantContent(source: unknown): { text: string; math: PreprocessedMath[]; mermaid: string[] } {
  const src = String(source || '').replace(/\r\n/g, '\n')
  const tokens = tokenizeFences(src)

  const mermaid: string[] = []
  const math: PreprocessedMath[] = []
  const out: string[] = []

  for (const t of tokens) {
    if (t.kind === 'fence') {
      const lang = String(t.lang || '').trim().toLowerCase()
      const isMermaid = t.closed && (lang === 'mermaid' || lang === 'flowchart' || lang === 'graph')
      if (isMermaid) {
        const id = mermaid.length
        mermaid.push(String(t.content || '').trim())
        out.push(`@@MERMAID_${id}@@`)
      } else {
        out.push(t.raw)
      }
      continue
    }

    out.push(replaceMathOutsideInlineCode(t.text, math))
  }

  return { text: out.join(''), math, mermaid }
}

function tokenizeFences(input: string): FenceToken[] {
  const src = String(input || '')
  const lines = src.split('\n')

  const out: FenceToken[] = []
  const textBuf: string[] = []

  const flushText = () => {
    if (!textBuf.length) return
    out.push({ kind: 'text', text: textBuf.join('') })
    textBuf.length = 0
  }

  let inFence = false
  let fenceMarker = ''
  let fenceInfo = ''
  let openLineRaw = ''
  const fenceLinesRaw: string[] = []

  const openRe = /^(\s*)(`{3,})(.*)$/
  const closeRe = /^(\s*)(`{3,})\s*$/
  let fenceIndent = ''

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]
    const withNl = idx < lines.length - 1 ? line + '\n' : line
    if (!inFence) {
      const m = openRe.exec(line)
      if (!m) {
        textBuf.push(withNl)
        continue
      }

      flushText()
      inFence = true
      fenceIndent = String(m[1] || '')
      fenceMarker = String(m[2] || '```')
      fenceInfo = String(m[3] || '').trim()
      openLineRaw = withNl
      fenceLinesRaw.length = 0
      continue
    }

    const m2 = closeRe.exec(line)
    if (m2 && String(m2[1] || '') === fenceIndent && String(m2[2] || '') === fenceMarker) {
      const content = fenceLinesRaw.join('')
      const raw = `${openLineRaw}${content}${withNl}`
      const lang = fenceInfo.split(/\s+/g)[0] || ''
      out.push({ kind: 'fence', raw, lang, content, closed: true })
      inFence = false
      fenceMarker = ''
      fenceIndent = ''
      fenceInfo = ''
      openLineRaw = ''
      fenceLinesRaw.length = 0
      continue
    }

    fenceLinesRaw.push(withNl)
  }

  if (inFence) {
    const content = fenceLinesRaw.join('')
    const raw = openLineRaw + content
    const lang = fenceInfo.split(/\s+/g)[0] || ''
    out.push({ kind: 'fence', raw, lang, content, closed: false })
    inFence = false
  }

  flushText()
  return out
}

function splitInlineCodeSpans(input: string): Array<{ kind: 'text' | 'code'; value: string }> {
  const s = String(input || '')
  const out: Array<{ kind: 'text' | 'code'; value: string }> = []
  let i = 0
  let last = 0

  while (i < s.length) {
    if (s[i] !== '`') {
      i++
      continue
    }

    let n = 1
    while (i + n < s.length && s[i + n] === '`') n++
    const marker = '`'.repeat(n)
    const start = i
    const end = s.indexOf(marker, i + n)
    if (end < 0) break

    if (start > last) out.push({ kind: 'text', value: s.slice(last, start) })
    out.push({ kind: 'code', value: s.slice(start, end + n) })
    i = end + n
    last = i
  }

  if (last < s.length) out.push({ kind: 'text', value: s.slice(last) })
  return out
}

function replaceMathOutsideInlineCode(input: string, acc: PreprocessedMath[]) {
  const parts = splitInlineCodeSpans(input)
  return parts
    .map((p) => {
      if (p.kind === 'code') return p.value
      return replaceMathInPlainText(p.value, acc)
    })
    .join('')
}

function replaceMathInPlainText(input: string, acc: PreprocessedMath[]) {
  let s = String(input || '')

  const stash = (tex: string, display: boolean) => {
    const id = acc.length
    acc.push({ tex: String(tex || ''), display })
    return `@@MATH_${display ? 'BLOCK' : 'INLINE'}_${id}@@`
  }

  // display: $$...$$
  s = s.replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_m, tex) => stash(String(tex || '').trim(), true))
  // display: \[...\]
  s = s.replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_m, tex) => stash(String(tex || '').trim(), true))

  // inline: \( ... \)
  s = s.replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, (_m, tex) => stash(String(tex || '').trim(), false))

  // inline: $...$（做一点防误判：必须像“公式”）
  s = s.replace(/\$([^\$\n]+?)\$/g, (m, tex) => {
    const t = String(tex || '').trim()
    if (!t) return m
    if (!/[A-Za-z\\]|[_^]/.test(t)) return m
    return stash(t, false)
  })

  return s
}
