/**
 * 文字面 Markdown/HTML 渲染引擎（面插件私有）
 *
 * 从 ai-chat 的 assistantEngineDefault.ts 裁剪而来。
 * 保留：Markdown 渲染、数学公式 (KaTeX)、流程图 (Mermaid)、代码块复制
 * 移除：工具调用卡片、贴纸系统、AI 修复 Mermaid
 * HTML/SVG 消毒复用宿主共享的通用安全设施（htmlSanitizer），不在本引擎内重复实现。
 */

import { type RenderSafetyPolicy } from '../../../htmlSanitizer'
import { katex, marked, mermaid } from './vendor'
import { type VaultScope } from '../../../core'
import { bindMediaPlaybackReporterInElement, type MediaPlaybackCleanup } from '../../../mediaPlayback'
import { resolveAssetsInElement } from './attachments'
import type { AssetsService, ClipboardGateway, HostGateway } from '../../../gateway/types'
import { ensureEngineCss } from './styles'
import { sanitizeHtml, sanitizeSvg } from './sanitize'
import { preprocessHtmlIndentation, preprocessContent } from './preprocess'

export type MarkdownRenderEngine = {
  ensureRenderer: () => Promise<void>
  sanitizeHtml: (html: unknown, policy?: RenderSafetyPolicy) => string
  sanitizeSvg: (svg: unknown, policy?: RenderSafetyPolicy) => string
  renderInto: (
    el: unknown,
    text: unknown,
    options?: { renderSafetyPolicy?: RenderSafetyPolicy; onAsyncLayout?: () => void; assetInline?: boolean },
  ) => void
  bindPlaybackReporter: (el: unknown, onPlayingChange: (playing: boolean) => void) => MediaPlaybackCleanup
  /** 仅刷新容器内引用锚点的存在/失效状态（不重建内容），用于引用索引变化时保留媒体与滚动状态。 */
  refreshNoteRefs: (el: unknown) => void
  noteIndex?: Record<string, { title: string; faceIds?: string[] }>
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

type NoteRefInput = { noteId?: unknown; faceId?: unknown; remarks?: unknown; displayText?: unknown }

// 引用锚点缓存条目：渲染输入 + 对应节点（刷新时按输入重放，不从 DOM 回读数据）。
type NoteRefAnchorEntry = { ref: NoteRefInput; node: HTMLElement; index: number }

/**
 * 生成引用锚点 HTML（存在、类型失效、不存在三种状态）。
 * 渲染回填与引用索引局部刷新共用同一生成逻辑，保证状态单源。
 */
function renderNoteRefAnchor(
  ref: NoteRefInput,
  noteIndex?: Record<string, { title: string; faceIds?: string[] }>,
  index?: number,
): string {
  const noteId = String(ref.noteId || '').trim()
  const remarks = String(ref.remarks || '')
  const remarksAttr = remarks ? ` data-note-remarks="${esc(remarks)}"` : ''
  const displayText = String(ref.displayText || '').trim()
  const indexAttr = index == null ? '' : ` data-hc-ref-index="${index}"`
  const faceId = String(ref.faceId || '').trim()
  const meta = noteIndex ? noteIndex[noteId] : undefined
  if (!meta) {
    const text = displayText || '未知笔记'
    return `<a class="hc-note-ref hc-note-ref--broken" data-note-id="${esc(noteId)}"${indexAttr}${remarksAttr}>${esc(`不存在笔记：${text}`)}</a>`
  }
  const faceAttr = faceId ? ` data-face-id="${esc(faceId)}"` : ''
  const label = displayText || String(meta.title || '').trim() || '未知笔记'
  const faceList = faceId ? meta.faceIds : undefined
  if (faceList && faceList.length > 0 && !faceList.includes(faceId)) {
    return `<a class="hc-note-ref hc-note-ref--face-gone" data-note-id="${esc(noteId)}"${indexAttr}${faceAttr}${remarksAttr}>${esc(`此面已失效：${label}`)}</a>`
  }
  const badge = faceList && faceList.includes(faceId) ? `<span class="hc-note-ref-badge">${esc(faceId)}</span>` : ''
  return `<a class="hc-note-ref" data-note-id="${esc(noteId)}"${indexAttr}${faceAttr}${remarksAttr}>${esc(label)}${badge}</a>`
}

/* ------------------------------------------------------------------ */
/*  工厂函数                                                           */
/* ------------------------------------------------------------------ */

export function createMarkdownRenderEngine(init?: { clipboard?: ClipboardGateway; host?: Pick<HostGateway, 'toast'>; assets?: AssetsService; scope?: VaultScope }): MarkdownRenderEngine {
  let rendererPromise: Promise<void> | null = null
  let domPurifyHooked = false
  let mermaidInited = false
  let markedConfigured = false
  const mermaidSvgCache = new Map<string, string>()
  // 引用锚点缓存（按渲染容器隔离）：索引更新时按缓存输入重放刷新。
  const noteRefAnchorsByContainer = new WeakMap<HTMLElement, NoteRefAnchorEntry[]>()
  const defaultAssets = init?.assets
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
      const writeText = init?.clipboard?.writeText
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
    const m = mermaid
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
    const m = mermaid
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
            try { void init?.host?.toast?.('已复制公式') } catch (_) {}
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

  /* ---------- 主渲染入口 ---------- */

  function renderInto(
    el: unknown,
    text: unknown,
    options?: { renderSafetyPolicy?: RenderSafetyPolicy; onAsyncLayout?: () => void; assetInline?: boolean },
  ) {
    if (!(el instanceof HTMLElement)) return
    ensureEngineCss()

    const raw = String(text || '')
    let html = ''
    const renderSafetyPolicy: RenderSafetyPolicy =
      options?.renderSafetyPolicy === 'unsafe' ? 'unsafe' : options?.renderSafetyPolicy === 'baseline' ? 'baseline' : 'original'
    const onAsyncLayout = typeof options?.onAsyncLayout === 'function' ? options.onAsyncLayout : null
    const assetInline = !!options?.assetInline

    const noIndent = preprocessHtmlIndentation(raw)
    const pre = preprocessContent(noIndent)
    const src = String(pre.text || '')

    if (!marked || typeof marked.parse !== 'function') {
      html = `<pre>${esc(src)}</pre>`
    } else {
      try {
        if (!markedConfigured) {
          markedConfigured = true
          marked.setOptions?.({ gfm: true, breaks: true })
        }
        html = marked.parse(src)
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
        const defaultAttr = a.nameIsDefault ? ' data-hc-asset-name-default="1"' : ''
        return `<span class="hc-asset" data-hc-asset-ref="${esc(a.ref)}" data-hc-asset-name="${nm}"${defaultAttr} data-hc-asset-state="loading"${a.width ? ` data-hc-asset-width="${a.width}"` : ''}><span class="hc-asset-chip hc-asset-chip--loading">📎 ${nm}（加载中…）</span></span>`
      })
    }

    // 回填笔记引用占位符
    if (Array.isArray(pre.noteRefs) && pre.noteRefs.length) {
      const ni = self.noteIndex
      safe = safe.replace(/@@NOTE_REF_(\d+)@@/g, (_m, id) => {
        const index = Number(id)
        const r = pre.noteRefs[index]
        if (!r) return ''
        return renderNoteRefAnchor(r, ni, index)
      })
    }

    // 注入 DOM
    el.innerHTML = safe

    // 记录本次渲染的引用锚点（输入 + 节点）：索引更新时按输入重放刷新，不从 DOM 回读数据。
    const noteRefInputs: NoteRefInput[] = Array.isArray(pre.noteRefs) ? pre.noteRefs : []
    if (noteRefInputs.length) {
      const entries: NoteRefAnchorEntry[] = []
      for (const node of Array.from(el.querySelectorAll('.hc-note-ref[data-hc-ref-index]'))) {
        if (!(node instanceof HTMLElement)) continue
        const index = Number(node.getAttribute('data-hc-ref-index'))
        const ref = noteRefInputs[index]
        if (!ref) continue
        entries.push({ ref, node, index })
      }
      noteRefAnchorsByContainer.set(el, entries)
    } else {
      noteRefAnchorsByContainer.delete(el)
    }

    // 后处理增强
    enhanceCodeBlocks(el)
    ensureMermaidErrorCopyHandlerOnce(el)
    markPreviewImages(el)

    // KaTeX 公式渲染
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
    if (defaultAssets) {
      tasks.push(
        resolveAssetsInElement(el, defaultAssets, defaultScope, { inline: assetInline })
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

  function bindPlaybackReporter(el: unknown, onPlayingChange: (playing: boolean) => void) {
    if (!(el instanceof HTMLElement)) return () => {}
    return bindMediaPlaybackReporterInElement(el, onPlayingChange)
  }

  /** 刷新容器内引用锚点的状态：按渲染时缓存的输入重放生成（不重建内容、不从 DOM 回读数据）。 */
  function refreshNoteRefs(el: unknown) {
    if (!(el instanceof HTMLElement)) return
    const entries = noteRefAnchorsByContainer.get(el)
    if (!entries || !entries.length) return
    for (const entry of entries) {
      if (!entry.node.isConnected) continue
      const next = renderNoteRefAnchor(entry.ref, self.noteIndex, entry.index)
      if (next === entry.node.outerHTML) continue
      const holder = document.createElement('template')
      holder.innerHTML = next
      const fresh = holder.content.firstElementChild
      if (!(fresh instanceof HTMLElement)) continue
      entry.node.replaceWith(fresh)
      entry.node = fresh
    }
  }

  const self: MarkdownRenderEngine = { ensureRenderer, sanitizeHtml, sanitizeSvg, renderInto, bindPlaybackReporter, refreshNoteRefs }
  return self
}
