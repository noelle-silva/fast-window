import type { BoolRef, RenderSafetyPolicy } from './types'

export function createHtmlSanitizer(domPurifyHooked: BoolRef) {
  function sanitizeHtml(html: unknown, policy?: RenderSafetyPolicy) {
    const raw = String(html || '')
    const mode: RenderSafetyPolicy = policy === 'unsafe' ? 'unsafe' : policy === 'baseline' ? 'baseline' : 'original'

    function isSafeHref(href: unknown) {
      const s = String(href || '').trim().toLowerCase()
      if (mode === 'unsafe') return true
      if (mode === 'baseline') return !s.startsWith('javascript:')
      return s.startsWith('http://') || s.startsWith('https://') || s.startsWith('mailto:')
    }

    function isAllowedAttr(tag: unknown, name: unknown) {
      const n = String(name || '').toLowerCase()
      const t = String(tag || '').toUpperCase()

      if (!n) return false
      if (n.startsWith('on')) return false
      if (mode === 'unsafe') return true
      if (mode === 'baseline') {
        if (n === 'id' || n === 'class' || n === 'style') return true
        if (n.startsWith('data-')) return true
        if (n.startsWith('aria-') || n === 'role' || n === 'tabindex' || n === 'title') return true
        if (t === 'A') return n === 'href' || n === 'target' || n === 'rel' || n === 'download'
        return true
      }
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
        if (mode === 'unsafe') return s
        if (mode === 'baseline') {
          if (v.includes('expression(') || v.includes('javascript:')) continue
          if (value.includes('<') || value.includes('>')) continue
          out.push(`${key}:${value}`)
          continue
        }
        if (v.includes('expression(') || v.includes('javascript:') || v.includes('@import') || v.includes('url(')) continue
        if (value.includes('<') || value.includes('>')) continue
        out.push(`${key}:${value}`)
      }
      return out.join(';')
    }

    const w = window as any
    if (w.DOMPurify && w.DOMPurify.sanitize) {
      try {
        if (!domPurifyHooked.value && w.DOMPurify.addHook) {
          domPurifyHooked.value = true
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

        if (mode === 'unsafe') return raw
        if (mode === 'baseline') {
          return w.DOMPurify.sanitize(raw, {
            FORBID_TAGS: ['script'],
            ALLOW_DATA_ATTR: true,
            ADD_TAGS: ['button', 'details', 'summary', 'input', 'label', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'video', 'audio', 'source', 'iframe', 'object', 'embed', 'style'],
            ADD_ATTR: ['id', 'style', 'class', 'role', 'tabindex', 'colspan', 'rowspan', 'href', 'target', 'rel', 'title', 'src', 'alt', 'controls', 'autoplay', 'muted', 'loop', 'playsinline', 'poster', 'download', 'open', 'type', 'value', 'checked', 'disabled', 'placeholder', 'name', 'for', 'width', 'height'],
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

    const allowedTags = new Set(
      mode === 'baseline'
        ? [
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
            'IMG',
            'VIDEO',
            'AUDIO',
            'SOURCE',
            'IFRAME',
            'OBJECT',
            'EMBED',
            'STYLE',
          ]
        : [
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
          ],
    )

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

    for (const n of toRemove) n.parentNode?.removeChild(n)
    return tpl.innerHTML
  }

  return { sanitizeHtml }
}

export function sanitizeSvg(svg: unknown, policy?: RenderSafetyPolicy) {
  const raw = String(svg || '')
  if (!raw) return ''
  const mode: RenderSafetyPolicy = policy === 'unsafe' ? 'unsafe' : policy === 'baseline' ? 'baseline' : 'original'
  const w = window as any
  if (mode === 'unsafe') return raw
  if (mode === 'baseline') {
    return raw
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/\son[a-z0-9_-]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\shref\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*'|\s*javascript:[^\s>]+)/gi, '')
  }
  if (w.DOMPurify && w.DOMPurify.sanitize) {
    try {
      return w.DOMPurify.sanitize(raw, { USE_PROFILES: { svg: true, svgFilters: true } })
    } catch (_) {}
  }
  return raw
}

