import { uid, esc } from '../core/utils'

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

  function initMermaidOnce() {
    const m = (window as any).mermaid
    if (mermaidInited || !m || !m.initialize) return
    try {
      mermaidInited = true
      m.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
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

  function preprocessMathBlocks(source: unknown) {
    const blocks: string[] = []
    const src = String(source || '').replace(/\r\n/g, '\n')

    function stash(tex: unknown) {
      const id = blocks.length
      blocks.push(String(tex || ''))
      return `@@BLOCK_MATH_${id}@@`
    }

    function replaceInText(text: unknown) {
      let s = String(text || '')
      s = s.replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_m, tex) => stash(tex))
      s = s.replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_m, tex) => stash(tex))
      return s
    }

    const fenceRe = /```[\s\S]*?```/g
    let out = ''
    let last = 0
    let m: RegExpExecArray | null
    while ((m = fenceRe.exec(src))) {
      out += replaceInText(src.slice(last, m.index))
      out += m[0]
      last = m.index + m[0].length
    }
    out += replaceInText(src.slice(last))

    return { text: out, blocks }
  }

  function preprocessHtmlIndentation(source: unknown) {
    const src = String(source || '').replace(/\r\n/g, '\n')
    const fenceRe = /```[\s\S]*?```/g

    function dedentHtmlLines(s: unknown) {
      const t = String(s || '')
      // Markdown：4 空格缩进会被当作代码块；HTML 内部常见缩进会触发这个坑。
      // 仅在“非代码围栏”区域，把以 4 空格/Tab 开头且后面紧跟 < 或 <!-- 的行去掉缩进。
      return t.replace(/^(?:\t| {4})+(?=<)/gm, '').replace(/^(?:\t| {4})+(?=<!--)/gm, '')
    }

    let out = ''
    let last = 0
    let m: RegExpExecArray | null
    while ((m = fenceRe.exec(src))) {
      out += dedentHtmlLines(src.slice(last, m.index))
      out += m[0]
      last = m.index + m[0].length
    }
    out += dedentHtmlLines(src.slice(last))
    return out
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

      try {
        const id = uid('mm')
        const r = await doRender(id, src, holder)
        const svg = typeof r === 'string' ? r : String(r?.svg || '')
        const safe = sanitizeSvg(svg)
        if (!safe) throw new Error('empty svg')
        holder.innerHTML = safe
        if (r && typeof r.bindFunctions === 'function') {
          try {
            r.bindFunctions(holder)
          } catch (_) {}
        }
      } catch (_) {
        holder.innerHTML = `<pre><code class="language-mermaid">${esc(src)}</code></pre>`
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
    const pre = preprocessMathBlocks(noIndent)
    const src = String(pre.text || '')

    function looksLikeHtmlFragment(input: unknown) {
      const t = String(input || '').trimStart()
      if (!t) return false
      if (t.startsWith('```')) return false
      return /^<(div|span|p|pre|code|em|strong|ul|ol|li|blockquote|a|button|details|summary|input|label|table|thead|tbody|tr|th|td|h[1-6]|hr|br|img)\b/i.test(
        t,
      )
    }

    if (looksLikeHtmlFragment(src)) {
      // 直接渲染 HTML（仍会经过 sanitizeHtml 过滤）。
      // 这样即使 markdown 渲染器缺失/异常，也不会把 <div ...> 当纯文本展示。
      html = src
    } else if ((window as any).marked && typeof (window as any).marked.parse === 'function') {
      try {
        ;(window as any).marked.setOptions?.({ gfm: true, breaks: true })
        html = (window as any).marked.parse(src)
      } catch (_) {
        html = `<pre>${esc(src)}</pre>`
      }
    } else {
      html = `<pre>${esc(src)}</pre>`
    }

    let safe = sanitizeHtml(html)
    if (Array.isArray(pre.blocks) && pre.blocks.length) {
      safe = safe.replace(/@@BLOCK_MATH_(\d+)@@/g, (_m, id) => {
        const tex = pre.blocks[Number(id)] ?? ''
        return `<div class="math-block" data-tex="${esc(tex)}"></div>`
      })
    }

    el.innerHTML = safe
    markPreviewImages(el)

    // 块级公式：优先用 katex.render（避免 $$ 换行/BR 导致 auto-render 识别失败）
    const blocks = Array.from(el.querySelectorAll?.('.math-block[data-tex]') || [])
    const w = window as any
    if (blocks.length && w.katex && w.katex.render) {
      for (const b of blocks) {
        if (!(b instanceof HTMLElement)) continue
        if (b.getAttribute('data-rendered') === '1') continue
        const tex = b.getAttribute('data-tex') || ''
        try {
          w.katex.render(tex, b, { displayMode: true, throwOnError: false })
          b.setAttribute('data-rendered', '1')
        } catch (_) {}
      }
    }

    if (w.renderMathInElement) {
      try {
        w.renderMathInElement(el, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '\\[', right: '\\]', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\(', right: '\\)', display: false },
          ],
          throwOnError: false,
        })
      } catch (_) {}
    }

    renderMermaidInto(el).catch(() => {})
  }

  return { ensureRenderer, sanitizeHtml, sanitizeSvg, renderAssistantInto }
}

