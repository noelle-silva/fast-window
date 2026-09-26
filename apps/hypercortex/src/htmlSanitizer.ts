import DOMPurify from 'dompurify'

/**
 * 渲染内容的 HTML / SVG 安全消毒（宿主与面插件共用）。
 *
 * 从 Markdown 渲染引擎的消毒能力中抽离：策略本身不含任何面类型知识，
 * 属于通用渲染安全设施；docx 文档预览与面插件渲染产物共用同一实现。
 *
 * 策略三档：
 * - original：严格模式，外链仅允许 http/https/mailto，禁止 style/iframe/object/embed。
 * - baseline：宽松模式，服务渲染产物（允许 data-*、style、iframe 等），仅拦 javascript:。
 * - unsafe：原样返回（调用方自行保证内容可信）。
 */

export type RenderSafetyPolicy = 'original' | 'baseline' | 'unsafe'

function normalizePolicy(policy?: RenderSafetyPolicy): RenderSafetyPolicy {
  return policy === 'unsafe' ? 'unsafe' : policy === 'baseline' ? 'baseline' : 'original'
}

function isSafeHref(mode: RenderSafetyPolicy, href: unknown) {
  const s = String(href || '').trim().toLowerCase()
  if (mode === 'unsafe') return true
  if (mode === 'baseline') return !s.startsWith('javascript:')
  return s.startsWith('http://') || s.startsWith('https://') || s.startsWith('mailto:')
}

function isAllowedAttr(mode: RenderSafetyPolicy, tag: unknown, name: unknown) {
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

function sanitizeStyleValue(mode: RenderSafetyPolicy, style: unknown) {
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
    const value = p.slice(idx + 1).trim()
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

/* ------------------------------------------------------------------ */
/*  DOMPurify 属性钩子：全局注册一次，按调用时的活动策略动态校验            */
/* ------------------------------------------------------------------ */

let hooked = false
let activeMode: RenderSafetyPolicy = 'original'

function ensureHook() {
  if (hooked) return
  hooked = true
  if (!DOMPurify || typeof DOMPurify.addHook !== 'function') return
  DOMPurify.addHook('uponSanitizeAttribute', (_node: unknown, data: any) => {
    try {
      const name = String(data?.attrName || '').toLowerCase()
      if (name.startsWith('on')) data.keepAttr = false
      if (name === 'href' && data.attrValue && !isSafeHref(activeMode, data.attrValue)) data.keepAttr = false
      if (name === 'style') {
        const v = sanitizeStyleValue(activeMode, String(data.attrValue || ''))
        if (!v) data.keepAttr = false
        else data.attrValue = v
      }
    } catch (_) {}
  })
}

export function sanitizeHtml(html: unknown, policy?: RenderSafetyPolicy): string {
  const raw = String(html || '')
  const mode = normalizePolicy(policy)
  ensureHook()

  if (DOMPurify && typeof DOMPurify.sanitize === 'function') {
    try {
      if (mode === 'unsafe') return raw
      const prevMode = activeMode
      activeMode = mode
      try {
        if (mode === 'baseline') {
          return DOMPurify.sanitize(raw, {
            FORBID_TAGS: ['script'],
            ALLOW_DATA_ATTR: true,
            ADD_TAGS: ['button', 'details', 'summary', 'input', 'label', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'video', 'audio', 'source', 'iframe', 'object', 'embed', 'style'],
            ADD_ATTR: ['id', 'style', 'class', 'role', 'tabindex', 'colspan', 'rowspan', 'href', 'target', 'rel', 'title', 'src', 'alt', 'controls', 'autoplay', 'muted', 'loop', 'playsinline', 'poster', 'download', 'open', 'type', 'value', 'checked', 'disabled', 'placeholder', 'name', 'for', 'width', 'height'],
          })
        }
        return DOMPurify.sanitize(raw, {
          FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
          ALLOW_DATA_ATTR: true,
          ADD_TAGS: ['button', 'details', 'summary', 'input', 'label', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'audio', 'video', 'source'],
          ADD_ATTR: ['id', 'style', 'class', 'role', 'tabindex', 'colspan', 'rowspan', 'src', 'alt', 'controls', 'autoplay', 'muted', 'loop', 'playsinline', 'poster', 'type', 'width', 'height', 'href', 'target', 'rel', 'title', 'download'],
        })
      } finally {
        activeMode = prevMode
      }
    } catch (_) {}
  }

  // DOMPurify 不可用时的降级方案：TreeWalker 白名单过滤
  const tpl = document.createElement('template')
  tpl.innerHTML = raw

  const allowedTags = new Set(
    mode === 'baseline'
      ? ['DIV', 'SPAN', 'P', 'BR', 'PRE', 'CODE', 'EM', 'STRONG', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'A', 'BUTTON', 'DETAILS', 'SUMMARY', 'INPUT', 'LABEL', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'IMG', 'VIDEO', 'AUDIO', 'SOURCE', 'IFRAME', 'OBJECT', 'EMBED', 'STYLE']
      : ['DIV', 'SPAN', 'P', 'BR', 'PRE', 'CODE', 'EM', 'STRONG', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'A', 'BUTTON', 'DETAILS', 'SUMMARY', 'INPUT', 'LABEL', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'IMG', 'AUDIO', 'VIDEO', 'SOURCE'],
  )

  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT, null)
  const toRemove: Node[] = []

  while (walker.nextNode()) {
    const node = walker.currentNode
    if (node.nodeType === Node.COMMENT_NODE) { toRemove.push(node); continue }

    const el = node as Element
    const tag = String(el.tagName || '')
    if (!allowedTags.has(tag)) { el.replaceWith(document.createTextNode(el.textContent || '')); continue }

    const attrs = Array.from(el.attributes || [])
    for (const a of attrs) {
      const name = String(a.name || '').toLowerCase()
      if (!isAllowedAttr(mode, tag, name)) { el.removeAttribute(a.name); continue }
      if (name === 'style') {
        const v = sanitizeStyleValue(mode, el.getAttribute('style') || '')
        if (!v) el.removeAttribute('style')
        else el.setAttribute('style', v)
      }
    }

    if (tag === 'A') {
      const href = el.getAttribute('href') || ''
      if (href && !isSafeHref(mode, href)) el.removeAttribute('href')
      const target = String(el.getAttribute('target') || '').toLowerCase()
      if (target && target !== '_blank') el.removeAttribute('target')
      if (target === '_blank') el.setAttribute('rel', 'noopener noreferrer')
    }
  }

  for (const n of toRemove) n.parentNode?.removeChild(n)
  return tpl.innerHTML
}

export function sanitizeSvg(svg: unknown, policy?: RenderSafetyPolicy): string {
  const raw = String(svg || '')
  if (!raw) return ''
  const mode = normalizePolicy(policy)
  if (mode === 'unsafe') return raw
  if (mode === 'baseline') {
    return raw
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/\son[a-z0-9_-]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\shref\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*'|\s*javascript:[^\s>]+)/gi, '')
  }
  if (DOMPurify && typeof DOMPurify.sanitize === 'function') {
    try { return DOMPurify.sanitize(raw, { USE_PROFILES: { svg: true, svgFilters: true } }) } catch (_) {}
  }
  return raw
}
