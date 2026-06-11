import type { BoolRef, RenderSafetyPolicy } from './types'

export function createHtmlSanitizer(domPurifyHooked: BoolRef) {
  function sanitizeHtml(html: unknown, policy?: RenderSafetyPolicy) {
    const raw = String(html || '')
    const mode: RenderSafetyPolicy = policy === 'unsafe' ? 'unsafe' : policy === 'baseline' ? 'baseline' : 'original'

    function isSafeHref(href: unknown) {
      const value = String(href || '').trim().toLowerCase()
      if (mode === 'unsafe') return true
      if (mode === 'baseline') return !value.startsWith('javascript:')
      return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('mailto:')
    }

    function sanitizeStyleValue(style: unknown) {
      const rawStyle = String(style || '')
      if (!rawStyle.trim()) return ''
      const out: string[] = []
      for (const item of rawStyle.split(';')) {
        const part = item.trim()
        if (!part) continue
        const splitIndex = part.indexOf(':')
        if (splitIndex <= 0) continue
        const key = part.slice(0, splitIndex).trim().toLowerCase()
        const value = part.slice(splitIndex + 1).trim()
        if (!key || !value) continue
        const loweredValue = value.toLowerCase()
        if (mode === 'unsafe') return rawStyle
        if (loweredValue.includes('expression(') || loweredValue.includes('javascript:')) continue
        if (mode !== 'baseline' && (loweredValue.includes('@import') || loweredValue.includes('url('))) continue
        if (value.includes('<') || value.includes('>')) continue
        out.push(`${key}:${value}`)
      }
      return out.join(';')
    }

    const domPurify = (window as any).DOMPurify
    if (domPurify?.sanitize) {
      if (!domPurifyHooked.value && domPurify.addHook) {
        domPurifyHooked.value = true
        domPurify.addHook('uponSanitizeAttribute', (_node: unknown, data: any) => {
          const name = String(data?.attrName || '').toLowerCase()
          if (name.startsWith('on')) data.keepAttr = false
          if (name === 'href' && data.attrValue && !isSafeHref(data.attrValue)) data.keepAttr = false
          if (name === 'style') {
            const value = sanitizeStyleValue(String(data.attrValue || ''))
            if (!value) data.keepAttr = false
            else data.attrValue = value
          }
        })
      }

      if (mode === 'unsafe') return raw
      if (mode === 'baseline') {
        return domPurify.sanitize(raw, {
          FORBID_TAGS: ['script'],
          ALLOW_DATA_ATTR: true,
          ADD_TAGS: ['button', 'details', 'summary', 'input', 'label', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'video', 'audio', 'source', 'iframe', 'object', 'embed', 'style'],
          ADD_ATTR: ['id', 'style', 'class', 'role', 'tabindex', 'colspan', 'rowspan', 'href', 'target', 'rel', 'title', 'src', 'alt', 'controls', 'autoplay', 'muted', 'loop', 'playsinline', 'poster', 'download', 'open', 'type', 'value', 'checked', 'disabled', 'placeholder', 'name', 'for', 'width', 'height'],
        })
      }
      return domPurify.sanitize(raw, {
        FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
        ALLOW_DATA_ATTR: true,
        ADD_TAGS: ['button', 'details', 'summary', 'input', 'label', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
        ADD_ATTR: ['id', 'style', 'class', 'role', 'tabindex', 'colspan', 'rowspan'],
      })
    }

    return sanitizeHtmlWithTemplate(raw, mode, isSafeHref, sanitizeStyleValue)
  }

  return { sanitizeHtml }
}

function sanitizeHtmlWithTemplate(
  raw: string,
  mode: RenderSafetyPolicy,
  isSafeHref: (href: unknown) => boolean,
  sanitizeStyleValue: (style: unknown) => string,
) {
  const template = document.createElement('template')
  template.innerHTML = raw
  const allowedTags = new Set(
    mode === 'baseline'
      ? ['DIV', 'SPAN', 'P', 'BR', 'PRE', 'CODE', 'EM', 'STRONG', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'A', 'BUTTON', 'DETAILS', 'SUMMARY', 'INPUT', 'LABEL', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'IMG', 'VIDEO', 'AUDIO', 'SOURCE', 'IFRAME', 'OBJECT', 'EMBED', 'STYLE']
      : ['DIV', 'SPAN', 'P', 'BR', 'PRE', 'CODE', 'EM', 'STRONG', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'A', 'BUTTON', 'DETAILS', 'SUMMARY', 'INPUT', 'LABEL', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR'],
  )
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT, null)
  const toRemove: Node[] = []

  while (walker.nextNode()) {
    const node = walker.currentNode
    if (node.nodeType === Node.COMMENT_NODE) {
      toRemove.push(node)
      continue
    }

    const element = node as Element
    const tag = String(element.tagName || '')
    if (!allowedTags.has(tag)) {
      element.replaceWith(document.createTextNode(element.textContent || ''))
      continue
    }

    for (const attr of Array.from(element.attributes || [])) {
      const name = String(attr.name || '').toLowerCase()
      if (name.startsWith('on')) {
        element.removeAttribute(attr.name)
        continue
      }
      if (name === 'href' && !isSafeHref(attr.value)) element.removeAttribute(attr.name)
      if (name === 'style') {
        const value = sanitizeStyleValue(attr.value)
        if (!value) element.removeAttribute(attr.name)
        else element.setAttribute(attr.name, value)
      }
    }

    if (tag === 'A') {
      const target = String(element.getAttribute('target') || '').toLowerCase()
      if (target && target !== '_blank') element.removeAttribute('target')
      if (target === '_blank') element.setAttribute('rel', 'noopener noreferrer')
    }
  }

  for (const node of toRemove) node.parentNode?.removeChild(node)
  return template.innerHTML
}

export function sanitizeSvg(svg: unknown, policy?: RenderSafetyPolicy) {
  const raw = String(svg || '')
  if (!raw) return ''
  const mode: RenderSafetyPolicy = policy === 'unsafe' ? 'unsafe' : policy === 'baseline' ? 'baseline' : 'original'
  if (mode === 'unsafe') return raw
  if (mode === 'baseline') {
    return raw
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/\son[a-z0-9_-]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\shref\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*'|\s*javascript:[^\s>]+)/gi, '')
  }
  const domPurify = (window as any).DOMPurify
  if (domPurify?.sanitize) return domPurify.sanitize(raw, { USE_PROFILES: { svg: true, svgFilters: true } })
  return raw
}
