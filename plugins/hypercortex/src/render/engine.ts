/**
 * HyperCortex Markdown/HTML 渲染引擎
 *
 * 从 ai-chat 的 assistantEngineDefault.ts 裁剪而来。
 * 保留：Markdown 渲染、数学公式 (KaTeX)、流程图 (Mermaid)、代码块复制、HTML 消毒 (DOMPurify)
 * 移除：工具调用卡片、贴纸系统、AI 修复 Mermaid
 */

import './vendor'
import { type Api, type VaultScope } from '../core'
import { resolveAssetsInElement } from './attachments'

type RenderSafetyPolicy = 'original' | 'baseline' | 'unsafe'

export type MarkdownRenderEngine = {
  ensureRenderer: () => Promise<void>
  sanitizeHtml: (html: unknown, policy?: RenderSafetyPolicy) => string
  sanitizeSvg: (svg: unknown, policy?: RenderSafetyPolicy) => string
  renderInto: (
    el: unknown,
    text: unknown,
    options?: { renderSafetyPolicy?: RenderSafetyPolicy; onAsyncLayout?: () => void },
  ) => void
}

/* ------------------------------------------------------------------ */
/*  内联工具                                                           */
/* ------------------------------------------------------------------ */

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

function esc(s: unknown) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c])
}

/* ------------------------------------------------------------------ */
/*  自注入 CSS（渲染产物所需的样式，挂在 .hc-render 根下）                   */
/* ------------------------------------------------------------------ */

