import type { FwArgs } from './types'

export function showToast(message: string): void {
  const existing = document.querySelector('[data-fw-toast]')
  if (existing) existing.remove()

  const el = document.createElement('div')
  el.setAttribute('data-fw-toast', '')
  el.style.cssText = `
    position: fixed;
    bottom: 32px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(33,33,33,0.92);
    color: white;
    padding: 8px 20px;
    border-radius: 999px;
    font-size: 13px;
    font-family: system-ui, -apple-system, sans-serif;
    z-index: 9999;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s;
  `
  el.textContent = message
  document.body.appendChild(el)

  requestAnimationFrame(() => {
    el.style.opacity = '1'
  })

  setTimeout(() => {
    el.style.opacity = '0'
    setTimeout(() => el.remove(), 200)
  }, 1800)
}

export function applyWindowPolicy(args: FwArgs, window: Window & typeof globalThis): void {
  if (!args.launched) return

  const w = window as any
  if (typeof w.__fastWindow === 'undefined') {
    w.__fastWindow = {}
  }

  w.__fastWindow.host = {
    toast: showToast,
    back: () => {
      w.location.reload()
    },
    startDragging: () => {},
  }
}
