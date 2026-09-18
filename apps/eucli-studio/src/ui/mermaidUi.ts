import { clamp } from '../core/utils'
import { VIEWER_ZOOM_MIN, MERMAID_VIEWER_ZOOM_MAX } from '../core/viewerZoom'

export function createMermaidUi(deps: {
  getState: () => any
  assistantRenderer: any
  emit: () => void
}) {
  const {
    getState,
    assistantRenderer,
    emit,
  } = deps

  const { sanitizeHtml, sanitizeSvg } = assistantRenderer

  function currentRenderSafetyPolicy() {
    const s = getState()
    const v = String((s.data?.settings as any)?.renderSafetyPolicy || '').trim()
    return v === 'unsafe' ? 'unsafe' : v === 'baseline' ? 'baseline' : 'original'
  }

  function mermaidItemsFromDom() {
    const chat = document.querySelector('[data-area="chat"]')
    const list = Array.from(chat?.querySelectorAll?.('.mermaid-block[data-mermaid="1"]') || [])
    const items: any[] = []
    for (const b of list) {
      if (!(b instanceof HTMLElement)) continue
      const svgEl = b.querySelector('svg')
      const renderSafetyPolicy = currentRenderSafetyPolicy()
      if (svgEl) items.push({ svg: sanitizeSvg(svgEl.outerHTML || '', renderSafetyPolicy) })
      else items.push({ svg: sanitizeHtml(b.innerHTML || '', renderSafetyPolicy) })
    }
    return { blocks: list, items }
  }

  function mermaidModalEls() {
    const root = document.querySelector('[data-mm-modal="1"]')
    if (!(root instanceof HTMLElement)) return null
    const stage = root.querySelector('[data-mm-stage="1"]')
    const canvas = root.querySelector('[data-mm-canvas="1"]')
    const label = root.querySelector('[data-mm-label="1"]')
    const zoom = root.querySelector('[data-mm-zoom="1"]')
    const prev = root.querySelector('[data-act="mm-prev"]')
    const next = root.querySelector('[data-act="mm-next"]')
    return {
      root,
      stage: stage instanceof HTMLElement ? stage : null,
      canvas: canvas instanceof HTMLElement ? canvas : null,
      label: label instanceof HTMLElement ? label : null,
      zoom: zoom instanceof HTMLElement ? zoom : null,
      prev: prev instanceof HTMLButtonElement ? prev : null,
      next: next instanceof HTMLButtonElement ? next : null,
    }
  }

  function applyMermaidScaleDom() {
    const s = getState()
    if (s.modal !== 'mermaid') return
    const els = mermaidModalEls()
    if (!els?.canvas) return
    const scale = clamp(s.mermaid.scale, VIEWER_ZOOM_MIN, MERMAID_VIEWER_ZOOM_MAX)
    s.mermaid.scale = scale
    els.canvas.style.transform = `scale(${scale})`
    if (els.zoom) els.zoom.textContent = `${Math.round(scale * 100)}%`
  }

  function renderMermaidModalDom(resetScroll: boolean) {
    const s = getState()
    if (s.modal !== 'mermaid') return
    const els = mermaidModalEls()
    if (!els?.canvas) return
    const len = Array.isArray(s.mermaid.items) ? s.mermaid.items.length : 0
    if (!len) return

    const idx = clamp(s.mermaid.index, 0, len - 1)
    s.mermaid.index = idx

    const svg = String(s.mermaid.items[idx]?.svg || '')
    els.canvas.innerHTML = svg || `<div class="muted">空图</div>`
    if (els.label) els.label.textContent = `${idx + 1}/${len}`
    if (els.prev) els.prev.disabled = len <= 1
    if (els.next) els.next.disabled = len <= 1

    if (resetScroll && els.stage) {
      els.stage.scrollTop = 0
      els.stage.scrollLeft = 0
    }

    applyMermaidScaleDom()
  }

  function openMermaidViewer(blockEl: Element | null) {
    const srcEl = blockEl instanceof Element ? blockEl : null
    const r = mermaidItemsFromDom()
    if (!r.items.length) return

    let idx = 0
    if (srcEl) {
      const i = (r.blocks as Element[]).findIndex((b) => b === srcEl || (b instanceof HTMLElement && b.contains(srcEl)))
      if (i >= 0) idx = i
    }

    const s = getState()
    s.mermaid.items = r.items
    s.mermaid.index = idx
    s.mermaid.scale = 1
    s.modal = 'mermaid'
    emit()
    renderMermaidModalDom(true)
  }

  let mermaidDrag: any = null

  function cancelMermaidDrag() {
    const d = mermaidDrag
    if (!d) return
    mermaidDrag = null
    try {
      d.stage?.removeAttribute?.('data-mm-drag')
    } catch (_) {}
    try {
      window.removeEventListener('mousemove', onMouseMoveMermaid)
      window.removeEventListener('mouseup', onMouseUpMermaid)
      window.removeEventListener('blur', onMouseUpMermaid)
    } catch (_) {}
  }

  function onMouseMoveMermaid(e: MouseEvent) {
    const d = mermaidDrag
    if (!d) return
    e.preventDefault()
    const dx = Number(e.clientX || 0) - d.x
    const dy = Number(e.clientY || 0) - d.y
    d.stage.scrollLeft = d.sl - dx
    d.stage.scrollTop = d.st - dy
  }

  function onMouseUpMermaid(_e: Event) {
    if (!mermaidDrag) return
    cancelMermaidDrag()
  }

  return {
    currentRenderSafetyPolicy,
    mermaidItemsFromDom,
    mermaidModalEls,
    applyMermaidScaleDom,
    renderMermaidModalDom,
    openMermaidViewer,
    cancelMermaidDrag,
    onMouseMoveMermaid,
    onMouseUpMermaid,
  }
}