const ENGINE_STYLE_ID = 'hc-render-engine-css'
const ENGINE_CSS = `
.hc-render{font-size:15px;line-height:1.75;word-break:break-word;color:#222;}
.hc-render h1{font-size:1.6em;margin:16px 0 8px;font-weight:700;}
.hc-render h2{font-size:1.35em;margin:14px 0 6px;font-weight:700;}
.hc-render h3{font-size:1.15em;margin:12px 0 4px;font-weight:600;}
.hc-render h4,.hc-render h5,.hc-render h6{font-size:1em;margin:10px 0 4px;font-weight:600;}
.hc-render p{margin:8px 0;}
.hc-render ul,.hc-render ol{margin:8px 0 8px 18px;}
.hc-render blockquote{margin:10px 0;padding:8px 12px;border-left:4px solid rgba(25,118,210,.35);background:rgba(25,118,210,.06);border-radius:12px;}
.hc-render hr{border:0;border-top:1px solid rgba(0,0,0,.12);margin:10px 0;}
.hc-render img{max-width:100%;height:auto;cursor:zoom-in;}
.hc-render table{border-collapse:collapse;width:100%;max-width:100%;overflow-x:auto;overflow-y:hidden;border-radius:12px;display:block;}
.hc-render th,.hc-render td{border:1px solid rgba(0,0,0,.12);padding:8px;vertical-align:top;}
.hc-render pre{overflow:auto;padding:10px;background:#0b1220;color:#e5e7eb;border-radius:10px;border:1px solid rgba(255,255,255,.06);}
.hc-render pre.fw-code-block{position:relative;padding-top:38px;}
.hc-render code{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:13px;}
.hc-render pre.fw-code-block .fw-code-copy{position:absolute;top:8px;right:8px;z-index:1;width:30px;height:30px;padding:0;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#e5e7eb;font-size:12px;cursor:pointer;user-select:none;-webkit-user-select:none;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:inline-flex;align-items:center;justify-content:center;}
.hc-render pre.fw-code-block .fw-code-copy:hover{background:rgba(255,255,255,.12);}
.hc-render pre.fw-code-block .fw-code-copy:active{background:rgba(255,255,255,.16);}
.hc-render pre.fw-code-block .fw-code-copy:disabled{opacity:.75;cursor:default;}
.hc-render pre.fw-code-block .fw-code-copy:focus-visible{outline:2px solid rgba(255,255,255,.35);outline-offset:2px;}
.hc-render pre.fw-code-block .fw-code-copy[data-state="ok"]{color:#34d399;}
.hc-render pre.fw-code-block .fw-code-copy[data-state="fail"]{color:#f87171;}
.hc-asset{display:inline-block;vertical-align:middle;}
.hc-asset-chip{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:rgba(0,0,0,.05);color:rgba(0,0,0,.72);font-size:12px;line-height:1;user-select:none;}
.hc-asset-chip--loading{background:rgba(25,118,210,.06);color:rgba(25,118,210,.85);}
.hc-asset-chip--error{background:rgba(211,47,47,.08);color:rgba(211,47,47,.85);}
.hc-asset-chip--doc{background:rgba(0,0,0,.05);color:rgba(0,0,0,.72);}
.hc-asset-block{margin:10px 0;display:flex;flex-direction:column;gap:6px;}
.hc-asset-title{font-size:12px;color:rgba(0,0,0,.52);font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.math-block{margin:10px 0;overflow-x:auto;}
.hc-render .katex,.hc-render .katex-display{max-width:100%;}
.hc-render span.katex{display:inline-block;overflow:visible;vertical-align:middle;}
.hc-render .katex-display{overflow:visible;}
.hc-render .katex-display>.katex{display:block;overflow-x:visible;}
.fw-math-host{position:relative;}
.math-inline.fw-math-host{display:inline-block;}
.math-block.fw-math-host{display:block;}
.fw-math-copy{position:absolute;width:24px;height:24px;padding:0;border-radius:999px;border:1px solid transparent;background:transparent;color:rgba(0,0,0,.55);cursor:pointer;user-select:none;-webkit-user-select:none;display:inline-flex;align-items:center;justify-content:center;font-size:12px;line-height:1;opacity:0;visibility:hidden;pointer-events:none;transition:opacity 120ms ease;}
.fw-math-copy:hover{background:rgba(0,0,0,.06);border-color:rgba(0,0,0,.12);color:rgba(0,0,0,.72);}
.fw-math-copy:active{background:rgba(0,0,0,.10);border-color:rgba(0,0,0,.12);color:rgba(0,0,0,.76);}
.fw-math-copy:focus-visible{outline:2px solid rgba(25,118,210,.35);outline-offset:2px;}
.math-inline.fw-math-host>.fw-math-copy{left:100%;top:50%;transform:translate(0,-50%);}
.math-block.fw-math-host>.fw-math-copy{right:6px;top:50%;transform:translateY(-50%);}
.fw-math-host:hover>.fw-math-copy,.fw-math-host:focus-within>.fw-math-copy{opacity:1;visibility:visible;pointer-events:auto;}
.mermaid-block{margin:10px 0;overflow-x:auto;cursor:zoom-in;}
.mermaid-block svg{max-width:100%;height:auto;display:block;}
.mermaid-error{margin:10px 0;overflow-x:auto;}
.mermaid-error-box{position:relative;background:#fff;border:1px solid rgba(0,0,0,.12);border-radius:12px;padding:10px 12px;padding-right:48px;}
.mermaid-error-copy{position:absolute;top:8px;right:8px;width:28px;height:28px;padding:0;border-radius:999px;border:1px solid rgba(0,0,0,.12);background:#fff;color:rgba(0,0,0,.55);cursor:pointer;user-select:none;-webkit-user-select:none;display:inline-flex;align-items:center;justify-content:center;font-size:12px;}
.mermaid-error-copy:hover{background:rgba(0,0,0,.04);border-color:rgba(0,0,0,.18);color:rgba(0,0,0,.72);}
.mermaid-error-copy:active{background:rgba(0,0,0,.08);}
.mermaid-error-copy:disabled{opacity:.7;cursor:default;}
.mermaid-error-copy:focus-visible{outline:2px solid rgba(25,118,210,.35);outline-offset:2px;}
.mermaid-error-title{font-weight:900;font-size:12px;color:rgba(0,0,0,.72);}
.mermaid-error-msg{margin-top:6px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;color:rgba(0,0,0,.55);white-space:pre-wrap;word-break:break-word;}
.mermaid-error-src{display:none;}
.mermaid-error-err{display:none;}
`

function ensureEngineCss() {
  if (document.getElementById(ENGINE_STYLE_ID)) return
  const el = document.createElement('style')
  el.id = ENGINE_STYLE_ID
  el.textContent = ENGINE_CSS
  document.head.appendChild(el)
}

/* ------------------------------------------------------------------ */
/*  工厂函数                                                           */
/* ------------------------------------------------------------------ */

