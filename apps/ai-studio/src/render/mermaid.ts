import { esc, uid } from '../core/utils'
import { ICON_AI, ICON_COPY, ICON_FAIL, ICON_IMAGE, ICON_OK } from './icons'
import { copyTextToClipboard, setCopyBtnState } from './copy'
import { exportSvgElementToPngDataUrl } from './mermaidExport'
import { sanitizeSvg } from './sanitize'
import type { BoolRef, RenderSafetyPolicy } from './types'
import type { AiChatCapabilities } from '../gateway/capabilities'
import { AI_STUDIO_CONTROLLER_KEY } from '../runtime/aiStudioGlobals'

export function createMermaidSupport(opts: { mermaidInited: BoolRef; mermaidSvgCache: Map<string, string>; capabilities: AiChatCapabilities }) {
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

  function setMermaidSourceCopyBtnState(btn: HTMLButtonElement, state: 'copy' | 'ok' | 'fail') {
    setCopyBtnState(btn, state, '复制 Mermaid 源码')
  }

  function resetMermaidCopyButton(btn: HTMLButtonElement, reset: () => void) {
    window.setTimeout(() => {
      if (!btn.isConnected) return
      reset()
      btn.disabled = false
    }, 1200)
  }

  function getRenderedMermaidBlock(button: HTMLButtonElement) {
    const block = button.closest('.mermaid-block[data-mermaid="1"]')
    return block instanceof HTMLElement ? block : null
  }

  function getMermaidSourceFromBlock(block: HTMLElement) {
    return String(renderedMermaidSources.get(block) || '')
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
    setMermaidSourceCopyBtnState(sourceBtn, 'copy')

    toolbar.appendChild(imageBtn)
    toolbar.appendChild(sourceBtn)
    holder.appendChild(toolbar)
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
      const text = formatMermaidSourceForCopy(srcEl ? String(srcEl.textContent || '') : '')
      if (!text.trim()) return

      btn.disabled = true
      copyTextToClipboard(text)
        .then((ok) => {
          setMermaidSourceCopyBtnState(btn, ok ? 'ok' : 'fail')
        })
        .catch(() => {
          setMermaidSourceCopyBtnState(btn, 'fail')
        })
        .finally(() => {
          window.setTimeout(() => {
            if (!btn.isConnected) return
            setMermaidSourceCopyBtnState(btn, 'copy')
            btn.disabled = false
          }, 1200)
        })
    })
  }

  function ensureMermaidBlockCopyHandlerOnce(root: HTMLElement) {
    if (root.getAttribute('data-fw-mm-copy-hook') === '1') return
    root.setAttribute('data-fw-mm-copy-hook', '1')

    root.addEventListener('click', (e) => {
      const target = e.target instanceof Element ? e.target : null
      const imageBtn = target?.closest?.('button[data-act="copy-mermaid-image"]')
      const sourceBtn = target?.closest?.('button[data-act="copy-mermaid-source"]')
      const btn = imageBtn || sourceBtn
      if (!(btn instanceof HTMLButtonElement)) return

      e.preventDefault()
      e.stopPropagation()

      const block = getRenderedMermaidBlock(btn)
      if (!block) return

      if (imageBtn) {
        const svgEl = block.querySelector('svg')
        if (!(svgEl instanceof SVGSVGElement)) return
        const writeImage = capabilities.clipboard?.writeImage
        if (typeof writeImage !== 'function') {
          setMermaidImageCopyBtnState(btn, 'fail')
          capabilities.ui.showToast?.('未授权：clipboard.writeImage')
          resetMermaidCopyButton(btn, () => setMermaidImageCopyBtnState(btn, 'copy'))
          return
        }

        btn.disabled = true
        exportSvgElementToPngDataUrl(svgEl)
          .then((dataUrl) => writeImage(dataUrl))
          .then(() => {
            setMermaidImageCopyBtnState(btn, 'ok')
            capabilities.ui.showToast?.('已复制 Mermaid 图片')
          })
          .catch((err) => {
            setMermaidImageCopyBtnState(btn, 'fail')
            capabilities.ui.showToast?.(`复制图片失败：${String(err?.message || err || '未知错误')}`)
          })
          .finally(() => {
            resetMermaidCopyButton(btn, () => setMermaidImageCopyBtnState(btn, 'copy'))
          })
        return
      }

      const text = formatMermaidSourceForCopy(getMermaidSourceFromBlock(block))
      if (!text.trim()) return

      btn.disabled = true
      copyTextToClipboard(text)
        .then((ok) => {
          setMermaidSourceCopyBtnState(btn, ok ? 'ok' : 'fail')
          if (ok) capabilities.ui.showToast?.('已复制 Mermaid 源码')
        })
        .catch(() => {
          setMermaidSourceCopyBtnState(btn, 'fail')
        })
        .finally(() => {
          resetMermaidCopyButton(btn, () => setMermaidSourceCopyBtnState(btn, 'copy'))
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

      const controller = (window as any)[AI_STUDIO_CONTROLLER_KEY]
      const fn = controller?.actions?.aiFixMermaid
      if (typeof fn !== 'function') {
        capabilities.ui.showToast?.('未找到 aiFixMermaid 接口（请更新 AI Studio）')
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
          capabilities.ui.showToast?.('Mermaid 已替换')

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
          capabilities.ui.showToast?.(String(err?.message || err || 'AI 修复失败'))
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

  function initMermaidOnce() {
    const m = (window as any).mermaid
    if (mermaidInited.value || !m || !m.initialize) return
    try {
      mermaidInited.value = true
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
        enhanceRenderedMermaidBlock(holder, src)
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
        holder.setAttribute('data-act', 'open-mermaid')
        enhanceRenderedMermaidBlock(holder, src)
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

  return {
    initMermaidOnce,
    renderMermaidInto,
    ensureMermaidErrorCopyHandlerOnce,
    ensureMermaidBlockCopyHandlerOnce,
    ensureMermaidErrorAiFixHandlerOnce,
  }
}

