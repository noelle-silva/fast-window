import { ICON_COPY, ICON_FAIL, ICON_OK } from './icons'

export function setCopyBtnState(btn: HTMLButtonElement, state: 'copy' | 'ok' | 'fail') {
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

export async function copyTextToClipboard(text: string) {
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

export function ensureCodeCopyHandlerOnce(root: HTMLElement) {
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

export function enhanceCodeBlocks(root: unknown) {
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
