import { copyTextToClipboard, setCopyBtnState } from './copy'
import { ICON_COPY, ICON_FAIL, ICON_IMAGE, ICON_OK } from './icons'
import { exportSvgElementToPngDataUrl } from './mermaidExport'
import { sanitizeSvg } from './sanitize'
import type { BoolRef, KnowledgeRenderCapabilities, RenderSafetyPolicy } from './types'
import { esc, uid } from './utils'

export function createMermaidSupport(opts: {
  mermaidInited: BoolRef
  mermaidSvgCache: Map<string, string>
  capabilities: KnowledgeRenderCapabilities
}) {
  const { mermaidInited, mermaidSvgCache, capabilities } = opts
  const renderedMermaidSources = new WeakMap<HTMLElement, string>()

  function setMermaidImageCopyBtnState(btn: HTMLButtonElement, state: 'copy' | 'ok' | 'fail') {
    if (state === 'ok') {
      btn.innerHTML = ICON_OK
      btn.setAttribute('data-state', 'ok')
      btn.setAttribute('title', '已复制图片')
      btn.setAttribute('aria-label', '已复制图片')
      return
    }
    if (state === 'fail') {
      btn.innerHTML = ICON_FAIL
      btn.setAttribute('data-state', 'fail')
      btn.setAttribute('title', '复制图片失败')
      btn.setAttribute('aria-label', '复制图片失败')
      return
    }
    btn.innerHTML = ICON_IMAGE
    btn.removeAttribute('data-state')
    btn.setAttribute('title', '复制 Mermaid 图片')
    btn.setAttribute('aria-label', '复制 Mermaid 图片')
  }

  function resetMermaidCopyButton(btn: HTMLButtonElement, reset: () => void) {
    window.setTimeout(() => {
      if (!btn.isConnected) return
      reset()
      btn.disabled = false
    }, 1200)
  }

  function formatMermaidSourceForCopy(src: string) {
    const text = String(src || '').trim()
    return text ? `\`\`\`mermaid\n${text}\n\`\`\`` : ''
  }

  function enhanceRenderedMermaidBlock(holder: HTMLElement, src: string) {
    holder.classList.add('mermaid-block-ready')
    renderedMermaidSources.set(holder, src)

    const toolbar = document.createElement('div')
    toolbar.className = 'mermaid-block-toolbar'
    toolbar.setAttribute('aria-label', 'Mermaid 操作')
    toolbar.setAttribute('data-stop', '1')

    const imageBtn = document.createElement('button')
    imageBtn.type = 'button'
    imageBtn.className = 'mermaid-block-action mermaid-block-copy-image'
    imageBtn.setAttribute('data-act', 'copy-mermaid-image')
    setMermaidImageCopyBtnState(imageBtn, 'copy')

    const sourceBtn = document.createElement('button')
    sourceBtn.type = 'button'
    sourceBtn.className = 'mermaid-block-action mermaid-block-copy-source'
    sourceBtn.setAttribute('data-act', 'copy-mermaid-source')
    setCopyBtnState(sourceBtn, 'copy', '复制 Mermaid 源码')

    toolbar.appendChild(imageBtn)
    toolbar.appendChild(sourceBtn)
    holder.appendChild(toolbar)
  }

  function ensureMermaidBlockCopyHandlerOnce(root: HTMLElement) {
    if (root.getAttribute('data-fw-mm-copy-hook') === '1') return
    root.setAttribute('data-fw-mm-copy-hook', '1')

    root.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null
      const imageBtn = target?.closest?.('button[data-act="copy-mermaid-image"]')
      const sourceBtn = target?.closest?.('button[data-act="copy-mermaid-source"]')
      const btn = imageBtn || sourceBtn
      if (!(btn instanceof HTMLButtonElement)) return

      event.preventDefault()
      event.stopPropagation()

      const block = btn.closest('.mermaid-block[data-mermaid="1"]')
      if (!(block instanceof HTMLElement)) return

      if (imageBtn) {
        const svgEl = block.querySelector('svg')
        const writeImage = capabilities.clipboard?.writeImage
        if (!(svgEl instanceof SVGSVGElement) || typeof writeImage !== 'function') {
          setMermaidImageCopyBtnState(btn, 'fail')
          resetMermaidCopyButton(btn, () => setMermaidImageCopyBtnState(btn, 'copy'))
          return
        }

        btn.disabled = true
        exportSvgElementToPngDataUrl(svgEl)
          .then(dataUrl => writeImage(dataUrl))
          .then(() => {
            setMermaidImageCopyBtnState(btn, 'ok')
            capabilities.ui?.showToast?.('已复制 Mermaid 图片')
          })
          .catch(() => setMermaidImageCopyBtnState(btn, 'fail'))
          .finally(() => resetMermaidCopyButton(btn, () => setMermaidImageCopyBtnState(btn, 'copy')))
        return
      }

      const text = formatMermaidSourceForCopy(renderedMermaidSources.get(block) || '')
      if (!text.trim()) return
      btn.disabled = true
      copyTextToClipboard(text)
        .then(ok => {
          setCopyBtnState(btn, ok ? 'ok' : 'fail', '复制 Mermaid 源码')
          if (ok) capabilities.ui?.showToast?.('已复制 Mermaid 源码')
        })
        .catch(() => setCopyBtnState(btn, 'fail', '复制 Mermaid 源码'))
        .finally(() => resetMermaidCopyButton(btn, () => setCopyBtnState(btn, 'copy', '复制 Mermaid 源码')))
    })
  }

  function ensureMermaidErrorCopyHandlerOnce(root: HTMLElement) {
    if (root.getAttribute('data-fw-mmerr-copy-hook') === '1') return
    root.setAttribute('data-fw-mmerr-copy-hook', '1')

    root.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null
      const btn = target?.closest?.('button[data-act="copy-mermaid-src"]')
      if (!(btn instanceof HTMLButtonElement)) return

      const box = btn.closest('.mermaid-error-box')
      const srcEl = box?.querySelector?.('.mermaid-error-src')
      const text = formatMermaidSourceForCopy(srcEl ? String(srcEl.textContent || '') : '')
      if (!text.trim()) return

      btn.disabled = true
      copyTextToClipboard(text)
        .then(ok => setCopyBtnState(btn, ok ? 'ok' : 'fail', '复制 Mermaid 源码'))
        .catch(() => setCopyBtnState(btn, 'fail', '复制 Mermaid 源码'))
        .finally(() => resetMermaidCopyButton(btn, () => setCopyBtnState(btn, 'copy', '复制 Mermaid 源码')))
    })
  }

  function initMermaidOnce() {
    const mermaid = (window as any).mermaid
    if (mermaidInited.value || !mermaid?.initialize) return
    mermaidInited.value = true
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: 'default',
      themeVariables: {
        fontFamily: 'system-ui,-apple-system,"Segoe UI","Microsoft YaHei","PingFang SC","Noto Sans CJK SC",Roboto,Arial,sans-serif',
      },
      flowchart: { htmlLabels: false },
      state: { htmlLabels: false },
      class: { htmlLabels: false },
    })
  }

  async function renderMermaidInto(el: unknown, policy?: RenderSafetyPolicy) {
    if (!(el instanceof HTMLElement)) return
    const mermaid = (window as any).mermaid
    if (!mermaid?.render) return
    const renderSafetyPolicy: RenderSafetyPolicy = policy === 'unsafe' ? 'unsafe' : policy === 'baseline' ? 'baseline' : 'original'

    const codes = Array.from(el.querySelectorAll?.('pre>code') || []).filter(code => {
      if (!(code instanceof HTMLElement)) return false
      const className = String(code.className || '')
      return className.includes('language-mermaid') || className.includes('lang-mermaid') || className.includes('mermaid')
    })
    if (!codes.length) return

    initMermaidOnce()

    async function doRender(id: string, code: string, container: HTMLElement) {
      try {
        return await mermaid.render(id, code)
      } catch (_) {
        return await mermaid.render(id, code, container)
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
      if (cached) {
        holder.innerHTML = cached
        holder.setAttribute('data-mermaid', '1')
        enhanceRenderedMermaidBlock(holder, src)
        continue
      }

      try {
        const id = uid('mm')
        const result = await doRender(id, src, holder)
        const svg = typeof result === 'string' ? result : String(result?.svg || '')
        const safe = sanitizeSvg(svg, renderSafetyPolicy)
        if (!safe) throw new Error('empty svg')
        if (mermaidSvgCache.size >= 50) {
          const first = mermaidSvgCache.keys().next().value
          if (typeof first === 'string' && first) mermaidSvgCache.delete(first)
        }
        mermaidSvgCache.set(src, safe)
        holder.innerHTML = safe
        holder.setAttribute('data-mermaid', '1')
        enhanceRenderedMermaidBlock(holder, src)
        if (typeof result?.bindFunctions === 'function') result.bindFunctions(holder)
      } catch (error) {
        const rawError = String((error as any)?.message || error || '').trim()
        holder.className = 'mermaid-error'
        holder.removeAttribute('data-mermaid')
        holder.innerHTML = `
          <div class="mermaid-error-box" role="alert">
            <button class="mermaid-error-copy" type="button" data-act="copy-mermaid-src" title="复制 Mermaid 源码" aria-label="复制 Mermaid 源码">${ICON_COPY}</button>
            <div class="mermaid-error-title">Mermaid 渲染失败</div>
            <div class="mermaid-error-msg">${esc(rawError) || '未知错误'}</div>
            <pre class="mermaid-error-src" aria-hidden="true">${esc(src)}</pre>
          </div>
        `
      }
    }
  }

  return {
    initMermaidOnce,
    renderMermaidInto,
    ensureMermaidBlockCopyHandlerOnce,
    ensureMermaidErrorCopyHandlerOnce,
  }
}
