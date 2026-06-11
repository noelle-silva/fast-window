import type { KnowledgeRenderCapabilities } from './types'

function ensureMathCopyHandlerOnce(root: unknown, capabilities: KnowledgeRenderCapabilities) {
  if (!(root instanceof HTMLElement)) return
  if (root.dataset.fwMathCopyBound === '1') return
  root.dataset.fwMathCopyBound = '1'

  root.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null
    const btn = target?.closest?.('.fw-math-copy')
    if (!(btn instanceof HTMLElement)) return

    const host = btn.closest('.fw-math-host')
    if (!(host instanceof HTMLElement)) return

    const tex = String(host.getAttribute('data-tex') || '').trim()
    if (!tex) return

    event.preventDefault()
    event.stopPropagation()

    const isBlock = host.classList.contains('math-block')
    const copyText = isBlock ? `$$\n${tex}\n$$` : `$${tex}$`
    const writeText =
      capabilities.clipboard?.writeText ||
      (navigator?.clipboard && typeof navigator.clipboard.writeText === 'function' ? navigator.clipboard.writeText.bind(navigator.clipboard) : null)

    Promise.resolve()
      .then(() => (writeText ? writeText(copyText) : null))
      .then(() => capabilities.ui?.showToast?.('已复制公式'))
      .catch(() => {})
  })
}

export function enhanceMathCopyButtons(root: unknown, capabilities: KnowledgeRenderCapabilities) {
  if (!(root instanceof HTMLElement)) return

  const nodes = Array.from(root.querySelectorAll?.('.math-block[data-tex], .math-inline[data-tex]') || [])
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue
    if (node.getAttribute('data-fw-math') === '1') continue
    node.setAttribute('data-fw-math', '1')
    node.classList.add('fw-math-host')

    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'fw-math-copy'
    btn.setAttribute('aria-label', '复制 LaTeX 公式')
    btn.textContent = '⧉'
    node.appendChild(btn)
  }

  ensureMathCopyHandlerOnce(root, capabilities)
}
