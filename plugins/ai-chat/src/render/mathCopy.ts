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

export function enhanceMathCopyButtons(root: unknown) {
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