export function createMarkdownRenderEngine(init?: { api?: Api; scope?: VaultScope }): MarkdownRenderEngine {
  let rendererPromise: Promise<void> | null = null
  let domPurifyHooked = false
  let mermaidInited = false
  let markedConfigured = false
  const mermaidSvgCache = new Map<string, string>()
  const defaultApi = init?.api
  const defaultScope: VaultScope = init?.scope || 'library'

  const ICON_COPY =
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M16 1H6c-1.1 0-2 .9-2 2v12h2V3h10V1zm3 4H10c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h9c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16h-9V7h9v14z"/></svg>'
  const ICON_OK =
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>'
  const ICON_FAIL =
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>'

  /* ---------- 剪贴板 ---------- */

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
      const w = window as any
      const writeText = w?.fastWindow?.clipboard?.writeText
      if (typeof writeText === 'function') { await writeText(t); return true }
      if (navigator?.clipboard?.writeText) { await navigator.clipboard.writeText(t); return true }
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

  /* ---------- 代码块复制按钮 ---------- */

  function ensureCodeCopyHandlerOnce(root: HTMLElement) {
    if (root.getAttribute('data-hc-copy-hook') === '1') return
    root.setAttribute('data-hc-copy-hook', '1')

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
        .then((ok) => setCopyBtnState(btn, ok ? 'ok' : 'fail'))
        .catch(() => setCopyBtnState(btn, 'fail'))
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

  /* ---------- Mermaid 错误框复制 ---------- */

  function ensureMermaidErrorCopyHandlerOnce(root: HTMLElement) {
    if (root.getAttribute('data-hc-mmerr-copy-hook') === '1') return
    root.setAttribute('data-hc-mmerr-copy-hook', '1')

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
        .then((ok) => setCopyBtnState(btn, ok ? 'ok' : 'fail'))
        .catch(() => setCopyBtnState(btn, 'fail'))
        .finally(() => {
          window.setTimeout(() => {
            if (!btn.isConnected) return
            setCopyBtnState(btn, 'copy')
            btn.disabled = false
          }, 1200)
        })
    })
  }

  /* ---------- Mermaid 初始化与渲染 ---------- */

  function initMermaidOnce() {
    const m = (window as any).mermaid
    if (mermaidInited || !m || !m.initialize) return
    try {
      mermaidInited = true
      m.initialize({
        startOnLoad: false,
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
      try { initMermaidOnce() } catch (_) {}
    })()
    return rendererPromise
  }

  async function renderMermaidInto(el: unknown, policy?: RenderSafetyPolicy) {
    if (!(el instanceof HTMLElement)) return
    const renderSafetyPolicy: RenderSafetyPolicy = policy === 'unsafe' ? 'unsafe' : policy === 'baseline' ? 'baseline' : 'original'
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
      try { return await m.render(id, code) } catch (_) { return await m.render(id, code, container) }
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
        continue
      }

      try {
        const id = uid('mm')
        const r = await doRender(id, src, holder)
        const svg = typeof r === 'string' ? r : String(r?.svg || '')
        const safe = sanitizeSvg(svg, renderSafetyPolicy)
        if (!safe) throw new Error('empty svg')
        if (mermaidSvgCache.size >= 50) {
          const first = mermaidSvgCache.keys().next().value
          if (typeof first === 'string' && first) mermaidSvgCache.delete(first)
        }
        mermaidSvgCache.set(src, safe)
        holder.innerHTML = safe
        holder.setAttribute('data-mermaid', '1')
        if (r && typeof r.bindFunctions === 'function') {
          try { r.bindFunctions(holder) } catch (_) {}
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

  function requestLayoutAfterMediaReady(root: HTMLElement, onAsyncLayout: () => void) {
    const pending: { el: HTMLElement; event: string }[] = []
    root.querySelectorAll('img').forEach((img) => {
      if (!(img instanceof HTMLImageElement)) return
      if (!img.complete) pending.push({ el: img, event: 'load' })
    })
    root.querySelectorAll('video').forEach((vid) => {
      if (!(vid instanceof HTMLVideoElement)) return
      if (vid.readyState < 1) pending.push({ el: vid, event: 'loadedmetadata' })
    })

    if (!pending.length) {
      try { onAsyncLayout() } catch (_) {}
      return
    }

    let remaining = pending.length
    const done = () => {
      remaining -= 1
      if (remaining > 0) return
      try { onAsyncLayout() } catch (_) {}
    }
    for (const { el, event } of pending) {
      el.addEventListener(event, done, { once: true })
      el.addEventListener('error', done, { once: true })
    }
  }

  /* ---------- HTML 消毒 ---------- */

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
          ADD_TAGS: ['button', 'details', 'summary', 'input', 'label', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'audio', 'video', 'source'],
          ADD_ATTR: ['id', 'style', 'class', 'role', 'tabindex', 'colspan', 'rowspan', 'src', 'alt', 'controls', 'autoplay', 'muted', 'loop', 'playsinline', 'poster', 'type', 'width', 'height', 'href', 'target', 'rel', 'title', 'download'],
        })
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
        if (!isAllowedAttr(tag, name)) { el.removeAttribute(a.name); continue }
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

  function sanitizeSvg(svg: unknown, policy?: RenderSafetyPolicy) {
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
    const w = window as any
    if (w.DOMPurify && w.DOMPurify.sanitize) {
      try { return w.DOMPurify.sanitize(raw, { USE_PROFILES: { svg: true, svgFilters: true } }) } catch (_) {}
    }
    return raw
  }

  /* ---------- 图片预览标记 ---------- */

  function markPreviewImages(root: unknown) {
    if (!(root instanceof HTMLElement)) return
    const imgs = Array.from(root.querySelectorAll?.('img') || [])
    for (const img of imgs) {
      if (!(img instanceof HTMLImageElement)) continue
      const src = String(img.getAttribute('src') || '').trim()
      if (!src) continue
      if (img.getAttribute('data-fw-img') === '1') continue
      img.setAttribute('data-fw-img', '1')
      try { img.style.cursor = 'zoom-in' } catch (_) {}
    }
  }

  /* ---------- 数学公式复制按钮 ---------- */

  function ensureMathCopyHandlerOnce(root: unknown) {
    if (!(root instanceof HTMLElement)) return
    const ds: any = root.dataset as any
    if (ds.hcMathCopyBound === '1') return
    ds.hcMathCopyBound = '1'

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

        copyTextToClipboard(copyText)
          .then(() => {
            try { (window as any)?.fastWindow?.ui?.showToast?.('已复制公式') } catch (_) {}
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

  /* ---------- HTML 缩进预处理 ---------- */

  function preprocessHtmlIndentation(source: unknown) {
    function dedentHtmlLines(s: unknown) {
      const t = String(s || '')
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

  /* ---------- 主渲染入口 ---------- */

  function renderInto(
    el: unknown,
    text: unknown,
    options?: { renderSafetyPolicy?: RenderSafetyPolicy; onAsyncLayout?: () => void },
  ) {
    if (!(el instanceof HTMLElement)) return
    ensureEngineCss()

    const raw = String(text || '')
    let html = ''
    const renderSafetyPolicy: RenderSafetyPolicy =
      options?.renderSafetyPolicy === 'unsafe' ? 'unsafe' : options?.renderSafetyPolicy === 'baseline' ? 'baseline' : 'original'
    const onAsyncLayout = typeof options?.onAsyncLayout === 'function' ? options.onAsyncLayout : null

    const noIndent = preprocessHtmlIndentation(raw)
    const pre = preprocessContent(noIndent)
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
        html = w.marked.parse(src)
      } catch (_) {
        html = `<pre>${esc(src)}</pre>`
      }
    }

    let safe = sanitizeHtml(html, renderSafetyPolicy)

    // 回填数学公式占位符
    if (Array.isArray(pre.math) && pre.math.length) {
      safe = safe.replace(/@@MATH_(INLINE|BLOCK)_(\d+)@@/g, (_m, kind, id) => {
        const it = pre.math[Number(id)]
        const tex = it ? String(it.tex || '') : ''
        if (kind === 'INLINE') return `<span class="math-inline" data-tex="${esc(tex)}"></span>`
        return `<div class="math-block" data-tex="${esc(tex)}"></div>`
      })
    }

    // 回填 Mermaid 占位符
    if (Array.isArray(pre.mermaid) && pre.mermaid.length) {
      safe = safe.replace(/@@MERMAID_(\d+)@@/g, (_m, id) => {
        const code = pre.mermaid[Number(id)] ?? ''
        return `<pre><code class="language-mermaid">${esc(code)}</code></pre>`
      })
    }

    // 回填 Asset 占位符
    if (Array.isArray(pre.assets) && pre.assets.length) {
      safe = safe.replace(/@@ASSET_(\d+)@@/g, (_m, id) => {
        const a = pre.assets[Number(id)]
        if (!a) return ''
        const nm = esc(a.name)
        return `<span class="hc-asset" data-hc-asset-ref="${esc(a.ref)}" data-hc-asset-name="${nm}" data-hc-asset-state="loading"${a.width ? ` data-hc-asset-width="${a.width}"` : ''}><span class="hc-asset-chip hc-asset-chip--loading">📎 ${nm}（加载中…）</span></span>`
      })
    }

    // 注入 DOM
    el.innerHTML = safe

    // 后处理增强
    enhanceCodeBlocks(el)
    ensureMermaidErrorCopyHandlerOnce(el)
    markPreviewImages(el)

    // KaTeX 公式渲染
    const katex = w.katex
    if (katex && typeof katex.render === 'function') {
      const blocks = Array.from(el.querySelectorAll?.('.math-block[data-tex]') || [])
      for (const b of blocks) {
        if (!(b instanceof HTMLElement)) continue
        const tex = b.getAttribute('data-tex') || ''
        try { katex.render(tex, b, { displayMode: true, throwOnError: false }) } catch (_) {}
      }
      const inlines = Array.from(el.querySelectorAll?.('.math-inline[data-tex]') || [])
      for (const s of inlines) {
        if (!(s instanceof HTMLElement)) continue
        const tex = s.getAttribute('data-tex') || ''
        try { katex.render(tex, s, { displayMode: false, throwOnError: false }) } catch (_) {}
      }
      enhanceMathCopyButtons(el)
    }

    const tasks: Promise<any>[] = []

    // Mermaid 图表异步渲染
    tasks.push(
      renderMermaidInto(el, renderSafetyPolicy)
        .catch(() => {})
        .finally(() => { if (onAsyncLayout) { try { onAsyncLayout() } catch (_) {} } }),
    )

    // 附件/资源渲染（MVP：作为统一后处理链路的一环）
    if (defaultApi) {
      tasks.push(
        resolveAssetsInElement(el, defaultApi, defaultScope)
          .catch(() => {})
          .finally(() => { if (onAsyncLayout) { try { onAsyncLayout() } catch (_) {} } }),
      )
    }

    if (onAsyncLayout) {
      Promise.allSettled(tasks)
        .then(() => requestLayoutAfterMediaReady(el, onAsyncLayout))
        .catch(() => {})
    }
  }

  return { ensureRenderer, sanitizeHtml, sanitizeSvg, renderInto }
}

/* ================================================================== */
/*  顶层辅助函数（不依赖闭包状态）                                        */
/* ================================================================== */

type PreprocessedMath = { tex: string; display: boolean }
type PreprocessedAsset = { ref: string; name: string; width?: number }

type FenceToken =
  | { kind: 'text'; text: string }
  | { kind: 'fence'; raw: string; lang: string; content: string; closed: boolean }

function preprocessContent(
  source: unknown,
): { text: string; math: PreprocessedMath[]; mermaid: string[]; assets: PreprocessedAsset[] } {
  const src = String(source || '').replace(/\r\n/g, '\n')
  const tokens = tokenizeFences(src)

  const mermaid: string[] = []
  const math: PreprocessedMath[] = []
  const assets: PreprocessedAsset[] = []
  const out: string[] = []
  const assetPattern = /\{\{asset:([^}|]+?)(?:\|([^}|]*?))?(?:\|(\d+))?\}\}/g

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

    const withAssets = t.text.replace(assetPattern, (_m, refText, displayName, widthStr) => {
      const ref = String(refText || '').trim()
      if (!ref) return ''
      const dotIdx = ref.lastIndexOf('.')
      const ext = dotIdx > 0 ? ref.slice(dotIdx + 1).toLowerCase() : ''
      const assetId = dotIdx > 0 ? ref.slice(0, dotIdx) : ref
      const name0 = String(displayName || '').trim()
      const name = name0 || (ext ? `${assetId.slice(0, 8)}.${ext}` : assetId.slice(0, 8))
      const width = widthStr ? Number(widthStr) : undefined
      const id = assets.length
      assets.push({ ref, name, width })
      return `@@ASSET_${id}@@`
    })

    const withMath = replaceMathOutsideInlineCode(withAssets, math)
    out.push(withMath)
  }

  return { text: out.join(''), math, mermaid, assets }
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
      if (!m) { textBuf.push(withNl); continue }

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
    if (s[i] !== '`') { i++; continue }

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
  // inline: $...$（防误判：必须像"公式"）
  s = s.replace(/\$([^\$\n]+?)\$/g, (m, tex) => {
    const t = String(tex || '').trim()
    if (!t) return m
    if (!/[A-Za-z\\]|[_^]/.test(t)) return m
    return stash(t, false)
  })

  return s
}
