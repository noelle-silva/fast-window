import { uid, esc } from '../core/utils'
import './vendor'
import { parseToolRequestCalls } from '@noelle-silva/eucli-aitoolcall-sdk'
import { presetVarsToInlineStyle, type ToolRequestRenderPreset } from '../core/toolRequestPresets'

export type AssistantRenderEngine = {
  ensureRenderer: () => Promise<void>
  sanitizeHtml: (html: unknown) => string
  sanitizeSvg: (svg: unknown) => string
  renderAssistantInto: (
    el: unknown,
    text: unknown,
    options?: {
      stickersEnabled?: boolean
      getStickerPath?: (category: string, name: string) => string
      toolRequestPreset?: ToolRequestRenderPreset | null
    },
  ) => void
}

export function createDefaultAssistantRenderEngine(): AssistantRenderEngine {
  let rendererPromise: Promise<void> | null = null
  let domPurifyHooked = false
  let mermaidInited = false
  let markedConfigured = false
  let toolReqCssInited = false
  const mermaidSvgCache = new Map<string, string>()
  const refImgCache = new Map<string, string>()
  const refImgPending = new Set<string>()
  const REF_IMG_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA='

  const ICON_COPY =
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M16 1H6c-1.1 0-2 .9-2 2v12h2V3h10V1zm3 4H10c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h9c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16h-9V7h9v14z"/></svg>'
  const ICON_AI =
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M11 2l1.4 4.2L17 8l-4.6 1.8L11 14l-1.4-4.2L5 8l4.6-1.8L11 2zm8 7l.9 2.6L23 13l-3.1 1.4L19 17l-.9-2.6L15 13l3.1-1.4L19 9zM6 14l1.2 3.6L11 19l-3.8 1.4L6 24l-1.2-3.6L1 19l3.8-1.4L6 14z"/></svg>'
  const ICON_OK =
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>'
  const ICON_FAIL =
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>'

  function ensureToolReqCssOnce() {
    if (toolReqCssInited) return
    toolReqCssInited = true
    try {
      const id = 'fw-toolreq-css'
      if (document.getElementById(id)) return
      const s = document.createElement('style')
      s.id = id
      s.textContent = `
@keyframes fw-toolreq-flow-x{0%{background-position:0% 50%;}100%{background-position:200% 50%;}}
@media (prefers-reduced-motion: reduce){details.fw-toolreq{animation:none !important;}}
`
      document.head.appendChild(s)
    } catch (_) {}
  }

  function renderToolRequestHtml(preset: ToolRequestRenderPreset | null, summaryHtml: string, detailText: string) {
    const summary = String(summaryHtml || '')
    const detail = esc(String(detailText || ''))

    const badgeText = preset && typeof (preset as any).badgeText === 'string' ? String((preset as any).badgeText || '').trim().slice(0, 16) : ''
    const varsInline = presetVarsToInlineStyle(preset && typeof (preset as any).vars === 'object' ? (preset as any).vars : null)
    const varsEsc = varsInline ? esc(varsInline) : ''
    const varsPart = varsEsc ? `;${varsEsc}` : ''

    const badge =
      badgeText && badgeText.trim()
        ? `<span aria-hidden="true" style="display:inline-flex; align-items:center; justify-content:center; height:18px; padding:0 8px; border-radius:999px; background:var(--fw-toolreq-badge-bg, rgba(245,158,11,.10)); border:1px solid var(--fw-toolreq-badge-border, rgba(245,158,11,.18)); color:var(--fw-toolreq-badge-color, rgba(245,158,11,.92)); letter-spacing:.08em; font-size:11px; font-weight:900;">${esc(badgeText)}</span>`
        : ''

    return (
      `<details class="fw-toolreq" data-fw-toolreq="1" style="margin:10px 0; border:1px solid var(--fw-toolreq-border, rgba(245,158,11,.25)); background:var(--fw-toolreq-bg, rgba(245,158,11,.05)); background-size:var(--fw-toolreq-bg-size, auto); background-position:var(--fw-toolreq-bg-pos, 0% 50%); animation:var(--fw-toolreq-bg-anim, none); box-shadow:var(--fw-toolreq-shadow, none); border-radius:var(--fw-toolreq-radius, 12px); padding:var(--fw-toolreq-pad, 8px 10px); backdrop-filter:var(--fw-toolreq-backdrop, none); -webkit-backdrop-filter:var(--fw-toolreq-backdrop, none)${varsPart}">` +
      `<summary data-fw-toolreq-summary="1" style="cursor:pointer; user-select:none; -webkit-user-select:none; font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; font-size:12px; white-space:pre-line; outline:none; color:var(--fw-toolreq-summary-color, inherit);">` +
      `<span style="display:inline-flex; align-items:center; gap:8px;">` +
      `${badge}` +
      `<span style="min-width:0;">${summary}</span>` +
      `</span>` +
      `</summary>` +
      `<div data-fw-toolreq-body="1" style="overflow:hidden; max-height:0px; opacity:0; transform:translateY(-2px); transition:max-height 240ms ease, opacity 180ms ease, transform 240ms ease; will-change:max-height,opacity,transform;">` +
      `<pre style="margin:10px 0 0 0; padding:var(--fw-toolreq-pre-pad, 8px 10px); background:var(--fw-toolreq-pre-bg, rgba(255,255,255,.7)); border:1px solid var(--fw-toolreq-pre-border, rgba(245,158,11,.18)); border-radius:var(--fw-toolreq-pre-radius, 10px); white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-word; font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; font-size:12px; color:var(--fw-toolreq-pre-color, inherit);">${detail}</pre>` +
      `</div>` +
      `</details>`
    )
  }

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

  function setMermaidFixBtnState(btn: HTMLButtonElement, state: 'ai' | 'loading' | 'ok' | 'fail') {
    if (state === 'loading') {
      btn.textContent = '…'
      btn.removeAttribute('data-state')
      btn.setAttribute('title', 'AI 修复中…')
      btn.setAttribute('aria-label', 'AI 修复中…')
      return
    }
    if (state === 'ok') {
      btn.innerHTML = ICON_OK
      btn.setAttribute('data-state', 'ok')
      btn.setAttribute('title', '已替换')
      btn.setAttribute('aria-label', '已替换')
      return
    }
    if (state === 'fail') {
      btn.innerHTML = ICON_FAIL
      btn.setAttribute('data-state', 'fail')
      btn.setAttribute('title', '修复失败')
      btn.setAttribute('aria-label', '修复失败')
      return
    }

    btn.innerHTML = ICON_AI
    btn.removeAttribute('data-state')
    btn.setAttribute('title', 'AI 修复 Mermaid')
    btn.setAttribute('aria-label', 'AI 修复 Mermaid')
  }

  function ensureMermaidErrorCopyHandlerOnce(root: HTMLElement) {
    if (root.getAttribute('data-fw-mmerr-copy-hook') === '1') return
    root.setAttribute('data-fw-mmerr-copy-hook', '1')

    root.addEventListener('click', (e) => {
      const target = e.target instanceof Element ? e.target : null
      const btn = target?.closest?.('button[data-act="copy-mermaid-src"]')
      if (!(btn instanceof HTMLButtonElement)) return

      const box = btn.closest('.mermaid-error-box')
      const srcEl = box?.querySelector?.('.mermaid-error-src')
      const text = srcEl ? String(srcEl.textContent || '') : ''
      if (!text.trim()) return

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

  function ensureMermaidErrorAiFixHandlerOnce(root: HTMLElement) {
    if (root.getAttribute('data-fw-mmerr-aifix-hook') === '1') return
    root.setAttribute('data-fw-mmerr-aifix-hook', '1')

    root.addEventListener('click', (e) => {
      const target = e.target instanceof Element ? e.target : null
      const btn = target?.closest?.('button[data-act="ai-fix-mermaid"]')
      if (!(btn instanceof HTMLButtonElement)) return

      const box = btn.closest('.mermaid-error-box')
      const srcEl = box?.querySelector?.('.mermaid-error-src')
      const errEl = box?.querySelector?.('.mermaid-error-err')
      const src = srcEl ? String(srcEl.textContent || '') : ''
      const errMsg = errEl ? String(errEl.textContent || '') : ''
      if (!src.trim()) return

      const midEl = btn.closest('[data-mid]')
      const messageId = midEl instanceof HTMLElement ? String(midEl.getAttribute('data-mid') || '') : ''

      const w = window as any
      const controller = w.__fastWindowAiChat
      const fn = controller?.actions?.aiFixMermaid
      if (typeof fn !== 'function') {
        w.fastWindow?.ui?.showToast?.('未找到 aiFixMermaid 接口（请更新插件）')
        return
      }

      btn.disabled = true
      setMermaidFixBtnState(btn, 'loading')

      Promise.resolve()
        .then(() => fn(messageId, src, errMsg))
        .then((fixed: any) => {
          try {
            const next = String(fixed || '').trim()
            if (next && srcEl instanceof HTMLElement) srcEl.textContent = next
            const msgEl = box?.querySelector?.('.mermaid-error-msg')
            if (next && msgEl instanceof HTMLElement) msgEl.textContent = '已替换，正在重新渲染…'
          } catch (_) {}

          setMermaidFixBtnState(btn, 'ok')
          w.fastWindow?.ui?.showToast?.('Mermaid 已替换')

          try {
            if (midEl instanceof HTMLElement && messageId) {
              const chat = controller?.activeChat?.()
              const msgs = Array.isArray(chat?.messages) ? chat.messages : []
              const m = msgs.find((x: any) => String(x?.id || '') === messageId) || null
              if (m) controller?.renderAssistantInto?.(midEl, String(m?.content || ''))
            }
          } catch (_) {}
        })
        .catch((err) => {
          setMermaidFixBtnState(btn, 'fail')
          w.fastWindow?.ui?.showToast?.(String(err?.message || err || 'AI 修复失败'))
        })
        .finally(() => {
          window.setTimeout(() => {
            if (!btn.isConnected) return
            setMermaidFixBtnState(btn, 'ai')
            btn.disabled = false
          }, 1200)
      })
    })
  }

  function ensureToolRequestToggleHandlerOnce(root: HTMLElement) {
    if (root.getAttribute('data-fw-toolreq-hook') === '1') return
    root.setAttribute('data-fw-toolreq-hook', '1')

    function toggle(details: HTMLElement, body: HTMLElement) {
      const isOpen = details.hasAttribute('open')

      // Reset "none" to compute scrollHeight correctly.
      if (body.style.maxHeight === 'none') body.style.maxHeight = ''

      if (!isOpen) {
        details.setAttribute('open', '')
        body.style.overflow = 'hidden'
        body.style.maxHeight = '0px'
        body.style.opacity = '0'
        body.style.transform = 'translateY(-2px)'
        body.getBoundingClientRect()
        const h = body.scrollHeight
        body.style.maxHeight = `${h}px`
        body.style.opacity = '1'
        body.style.transform = 'translateY(0)'
        return
      }

      const h = body.scrollHeight
      body.style.overflow = 'hidden'
      body.style.maxHeight = `${h}px`
      body.style.opacity = '1'
      body.style.transform = 'translateY(0)'
      body.getBoundingClientRect()
      body.style.maxHeight = '0px'
      body.style.opacity = '0'
      body.style.transform = 'translateY(-2px)'

      window.setTimeout(() => {
        if (!details.isConnected) return
        // If user re-opened quickly, do not close.
        if (!details.hasAttribute('open')) return
        details.removeAttribute('open')
      }, 260)
    }

    root.addEventListener('mousedown', (e) => {
      const target = e.target instanceof Element ? e.target : null
      const summary = target?.closest?.('summary[data-fw-toolreq-summary="1"]')
      if (!(summary instanceof HTMLElement)) return
      // Avoid text-selection flash on click.
      e.preventDefault()
    })

    root.addEventListener('click', (e) => {
      const target = e.target instanceof Element ? e.target : null
      const summary = target?.closest?.('summary[data-fw-toolreq-summary="1"]')
      if (!(summary instanceof HTMLElement)) return
      const details = summary.closest('details.fw-toolreq')
      if (!(details instanceof HTMLElement)) return
      const body = details.querySelector?.('[data-fw-toolreq-body="1"]')
      if (!(body instanceof HTMLElement)) return
      e.preventDefault()
      toggle(details, body)
    })

    root.addEventListener('keydown', (e) => {
      const ev = e as KeyboardEvent
      const k = String(ev.key || '')
      if (k !== 'Enter' && k !== ' ') return
      const target = ev.target instanceof Element ? ev.target : null
      const summary = target?.closest?.('summary[data-fw-toolreq-summary="1"]')
      if (!(summary instanceof HTMLElement)) return
      const details = summary.closest('details.fw-toolreq')
      if (!(details instanceof HTMLElement)) return
      const body = details.querySelector?.('[data-fw-toolreq-body="1"]')
      if (!(body instanceof HTMLElement)) return
      ev.preventDefault()
      toggle(details, body)
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
      // 注意：有些模型会输出“空格+Tab”的混合缩进；Markdown 的缩进宽度是按列计算的（Tab 会补到 4 的倍数）。
      // 这里把这类行的前导缩进压到 <4 列（保留 0~3 个空格），避免被 marked 识别成缩进代码块。
      return t.replace(/^([ \t]+)(?=<|<!--)/gm, (_m, ws) => {
        const w = String(ws || '')
        let cols = 0
        for (let i = 0; i < w.length; i++) {
          cols += w[i] === '\t' ? 4 - (cols % 4) : 1
        }
        if (cols < 4) return w
        return ' '.repeat(cols % 4)
      })
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
      holder.setAttribute('data-mermaid', '0')
      pre.replaceWith(holder)

      const cached = mermaidSvgCache.get(src)
      if (typeof cached === 'string' && cached) {
        holder.innerHTML = cached
        holder.setAttribute('data-mermaid', '1')
        holder.setAttribute('data-act', 'open-mermaid')
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
        holder.setAttribute('data-mermaid', '1')
        holder.setAttribute('data-act', 'open-mermaid')
        if (r && typeof r.bindFunctions === 'function') {
          try {
            r.bindFunctions(holder)
          } catch (_) {}
        }
      } catch (e) {
        const errRaw = String((e as any)?.message || e || '').trim()
        const msg = esc(errRaw).trim()
        holder.removeAttribute('data-act')
        holder.removeAttribute('data-mermaid')
        holder.className = 'mermaid-error'
        holder.setAttribute('data-mermaid-error', '1')
        holder.innerHTML = `
          <div class="mermaid-error-box" role="alert">
            <button class="mermaid-error-fix" type="button" data-act="ai-fix-mermaid" title="AI 修复 Mermaid" aria-label="AI 修复 Mermaid">${ICON_AI}</button>
            <button class="mermaid-error-copy" type="button" data-act="copy-mermaid-src" title="复制 Mermaid 源码" aria-label="复制 Mermaid 源码">${ICON_COPY}</button>
            <div class="mermaid-error-title">Mermaid 渲染失败</div>
            <div class="mermaid-error-msg">${msg || '未知错误'}</div>
            <pre class="mermaid-error-src" aria-hidden="true">${esc(src)}</pre>
            <pre class="mermaid-error-err" aria-hidden="true">${esc(errRaw)}</pre>
          </div>
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

  function ensureMathCopyHandlerOnce(root: unknown) {
    if (!(root instanceof HTMLElement)) return
    const ds: any = root.dataset as any
    if (ds.fwMathCopyBound === '1') return
    ds.fwMathCopyBound = '1'

    root.addEventListener('click', e => {
      try {
        const target = e.target as any
        const btn = target && typeof target.closest === 'function' ? target.closest('.fw-math-copy') : null
        if (!(btn instanceof HTMLElement)) return

        const host = btn.closest('.fw-math-host')
        if (!(host instanceof HTMLElement)) return

        const tex = String(host.getAttribute('data-tex') || '').trim()
        if (!tex) return
        const isBlock = host.classList.contains('math-block')
        const copyText = isBlock ? `$$\n${tex}\n$$` : `$${tex}$`

        e.preventDefault()
        e.stopPropagation()

        const w = window as any
        const writeText =
          w?.fastWindow?.clipboard?.writeText ||
          (navigator?.clipboard && typeof navigator.clipboard.writeText === 'function' ? navigator.clipboard.writeText.bind(navigator.clipboard) : null)

        Promise.resolve()
          .then(() => (writeText ? writeText(copyText) : null))
          .then(() => {
            try {
              w?.fastWindow?.ui?.showToast?.('已复制公式')
            } catch (_) {}
          })
          .catch(() => {})
      } catch (_) {}
    })
  }

  function enhanceMathCopyButtons(root: unknown) {
    if (!(root instanceof HTMLElement)) return

    const nodes = Array.from(root.querySelectorAll?.('.math-block[data-tex], .math-inline[data-tex]') || [])
    for (const n of nodes) {
      if (!(n instanceof HTMLElement)) continue
      if (n.getAttribute('data-fw-math') === '1') continue
      n.setAttribute('data-fw-math', '1')
      n.classList.add('fw-math-host')

      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'fw-math-copy'
      btn.setAttribute('aria-label', '复制 LaTeX 公式')
      btn.textContent = '⧉'
      n.appendChild(btn)
    }

    ensureMathCopyHandlerOnce(root)
  }

  function hydrateRefImages(root: unknown) {
    if (!(root instanceof HTMLElement)) return

    const w = window as any
    const read = w?.fastWindow?.files?.images?.read
    if (typeof read !== 'function') return

    const els = Array.from(root.querySelectorAll?.('img[data-ref-img]') || [])
    const byPath = new Map<string, HTMLImageElement[]>()

    for (const el of els) {
      if (!(el instanceof HTMLImageElement)) continue
      const path = String(el.getAttribute('data-ref-img') || '').trim()
      if (!path) continue

      const cached = refImgCache.get(path)
      if (typeof cached === 'string' && cached) {
        el.src = cached
        continue
      }

      const list = byPath.get(path) || []
      list.push(el)
      byPath.set(path, list)
    }

    for (const [path, list] of byPath) {
      if (refImgPending.has(path)) continue
      refImgPending.add(path)
      Promise.resolve()
        .then(() => read({ scope: 'data', path }))
        .then((dataUrl: unknown) => {
          const src = typeof dataUrl === 'string' && dataUrl.startsWith('data:') ? dataUrl : ''
          if (src) refImgCache.set(path, src)
          for (const img of list) {
            if (!(img instanceof HTMLImageElement)) continue
            if (!img.isConnected) continue
            if (src) img.src = src
          }
        })
        .catch(() => {})
        .finally(() => {
          refImgPending.delete(path)
        })
    }
  }

  function renderAssistantInto(
    el: unknown,
    text: unknown,
    options?: {
      stickersEnabled?: boolean
      getStickerPath?: (category: string, name: string) => string
      toolRequestPreset?: ToolRequestRenderPreset | null
    },
  ) {
    if (!(el instanceof HTMLElement)) return
    ensureToolReqCssOnce()
    const raw = String(text || '')
    let html = ''

    const noIndent = preprocessHtmlIndentation(raw)
    const toolReqPreset = (options as any)?.toolRequestPreset
    const pre = preprocessAssistantContent(noIndent, { stickersEnabled: !!options?.stickersEnabled })
    const src = String(pre.text || '')
    const getStickerPath = typeof options?.getStickerPath === 'function' ? options.getStickerPath : null

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
    if (Array.isArray(pre.toolRequests) && pre.toolRequests.length) {
      safe = safe.replace(/@@TOOL_REQUEST_(\d+)@@/g, (_m, id) => {
        const it = pre.toolRequests[Number(id)] || null
        if (!it) return ''

        const toolNames = Array.isArray(it.toolNames) ? it.toolNames : []
        const summary = toolNames.length ? toolNames.map((n) => esc(String(n || '').trim() || '(无 tool_name)')).join('<br/>') : esc('(工具调用解析失败)')
        const detailText = String(it.detailText || '')
        return renderToolRequestHtml(toolReqPreset, summary, detailText)
      })
    }
    if (Array.isArray(pre.stickers) && pre.stickers.length) {
      safe = safe.replace(/@@STICKER_(\d+)@@/g, (_m, id) => {
        const it = pre.stickers[Number(id)] || null
        if (!it) return ''
        const rawToken = String(it.raw || '')
        const category = String(it.category || '')
        const name = String(it.name || '')
        const size = typeof it.size === 'number' && Number.isFinite(it.size) ? Math.round(it.size) : 0
        const label = category && name ? `${category}/${name}` : rawToken
        const relPath = getStickerPath ? String(getStickerPath(category, name) || '').trim() : ''
        if (!relPath) return `<span class="fw-sticker-miss">${esc(rawToken)}</span>`
        const sizeAttr = size > 0 ? ` data-fw-sticker-size="${String(size)}"` : ''
        return `<img class="fw-sticker" data-fw-img="1" data-ref-img="${esc(relPath)}"${sizeAttr} src="${REF_IMG_PLACEHOLDER}" alt="${esc(name || 'sticker')}" title="${esc(label)}" />`
      })
    }

    el.innerHTML = safe
    enhanceCodeBlocks(el)
    ensureMermaidErrorCopyHandlerOnce(el)
    ensureMermaidErrorAiFixHandlerOnce(el)
    ensureToolRequestToggleHandlerOnce(el)
    markPreviewImages(el)
    hydrateStickerSizes(el)
    hydrateRefImages(el)

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
      enhanceMathCopyButtons(el)
    }

    renderMermaidInto(el).catch(() => {})
  }

  return { ensureRenderer, sanitizeHtml, sanitizeSvg, renderAssistantInto }
}

type PreprocessedMath = { tex: string; display: boolean }
type PreprocessedSticker = { raw: string; category: string; name: string; size?: number }
type PreprocessedToolRequest = {
  ok: boolean
  toolNames: string[]
  detailText: string
}

type FenceToken =
  | { kind: 'text'; text: string }
  | { kind: 'fence'; raw: string; lang: string; content: string; closed: boolean }

function preprocessAssistantContent(
  source: unknown,
  options?: { stickersEnabled?: boolean },
): { text: string; math: PreprocessedMath[]; mermaid: string[]; stickers: PreprocessedSticker[]; toolRequests: PreprocessedToolRequest[] } {
  const src = String(source || '').replace(/\r\n/g, '\n')
  const tokens = tokenizeFences(src)

  const mermaid: string[] = []
  const math: PreprocessedMath[] = []
  const stickers: PreprocessedSticker[] = []
  const toolRequests: PreprocessedToolRequest[] = []
  const out: string[] = []
  const stickersEnabled = !!options?.stickersEnabled

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

    // 先把 TOOL_REQUEST 整块摘出来做占位符保护，避免后续的数学/贴纸预处理改写块内内容导致解析失败。
    const withTools = replaceToolRequestsOutsideInlineCode(t.text, toolRequests)
    const withMath = replaceMathOutsideInlineCode(withTools, math)
    out.push(stickersEnabled ? replaceStickersOutsideInlineCode(withMath, stickers) : withMath)
  }

  return { text: out.join(''), math, mermaid, stickers, toolRequests }
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

function replaceStickersOutsideInlineCode(input: string, acc: PreprocessedSticker[]) {
  const parts = splitInlineCodeSpans(input)
  return parts
    .map((p) => {
      if (p.kind === 'code') return p.value
      return replaceStickersInPlainText(p.value, acc)
    })
    .join('')
}

function replaceToolRequestsOutsideInlineCode(input: string, acc: PreprocessedToolRequest[]) {
  const parts = splitInlineCodeSpans(input)
  return parts
    .map((p) => {
      if (p.kind === 'code') return p.value
      return replaceToolRequestsInPlainText(p.value, acc)
    })
    .join('')
}

function replaceToolRequestsInPlainText(input: string, acc: PreprocessedToolRequest[]) {
  const s = String(input || '')
  if (!s) return s

  const OPEN = '<<<[TOOL_REQUEST]>>>'
  const CLOSE = '<<<[END_TOOL_REQUEST]>>>'

  let out = ''
  let i = 0
  while (i < s.length) {
    const openIdx = s.indexOf(OPEN, i)
    if (openIdx < 0) {
      out += s.slice(i)
      break
    }

    const closeIdx = s.indexOf(CLOSE, openIdx + OPEN.length)
    if (closeIdx < 0) {
      // 未闭合的块不要动，避免“半截工具块”破坏正常渲染。
      out += s.slice(i)
      break
    }

    const endIdx = closeIdx + CLOSE.length
    out += s.slice(i, openIdx)

    const rawBlock = s.slice(openIdx, endIdx)
    const parsed = parseToolRequestCalls(rawBlock as any)

    if ((parsed as any)?.ok) {
      const calls = Array.isArray((parsed as any)?.calls) ? (parsed as any).calls : []
      const toolNames = calls.map((c: any) => String(c?.tool_name || '').trim()).filter(Boolean)
      const lines: string[] = []
      for (const c of calls) {
        const idx = Number(c?.index || 0) || 0
        lines.push(`CALL-${idx || ''}`.trim())
        lines.push(`tool_name: ${String(c?.tool_name || '').trim()}`)
        if (c?.agent) lines.push(`agent: ${String(c.agent).trim()}`)
        if (c?.schedule) lines.push(`schedule: ${String(c.schedule).trim()}`)
        if (c?.note) lines.push(`note: ${String(c.note).trim()}`)
        const params = c?.parameters && typeof c.parameters === 'object' ? c.parameters : {}
        const keys = Object.keys(params).sort()
        if (keys.length) {
          lines.push('parameters:')
          for (const k of keys) lines.push(`  ${k}: ${String((params as any)[k] ?? '')}`)
        }
        lines.push('')
      }

      const id = acc.length
      acc.push({
        ok: true,
        toolNames,
        detailText: lines.join('\n').trim(),
      })
      out += `@@TOOL_REQUEST_${id}@@`
    } else {
      const id = acc.length
      acc.push({
        ok: false,
        toolNames: [],
        detailText: rawBlock,
      })
      out += `@@TOOL_REQUEST_${id}@@`
    }

    i = endIdx
  }

  return out
}

function replaceStickersInPlainText(input: string, acc: PreprocessedSticker[]) {
  const s = String(input || '')
  if (!s) return s

  const re = /\[\[\s*(?:sticker|表情包)\s*:\s*([^\]\n]{1,220}?)\s*\]\]/g
  return s.replace(re, (m, innerRaw) => {
    const inner = String(innerRaw || '').trim()
    if (!inner) return m

    const p = inner.replace(/\\/g, '/')
    if (!p || p.includes('..') || p.includes('://') || p.includes('\u0000')) return m

    const parts = p
      .split('/')
      .map((x) => String(x || '').trim())
      .filter((x) => !!x)
    if (parts.length !== 2 && parts.length !== 3) return m

    const category = parts[0]
    const name = parts[1]
    if (!category || !name) return m
    if (category.includes(']') || name.includes(']')) return m

    let size: number | undefined = undefined
    if (parts.length === 3) {
      const n = parseStickerSize(parts[2])
      if (!n) return m
      size = n
    }

    const id = acc.length
    acc.push({ raw: m, category, name, size })
    return `@@STICKER_${id}@@`
  })
}

function parseStickerSize(raw: unknown) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
  if (!s) return 0
  const m = /^(\d{1,5})(?:px)?$/.exec(s)
  if (!m) return 0
  const n = Math.round(Number(m[1] || 0))
  if (!Number.isFinite(n)) return 0
  if (n < 16) return 16
  if (n > 4096) return 4096
  return n
}

function hydrateStickerSizes(root: unknown) {
  if (!(root instanceof HTMLElement)) return
  const imgs = Array.from(root.querySelectorAll?.('img.fw-sticker[data-fw-sticker-size]') || [])
  for (const img of imgs) {
    if (!(img instanceof HTMLImageElement)) continue
    const raw = img.getAttribute('data-fw-sticker-size') || ''
    const size = parseStickerSize(raw)
    if (!size) continue
    img.style.maxWidth = `min(${size}px, 100%)`
    img.style.maxHeight = `min(${size}px, 70vh)`
  }
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
