import { esc } from '../core/utils'
import { presetVarsToInlineStyle, type ToolRequestRenderPreset } from '../core/toolRequestPresets'
import type { BoolRef } from './types'

export function ensureToolReqCssOnce(inited: BoolRef) {
  if (inited.value) return
  inited.value = true
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

export function renderToolRequestHtml(preset: ToolRequestRenderPreset | null, summaryHtml: string, detailText: string) {
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

export function ensureToolRequestToggleHandlerOnce(root: HTMLElement) {
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
